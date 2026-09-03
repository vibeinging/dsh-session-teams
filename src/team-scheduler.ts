/** Dependency-aware dispatch and bounded technical retry for visible window tasks. */
import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ConversationWindowDirectory } from './directory.ts'
import { deliverWindowMessage, type WindowTaskResult } from './delivery.ts'
import { serializeWindowLink } from './protocol.ts'
import {
  appendWindowTeamState,
  nextWindowTeamState,
  WindowTeamCoordinator,
} from './team-state.ts'
import type { WindowTeamProjection, WindowTeamTask } from './team-types.ts'

/** Scheduler limits resolved from plugin configuration. */
export interface WindowTeamSchedulerConfig {
  /** Delay before retrying a technical failure. */
  readonly taskRetryDelayMs: number
}

/** Observable outcome of one scheduler drain. */
export interface WindowTeamScheduleResult {
  /** Tasks accepted by their owner windows. */
  readonly started: string[]
  /** Tasks that exhausted retries or failed permanently. */
  readonly failed: string[]
}

interface ClaimedTask {
  readonly state: WindowTeamProjection
  readonly task: WindowTeamTask
}

/** Dispatch every ready task once its dependencies complete. */
export class WindowTeamScheduler {
  readonly #active = new Map<string, Promise<WindowTeamScheduleResult>>()
  readonly #lifetime = new AbortController()

  constructor(
    private readonly config: WindowTeamSchedulerConfig,
    private readonly directory: ConversationWindowDirectory,
    private readonly coordinator: WindowTeamCoordinator,
  ) {}

  /** Coalesce concurrent drains for the same leader Session. */
  run(leader: Agent, signal?: AbortSignal): Promise<WindowTeamScheduleResult> {
    const key = String(leader.session.id)
    const existing = this.#active.get(key)
    if (existing !== undefined) return existing
    const operation = this.#drain(leader, signal).finally(() => this.#active.delete(key))
    this.#active.set(key, operation)
    return operation
  }

  /** Cancel retry delays and wait for all active drains to settle. */
  async dispose(): Promise<void> {
    this.#lifetime.abort(new Error('window team scheduler disposed'))
    await Promise.allSettled(this.#active.values())
    this.#active.clear()
  }

  async #drain(leader: Agent, signal?: AbortSignal): Promise<WindowTeamScheduleResult> {
    const fused = signal === undefined
      ? this.#lifetime.signal
      : AbortSignal.any([signal, this.#lifetime.signal])
    const started: string[] = []
    const failed: string[] = []
    while (!fused.aborted) {
      const claimed = await this.#claimNext(leader)
      if (claimed === undefined) break
      const result = await this.#deliver(leader, claimed, fused)
      const disposition = await this.#settle(leader, claimed.task, result)
      if (disposition === 'started') started.push(claimed.task.id)
      if (disposition === 'failed') failed.push(claimed.task.id)
      if (disposition === 'retry') {
        const continued = await cancellableDelay(this.config.taskRetryDelayMs, fused)
        if (!continued) break
      }
    }
    return { started, failed }
  }

  async #claimNext(leader: Agent): Promise<ClaimedTask | undefined> {
    return this.coordinator.run(leader.session, () => {
      const state = this.coordinator.current(leader.session)
      if (state === null) return undefined
      const task = state.tasks.find(candidate => candidate.status === 'ready')
      if (task === undefined) return undefined
      const claimedTask: WindowTeamTask = {
        ...task,
        status: 'queued',
        attempts: task.attempts + 1,
        note: null,
        failureKind: null,
      }
      const next = nextWindowTeamState(state, {
        ...state,
        tasks: state.tasks.map(candidate => candidate.id === task.id ? claimedTask : candidate),
      })
      appendWindowTeamState(leader.session, next)
      return { state: next, task: claimedTask }
    })
  }

  async #deliver(leader: Agent, claimed: ClaimedTask, signal: AbortSignal): Promise<WindowTaskResult> {
    const targetLink = serializeWindowLink(SessionId(claimed.task.ownerSessionId))
    const resolved = await this.directory.resolve(leader, { targetLink }, signal)
    if ('code' in resolved) {
      return {
        status: 'rejected',
        messageId: `task-message-${randomUUID()}`,
        targetLink: resolved.targetLink,
        code: resolved.code,
        message: resolved.message,
      }
    }
    return deliverWindowMessage({
      target: resolved.agent,
      messageId: `task-message-${randomUUID()}`,
      conversationId: `conversation-${randomUUID()}`,
      teamId: claimed.state.teamId,
      taskId: claimed.task.id,
      sourceSessionId: leader.session.id,
      sourceName: claimed.state.leaderName,
      targetSessionId: resolved.window.sessionId,
      delivery: 'queue',
      message: renderTaskAssignment(claimed.state, claimed.task),
      signal,
    })
  }

  async #settle(
    leader: Agent,
    claimed: WindowTeamTask,
    result: WindowTaskResult,
  ): Promise<'started' | 'retry' | 'failed' | 'superseded'> {
    return this.coordinator.run(leader.session, () => {
      const state = this.coordinator.current(leader.session)
      if (state === null) return 'superseded'
      const current = state.tasks.find(task => task.id === claimed.id)
      if (current === undefined || current.status !== 'queued' || current.attempts !== claimed.attempts) {
        return 'superseded'
      }
      if (result.status === 'accepted') {
        const next = replaceTask(state, { ...current, status: 'running', note: null, failureKind: null })
        appendWindowTeamState(leader.session, next)
        return 'started'
      }
      const retry = retryableDeliveryCode(result.code) && current.attempts < current.maxAttempts
      const nextTask: WindowTeamTask = {
        ...current,
        status: retry ? 'ready' : 'failed',
        note: result.message,
        failureKind: 'technical',
      }
      appendWindowTeamState(leader.session, replaceTask(state, nextTask))
      return retry ? 'retry' : 'failed'
    })
  }
}

/** Render a self-contained task contract that reports through the normal message tool. */
export function renderTaskAssignment(state: WindowTeamProjection, task: WindowTeamTask): string {
  return [
    'You are working as one visible conversation window in a DSH window team.',
    `Team goal: ${state.goal}`,
    `Leader window: ${state.leaderName}`,
    `Your window: ${task.ownerName}`,
    `Task id: ${task.id}`,
    `Task: ${task.title}`,
    `Instruction: ${task.instruction}`,
    `Attempt: ${String(task.attempts)} of ${String(task.maxAttempts)}`,
    'Use send_window_message to ask the leader a question or report progress when useful. Reply without target_name; the trusted source is used automatically. Sending a message does not end your turn.',
    'Before you finish, use send_window_message to send the leader a self-contained result and set task_outcome to completed or failed. The trusted assignment already identifies the task, so do not provide a task id. Never end your turn without sending the leader a result, a question, or a blocker.',
    'For a failed result, set failure_kind to technical only for a temporary tool, process, or service failure; use work for failed tests, unclear requirements, or unacceptable output.',
    'Continue the conversation only while another message helps the work.',
    'Do not create a hidden team, subagent, or private task database.',
  ].join('\n')
}

/** Replace one task and advance the complete team state revision. */
function replaceTask(state: WindowTeamProjection, task: WindowTeamTask): WindowTeamProjection {
  return nextWindowTeamState(state, {
    ...state,
    tasks: state.tasks.map(candidate => candidate.id === task.id ? task : candidate),
  })
}

/** Only transient routing failures are eligible for automatic delivery retry. */
function retryableDeliveryCode(code: string): boolean {
  return code === 'target-unavailable' || code === 'target-not-active'
}

/** Abort-aware retry delay. */
function cancellableDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, delayMs)
    function onAbort() {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
