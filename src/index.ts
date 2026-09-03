/** Persistent conversation routing and role-window teams for DSH. @module @vibeinging/dsh-session-teams */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
import type { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { currentTurnDirectMessages, currentWindowRelay, latestTeamTaskAssignment } from './authority.ts'
import {
  ConversationWindowDirectory,
  type ConversationTargetFailure,
  type ResolvedConversationWindow,
} from './directory.ts'
import {
  DeliveryLedger,
  deliverWindowMessage,
  type WindowTaskResult,
} from './delivery.ts'
import { parseWindowLink, serializeWindowLink } from './protocol.ts'
import {
  ConversationWindowProvisioner,
  windowConversationHost,
  type ProvisionedConversationWindow,
} from './provisioner.ts'
import {
  appendWindowTeamState,
  nextWindowTeamState,
  refreshTaskReadiness,
  WindowTeamCoordinator,
  windowTeamProjectionDefinition,
} from './team-state.ts'
import {
  WindowTeamScheduler,
  type WindowTeamScheduleResult,
} from './team-scheduler.ts'
import type {
  WindowTeamFailureKind,
  WindowTeamMember,
  WindowTeamProjection,
  WindowTeamTask,
  WindowTeamTaskStatus,
} from './team-types.ts'

export {
  currentDirectMessages,
  currentTurnDirectMessages,
  currentWindowRelay,
} from './authority.ts'
export {
  ConversationWindowDirectory,
  readLoggedAgentOptions,
  windowFromLiveAgent,
  type ConversationTargetFailure,
  type ConversationWindow,
  type ResolvedConversationWindow,
  type WindowAgentDirectory,
  type WindowSessionPersistence,
} from './directory.ts'
export {
  DeliveryLedger,
  deliverWindowMessage,
  deliverWindowTask,
  resolveTargetWindow,
  type DeliverWindowMessageOptions,
  type DeliverWindowTaskOptions,
  type WindowMessageResult,
  type WindowTaskResult,
} from './delivery.ts'
export {
  extractWindowLinks,
  FORWARDED_TASK_PREFIX,
  isSessionTeamsPlugin,
  LEGACY_SESSION_TEAMS_MESSAGE_PREFIX,
  LEGACY_WINDOW_LINK_PLUGIN,
  LEGACY_WINDOW_MESSAGE_PREFIX,
  MAX_SESSION_ID_CHARS,
  isHumanUserSource,
  isVisibleWindowMessageSource,
  isWindowMessageSourceClaim,
  isWindowRelaySource,
  parseVisibleWindowMessage,
  parseWindowLink,
  parseWindowMessage,
  parseWindowRelayMessage,
  renderForwardedTask,
  renderVisibleWindowMessage,
  renderWindowMessage,
  SESSION_TEAMS_MESSAGE_PREFIX,
  SESSION_TEAMS_PLUGIN,
  SESSION_TEAMS_PROTOCOL_VERSION,
  SESSION_TEAMS_VISIBLE_RELAY_VERSION,
  serializeWindowLink,
  WINDOW_LINK_PLUGIN,
  WINDOW_LINK_PROTOCOL_VERSION,
  WINDOW_MESSAGE_PREFIX,
  WINDOW_RELAY_REPLY_CONTRACT,
  WINDOW_RELAY_SOURCE_FRAMING,
  WINDOW_RELAY_SOURCE_FORM,
  WINDOW_RELAY_SOURCE_KIND,
  WindowLinkParseError,
  windowRelaySource,
  type ForwardedTask,
  type WindowLink,
  type WindowMessage,
  type VisibleWindowMessageSource,
  type WindowRelaySource,
  visibleWindowMessageSource,
} from './protocol.ts'
export {
  ConversationWindowProvisioner,
  currentModelSelection,
  windowConversationHost,
  type ProvisionConversationWindowRequest,
  type ProvisionedConversationWindow,
  type WindowConversationHost,
  type WindowSessionController,
} from './provisioner.ts'
export {
  appendWindowTeamState,
  foldWindowTeam,
  refreshTaskReadiness,
  WindowTeamCoordinator,
  windowTeamProjectionDefinition,
} from './team-state.ts'
export {
  WindowTeamScheduler,
  renderTaskAssignment,
  type WindowTeamScheduleResult,
  type WindowTeamSchedulerConfig,
} from './team-scheduler.ts'
export type {
  WindowTeamFailureKind,
  WindowTeamMember,
  WindowTeamProjection,
  WindowTeamTask,
  WindowTeamTaskStatus,
} from './team-types.ts'

/** Cordis plugin name used in loader diagnostics. */
export const name = 'session-teams'

/** Required Host services; system prompt remains an optional child. */
export const inject = [
  'tools',
  'agents',
  'sessionController',
  'sessionPersistence',
  'sessionProjections',
  'workspaceRegistry',
]

/** Default largest message payload accepted from a model-facing tool. */
export const DEFAULT_MAX_TASK_CHARS = 20_000

/** Default number of process-local receipts retained for duplicate suppression. */
export const DEFAULT_MAX_REMEMBERED_MESSAGES = 1_024

/** Default in-process tool deadline. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/** Default largest team created by one user request. */
export const DEFAULT_MAX_TEAM_MEMBERS = 8

/** Default largest number of tasks retained by one team. */
export const DEFAULT_MAX_TEAM_TASKS = 64

/** Default number of technical attempts allowed for a task. */
export const DEFAULT_MAX_TASK_ATTEMPTS = 2

/** Default delay before retrying a temporary task failure. */
export const DEFAULT_TASK_RETRY_DELAY_MS = 1_000

/** Default number of conversation titles placed directly in model context. */
export const DEFAULT_MAX_DIRECTORY_ENTRIES = 32

/** Host plugin configuration. */
export interface Config {
  /** Largest sent message in UTF-16 characters (default 20000). */
  maxTaskChars?: number
  /** Maximum process-local message ids retained (default 1024). */
  maxRememberedMessages?: number
  /** API request deadline in milliseconds (default 30000). */
  requestTimeoutMs?: number
  /** Largest role-window team created by one tool call (default 8). */
  maxTeamMembers?: number
  /** Largest number of tasks retained by one team (default 64). */
  maxTeamTasks?: number
  /** Largest automatic technical attempts per task (default 2). */
  maxTaskAttempts?: number
  /** Delay before retrying a temporary task failure (default 1000). */
  taskRetryDelayMs?: number
  /** Largest conversation directory snapshot added to model context (default 32). */
  maxDirectoryEntries?: number
}

/** Validated deployment settings with usable defaults. */
export const Config: z<Config> = z.object({
  maxTaskChars: z.number().min(1).default(DEFAULT_MAX_TASK_CHARS),
  maxRememberedMessages: z.number().min(1).default(DEFAULT_MAX_REMEMBERED_MESSAGES),
  requestTimeoutMs: z.number().min(1).max(2_147_483_647).default(DEFAULT_REQUEST_TIMEOUT_MS),
  maxTeamMembers: z.number().min(1).default(DEFAULT_MAX_TEAM_MEMBERS),
  maxTeamTasks: z.number().min(1).default(DEFAULT_MAX_TEAM_TASKS),
  maxTaskAttempts: z.number().min(1).default(DEFAULT_MAX_TASK_ATTEMPTS),
  taskRetryDelayMs: z.number().min(1).max(2_147_483_647).default(DEFAULT_TASK_RETRY_DELAY_MS),
  maxDirectoryEntries: z.number().min(1).default(DEFAULT_MAX_DIRECTORY_ENTRIES),
})

/** Fully resolved settings used by tool factories and tests. */
export interface ResolvedConfig {
  readonly maxTaskChars: number
  readonly maxRememberedMessages: number
  readonly requestTimeoutMs: number
  readonly maxTeamMembers: number
  readonly maxTeamTasks: number
  readonly maxTaskAttempts: number
  readonly taskRetryDelayMs: number
  readonly maxDirectoryEntries: number
}

/** Canonical window-list result. */
export interface WindowListResult {
  readonly status: 'ok' | 'rejected'
  readonly code: string
  readonly message: string
  readonly windows: {
    readonly title: string | null
    readonly state: 'working' | 'available'
    readonly targetLink: string
  }[]
}

/** One requested task inside an atomic team graph. */
export interface TeamTaskRequest {
  readonly task: string
  readonly task_id?: string
  readonly task_title?: string
  readonly depends_on?: readonly string[]
  readonly max_attempts?: number
}

/** One requested role window with either a one-task shorthand or a complete task list. */
export interface TeamMemberRequest {
  readonly name: string
  readonly role: string
  readonly task?: string
  readonly task_id?: string
  readonly task_title?: string
  readonly depends_on?: readonly string[]
  readonly max_attempts?: number
  readonly tasks?: readonly TeamTaskRequest[]
}

interface NormalizedTeamTaskRequest {
  readonly task: string
  readonly taskId: string
  readonly taskTitle: string
  readonly dependsOn: readonly string[]
  readonly maxAttempts: number
}

interface NormalizedTeamMemberRequest {
  readonly name: string
  readonly role: string
  readonly tasks: readonly NormalizedTeamTaskRequest[]
}

/** One team-member creation outcome. */
export interface TeamMemberResult {
  readonly name: string
  readonly role: string
  readonly status: 'created' | 'reused' | 'failed'
  readonly targetLink: string
  readonly code: string
  readonly message: string
  readonly taskId: string
  readonly taskStatus: WindowTeamTaskStatus
}

/** Canonical result of one multi-window team creation. */
export interface WindowTeamResult {
  readonly status: 'accepted' | 'partial' | 'rejected'
  readonly teamId: string
  readonly code: string
  readonly message: string
  readonly members: TeamMemberResult[]
  readonly tasks: WindowTeamTask[]
}

/** Canonical result of one task-state mutation or scheduler drain. */
export interface WindowTeamMutationResult {
  readonly status: 'accepted' | 'rejected'
  readonly code: string
  readonly message: string
  readonly teamId: string
  readonly task: WindowTeamTask | null
  readonly schedule: WindowTeamScheduleResult
}

/** Canonical current-team query result. */
export interface WindowTeamListResult {
  readonly status: 'ok' | 'empty' | 'rejected'
  readonly code: string
  readonly message: string
  readonly team: WindowTeamProjection | null
}

const MESSAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/u

/** Render one message receipt into compact model-facing text. */
function renderMessageResult(value: WindowTaskResult): string {
  return [
    `status: ${value.status}`,
    `message_id: ${value.messageId}`,
    `target_link: ${value.targetLink}`,
    `code: ${value.code}`,
    `message: ${value.message}`,
  ].join('\n')
}

/** Render the current conversation directory for the model. */
function renderListResult(value: WindowListResult): string {
  return [
    `status: ${value.status}`,
    `code: ${value.code}`,
    `message: ${value.message}`,
    ...value.windows.map(window =>
      `- target_link: ${window.targetLink}; title: ${window.title === null ? '(untitled)' : JSON.stringify(window.title)}; state: ${window.state}`),
  ].join('\n')
}

/** Render one team creation result without hiding partial creation. */
function renderTeamResult(value: WindowTeamResult): string {
  return [
    `status: ${value.status}`,
    `team_id: ${value.teamId}`,
    `code: ${value.code}`,
    `message: ${value.message}`,
    ...value.members.map(member =>
      `- name: ${JSON.stringify(member.name)}; role: ${JSON.stringify(member.role)}; status: ${member.status}; target_link: ${member.targetLink}; task_id: ${member.taskId}; task_status: ${member.taskStatus}; code: ${member.code}; message: ${member.message}`),
    ...value.tasks.map(task =>
      `- task_id: ${task.id}; title: ${JSON.stringify(task.title)}; owner: ${JSON.stringify(task.ownerName)}; status: ${task.status}; depends_on: ${task.dependsOn.join(',') || 'none'}; attempts: ${String(task.attempts)}/${String(task.maxAttempts)}`),
  ].join('\n')
}

/** Render a task mutation without hiding follow-on scheduling. */
function renderTeamMutationResult(value: WindowTeamMutationResult): string {
  return [
    `status: ${value.status}`,
    `team_id: ${value.teamId}`,
    `code: ${value.code}`,
    `message: ${value.message}`,
    ...(value.task === null ? [] : [
      `task_id: ${value.task.id}`,
      `task_status: ${value.task.status}`,
      `owner: ${JSON.stringify(value.task.ownerName)}`,
      `attempts: ${String(value.task.attempts)}/${String(value.task.maxAttempts)}`,
    ]),
    `started: ${value.schedule.started.join(',') || 'none'}`,
    `failed: ${value.schedule.failed.join(',') || 'none'}`,
  ].join('\n')
}

/** Render the complete current team for dependency-aware model decisions. */
function renderWindowTeamListResult(value: WindowTeamListResult): string {
  if (value.team === null) {
    return [`status: ${value.status}`, `code: ${value.code}`, `message: ${value.message}`].join('\n')
  }
  return [
    `status: ${value.status}`,
    `code: ${value.code}`,
    `message: ${value.message}`,
    `team_id: ${value.team.teamId}`,
    `goal: ${value.team.goal}`,
    `leader: ${value.team.leaderName} (${value.team.leaderRole})`,
    ...value.team.tasks.map(task =>
      `- task_id: ${task.id}; title: ${JSON.stringify(task.title)}; owner: ${JSON.stringify(task.ownerName)}; status: ${task.status}; depends_on: ${task.dependsOn.join(',') || 'none'}; attempts: ${String(task.attempts)}/${String(task.maxAttempts)}; note: ${task.note ?? 'none'}`),
  ].join('\n')
}

/** Return one definite message refusal without touching a target. */
function rejectedMessage(messageId: string, targetLink: string, code: string, message: string): WindowTaskResult {
  return { status: 'rejected', messageId, targetLink, code, message }
}

/** Validate integer-only configuration that Schemastery's number bounds cannot express. */
function assertPositiveInteger(setting: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`session-teams config ${setting} must be a positive safe integer`)
  }
}

/** Resolve and validate one calling top-level conversation. */
function sourceAgent(exec: { readonly agent?: Agent }): Agent | ConversationTargetFailure {
  const source = exec.agent
  if (source === undefined) {
    return { targetLink: '', code: 'missing-agent', message: 'window communication requires an agent-owned tool call' }
  }
  if (source.session.header.origin === 'subagent' || (source.session.header.delegationDepth ?? 0) !== 0) {
    return { targetLink: '', code: 'source-not-window', message: 'subagent sessions cannot use conversation-window tools' }
  }
  return source
}

/** Build the directory refresh and list tool. */
export function createListConversationWindowsTool(
  config: ResolvedConfig,
  directory: ConversationWindowDirectory,
) {
  return defineTool({
    name: 'list_conversation_windows',
    description:
      'List every other ordinary DSH conversation visible to this Host. Use it when a title is unclear or the user asks which windows are available. Working and available windows are equally addressable.',
    parameters: {},
    output: {
      schema: windowListResultSchema,
      render: (_args, value) => [{ type: 'text', text: renderListResult(value) }],
    },
    timeoutMs: config.requestTimeoutMs,
    async execute(_args, exec) {
      const source = sourceAgent(exec)
      if ('code' in source) {
        return { status: 'rejected' as const, code: source.code, message: source.message, windows: [] }
      }
      try {
        const windows = await directory.listFor(source, exec.signal)
        return {
          status: 'ok' as const,
          code: 'listed',
          message: windows.length === 0
            ? 'this Host has no other conversation windows'
            : `found ${String(windows.length)} conversation window(s)`,
          windows: windows.map(window => ({
            title: window.title ?? null,
            state: window.running ? 'working' as const : 'available' as const,
            targetLink: serializeWindowLink(window.sessionId),
          })),
        }
      } catch (error: unknown) {
        return {
          status: 'rejected' as const,
          code: 'directory-unavailable',
          message: error instanceof Error ? error.message : String(error),
          windows: [],
        }
      }
    },
  })
}

/** Build direct conversation and source-locked reply delivery. */
export function createWindowMessageTool(
  config: ResolvedConfig,
  directory: ConversationWindowDirectory,
  ledger: DeliveryLedger,
  coordinator: WindowTeamCoordinator,
  scheduler: WindowTeamScheduler,
) {
  return defineTool({
    name: 'send_window_message',
    description:
      'Send a message to any ordinary DSH conversation visible to this Host. Address it with target_link, the canonical link listed for each conversation; a title alone is never a safe address because titles can duplicate or be renamed. When replying to a window message, omit target_name entirely; the trusted source is used automatically. A relayed reply cannot be redirected to a different existing conversation. Windows decide whether another reply is useful. For a final team-task report, set task_outcome; the task id comes from the trusted assignment.',
    parameters: {
      target_link: {
        type: 'string',
        description: 'Canonical dsh://session/... link of the destination from the directory or list_conversation_windows. Prefer this; resolve a user-named window to its link first.',
      },
      target_name: {
        type: 'string',
        description: 'Optional fallback by exact displayed title. Only valid when exactly one conversation has that title.',
      },
      message: { type: 'string', required: true, description: 'Exact task, result, question, or reply to send.' },
      task_outcome: {
        type: 'string',
        enum: ['completed', 'failed'],
        description: 'Final team-task result. Omit for ordinary messages, progress, and questions.',
      },
      failure_kind: {
        type: 'string',
        enum: ['technical', 'work'],
        description: 'Required when task_outcome is failed; omit otherwise.',
      },
      message_id: {
        type: 'string',
        description: 'Optional 8-128 character id for exact duplicate suppression; omit to generate one.',
      },
    },
    output: {
      schema: messageResultSchema,
      render: (_args, value) => [{ type: 'text', text: renderMessageResult(value) }],
    },
    timeoutMs: config.requestTimeoutMs,
    async execute(args, exec) {
      const messageId = args.message_id ?? `message-${randomUUID()}`
      if (!MESSAGE_ID_PATTERN.test(messageId)) {
        return rejectedMessage(messageId, args.target_link ?? '', 'invalid-message-id',
          'message_id must be 8-128 characters using letters, numbers, dot, underscore, colon, or hyphen')
      }
      if (args.message.trim().length === 0) {
        return rejectedMessage(messageId, args.target_link ?? '', 'empty-message', 'message must contain non-whitespace text')
      }
      if (args.message.length > config.maxTaskChars) {
        return rejectedMessage(messageId, args.target_link ?? '', 'message-too-large',
          `message exceeds the configured ${String(config.maxTaskChars)} character limit`)
      }
      const source = sourceAgent(exec)
      if ('code' in source) return rejectedMessage(messageId, source.targetLink, source.code, source.message)

      const sourceEvents = source.session.snapshotEvents()
      const direct = currentTurnDirectMessages(sourceEvents)
      const relay = currentWindowRelay(sourceEvents)
      const reportsTask = args.task_outcome !== undefined || args.failure_kind !== undefined
      const assignment = reportsTask ? latestTeamTaskAssignment(sourceEvents) : undefined
      let resolved: ResolvedConversationWindow | ConversationTargetFailure
      let conversationId: string
      let teamId: string | undefined
      let taskId: string | undefined
      let teamReportRequest: TeamTaskReportRequest | undefined

      if (direct.length > 0) {
        if (args.task_outcome !== undefined || args.failure_kind !== undefined) {
          return rejectedMessage(messageId, args.target_link ?? '', 'task-report-without-assignment',
            'task_outcome and failure_kind are available only while replying to an assigned team task')
        }
        resolved = await directory.resolve(source, {
          ...(args.target_name === undefined ? {} : { targetName: args.target_name }),
          ...(args.target_link === undefined ? {} : { targetLink: args.target_link }),
        }, exec.signal)
        conversationId = `conversation-${randomUUID()}`
      } else {
        const targetRelay = reportsTask ? assignment : relay
        if (targetRelay === undefined) {
          if (reportsTask) {
            return rejectedMessage(messageId, args.target_link ?? '', 'task-report-without-assignment',
              'task_outcome requires a trusted team-task assignment')
          }
          return rejectedMessage(messageId, args.target_link ?? '', 'missing-direct-message',
            'sending requires a direct user request or a replyable window message in this turn')
        }
        const replyLink = serializeWindowLink(targetRelay.sourceSessionId)
        if (targetRelay.targetSessionId !== source.session.id) {
          return rejectedMessage(messageId, replyLink, 'invalid-relay', 'the incoming window message targets another session')
        }
        if (args.target_link !== undefined) {
          try {
            if (parseWindowLink(args.target_link).sessionId !== targetRelay.sourceSessionId) {
              return rejectedMessage(messageId, replyLink, 'relay-target-denied', 'a relayed message may reply only to its source')
            }
          } catch {
            return rejectedMessage(messageId, args.target_link, 'invalid-link', 'target link could not be parsed')
          }
        }
        resolved = await directory.resolveReplySource(source, targetRelay.sourceSessionId, exec.signal)
        if (!('code' in resolved) && args.target_name !== undefined && resolved.window.title !== args.target_name.trim()) {
          const named = await directory.resolve(source, { targetName: args.target_name }, exec.signal)
          if (!('code' in named)) {
            return rejectedMessage(messageId, replyLink, 'relay-target-denied',
              'a relayed message may reply only to its source; reply without target_name and the trusted source is used automatically')
          }
        }
        conversationId = targetRelay.conversationId
        teamId = targetRelay.teamId
        taskId = targetRelay.taskId
        if (reportsTask) {
          const taskAssignment = assignment
          if (taskAssignment === undefined) {
            return rejectedMessage(messageId, replyLink, 'task-report-without-assignment',
              'task_outcome requires a trusted team-task assignment')
          }
          if (args.task_outcome === undefined) {
            return rejectedMessage(messageId, replyLink, 'task-outcome-required',
              'failure_kind requires task_outcome')
          }
          if (args.task_outcome === 'failed' && args.failure_kind === undefined) {
            return rejectedMessage(messageId, replyLink, 'missing-failure-kind',
              'failed task outcomes require failure_kind technical or work')
          }
          if (args.task_outcome === 'completed' && args.failure_kind !== undefined) {
            return rejectedMessage(messageId, replyLink, 'unexpected-failure-kind',
              'completed task outcomes cannot include failure_kind')
          }
          teamId = taskAssignment.teamId
          taskId = taskAssignment.taskId
          if ('code' in resolved) return rejectedMessage(messageId, resolved.targetLink, resolved.code, resolved.message)
          teamReportRequest = {
            source,
            leader: resolved.agent,
            teamId: taskAssignment.teamId,
            taskId: taskAssignment.taskId,
            outcome: args.task_outcome,
            message: args.message,
            ...(args.failure_kind === undefined ? {} : { failureKind: args.failure_kind }),
          }
        }
      }

      if ('code' in resolved) return rejectedMessage(messageId, resolved.targetLink, resolved.code, resolved.message)
      const fingerprint = JSON.stringify([
        String(resolved.window.sessionId), args.message, conversationId, teamId ?? null, taskId ?? null,
        args.task_outcome ?? null, args.failure_kind ?? null,
      ])
      return ledger.run(messageId, fingerprint, resolved.targetLink, async () => {
        const teamReport = teamReportRequest === undefined
          ? undefined
          : await recordTeamTaskReport({
              ...teamReportRequest,
              coordinator,
              scheduler,
              signal: exec.signal,
            })
        if (teamReport?.status === 'rejected') {
          // A member replying to an ordinary (task-less) window message sometimes
          // carries task_outcome out of habit after its team task completed.
          // Refusing would swallow the reply, so deliver it as an ordinary reply
          // instead of a duplicate task report. Task state stays untouched and the
          // delivery ledger still deduplicates exact retries.
          if (teamReport.code === 'task-completed' && relay !== undefined && relay.taskId === undefined) {
            const fallback = await deliverWindowMessage({
              target: resolved.agent,
              messageId,
              conversationId: relay.conversationId,
              sourceSessionId: source.session.id,
              sourceName: foldSessionTitle(sourceEvents)?.title ?? 'conversation window',
              targetSessionId: resolved.window.sessionId,
              message: args.message,
              signal: exec.signal,
            })
            return fallback.status === 'accepted'
              ? {
                  ...fallback,
                  code: 'delivered-as-reply',
                  message: 'the last team task is already completed; the message was delivered as an ordinary reply without task_outcome',
                }
              : fallback
          }
          return rejectedMessage(messageId, resolved.targetLink, teamReport.code, teamReport.message)
        }
        const result = await deliverWindowMessage({
          target: resolved.agent,
          messageId,
          conversationId,
          ...(teamId === undefined ? {} : { teamId }),
          ...(taskId === undefined ? {} : { taskId }),
          sourceSessionId: source.session.id,
          sourceName: foldSessionTitle(sourceEvents)?.title ?? 'conversation window',
          targetSessionId: resolved.window.sessionId,
          message: args.message,
          signal: exec.signal,
        })
        return teamReport === undefined || result.status !== 'accepted'
          ? result
          : { ...result, message: `${result.message}; team task ${teamReport.task?.status ?? 'updated'}` }
      })
    },
  })
}

/** Build several visible role windows and schedule dependency-ready first tasks. */
export function createWindowTeamTool(
  config: ResolvedConfig,
  provisioner: Pick<ConversationWindowProvisioner, 'create'>,
  directory: ConversationWindowDirectory,
  coordinator: WindowTeamCoordinator,
  scheduler: WindowTeamScheduler,
  workspaceRegistry: Pick<WorkspaceRegistry, 'resolveByPath'>,
) {
  return defineTool({
    name: 'create_window_team',
    description:
      'Create or reuse several ordinary DSH conversation windows and schedule one atomic dependency graph. The current conversation is the leader. For multi-step work, put every known step in members[].tasks in this call instead of adding tasks one by one. Exact existing titles are reused; ambiguous titles are rejected. Ready tasks start automatically. Use only for a direct user request.',
    parameters: {
      team_goal: { type: 'string', required: true, description: 'Shared outcome the team must complete.' },
      leader_role: { type: 'string', required: true, description: 'Role of the current conversation, such as product lead.' },
      members: {
        type: 'array',
        required: true,
        description: 'One to several independently visible role windows.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true, description: 'Unique displayed conversation title.' },
            role: { type: 'string', required: true, description: 'Responsibility owned by this window.' },
            task: { type: 'string', description: 'One-task shorthand. Omit when tasks is provided.' },
            task_id: { type: 'string', description: 'Stable id for the one-task shorthand.' },
            task_title: { type: 'string', description: 'Short label for the one-task shorthand.' },
            depends_on: {
              type: 'array',
              description: 'Dependencies for the one-task shorthand.',
              items: { type: 'string' },
            },
            max_attempts: {
              type: 'number',
              description: 'Attempt limit for the one-task shorthand.',
            },
            tasks: {
              type: 'array',
              description: 'Complete tasks owned by this window. Use this for ordered multi-step work and declare the whole graph in one call.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  task: { type: 'string', required: true, description: 'Exact self-contained work instruction.' },
                  task_id: { type: 'string', description: 'Stable 2-64 character id used by dependencies.' },
                  task_title: { type: 'string', description: 'Short task label shown in the team panel.' },
                  depends_on: {
                    type: 'array',
                    description: 'Any task ids in this same team graph that must complete first.',
                    items: { type: 'string' },
                  },
                  max_attempts: {
                    type: 'number',
                    description: 'Bounded technical attempts, up to the configured maximum.',
                  },
                },
              },
            },
          },
        },
      },
    },
    output: {
      schema: teamResultSchema,
      render: (_args, value) => [{ type: 'text', text: renderTeamResult(value) }],
    },
    timeoutMs: config.requestTimeoutMs,
    async execute(args, exec) {
      const teamId = `team-${randomUUID()}`
      const source = sourceAgent(exec)
      if ('code' in source) return rejectedTeam(teamId, source.code, source.message)
      const sourceEvents = source.session.snapshotEvents()
      if (currentTurnDirectMessages(sourceEvents).length === 0) {
        return rejectedTeam(teamId, 'missing-direct-message', 'team creation requires a direct user request in this turn')
      }
      const normalizedMembers = args.members.map((member, index) => normalizeMemberRequest(member, index, config))
      const validation = validateTeamRequest(args.team_goal, args.leader_role, normalizedMembers, config)
      if (validation !== undefined) return rejectedTeam(teamId, validation.code, validation.message)

      const existing = await directory.listFor(source, exec.signal)
      for (const member of normalizedMembers) {
        const matches = existing.filter(window => window.title === member.name)
        if (matches.length > 1) {
          return rejectedTeam(teamId, 'target-name-ambiguous',
            `more than one conversation is named ${JSON.stringify(member.name)}; rename the intended window or choose a unique new name`)
        }
      }

      const sourceTitle = foldSessionTitle(sourceEvents)?.title ?? 'team leader'
      const workspace = source.session.header.cwd === undefined
        ? undefined
        : await workspaceRegistry.resolveByPath(source.session.header.cwd)
      const outcomes: TeamMemberResult[] = []
      const members: WindowTeamMember[] = []
      const tasks: WindowTeamTask[] = []
      for (const member of normalizedMembers) {
        exec.signal.throwIfAborted()
        const existingWindow = existing.find(window => window.title === member.name)
        let memberId = existingWindow?.sessionId ?? SessionId(`session-${randomUUID()}`)
        let targetLink = serializeWindowLink(memberId)
        let createdWindow: ProvisionedConversationWindow | undefined
        let reused = false
        try {
          if (existingWindow === undefined) {
            if (source.session.header.cwd === undefined) {
              throw new Error('the leader conversation has no working directory')
            }
            createdWindow = await provisioner.create({
              source,
              title: member.name,
              cwd: source.session.header.cwd,
              ...(workspace === undefined ? {} : { workspace }),
              signal: exec.signal,
            })
            memberId = createdWindow.sessionId
            targetLink = serializeWindowLink(memberId)
          } else {
            const resolved = await directory.resolve(source, { targetLink }, exec.signal)
            if ('code' in resolved) throw new Error(resolved.message)
            memberId = resolved.window.sessionId
            targetLink = resolved.targetLink
            reused = true
          }
          if (workspace !== undefined && existingWindow !== undefined) {
            await workspace.attachSession(memberId)
          }
          members.push({ sessionId: String(memberId), name: member.name, role: member.role, created: true })
          tasks.push(...member.tasks.map(task => teamTask(member, task, memberId, true)))
          const firstTask = member.tasks[0]
          if (firstTask === undefined) throw new Error('validated member has no tasks')
          outcomes.push({
            name: member.name,
            role: member.role,
            status: reused ? 'reused' : 'created',
            targetLink,
            code: reused ? 'reused' : 'created',
            message: reused ? 'the existing exact-title window joined the team' : 'the role window was created and named',
            taskId: firstTask.taskId,
            taskStatus: firstTask.dependsOn.length === 0 ? 'ready' : 'blocked',
          })
        } catch (error: unknown) {
          const message = renderError(error)
          members.push({ sessionId: String(memberId), name: member.name, role: member.role, created: false })
          tasks.push(...member.tasks.map(task => ({ ...teamTask(member, task, memberId, false), note: message })))
          const firstTask = member.tasks[0]
          if (firstTask === undefined) throw new Error('validated member has no tasks')
          outcomes.push({
            name: member.name,
            role: member.role,
            status: 'failed',
            targetLink,
            code: 'create-failed',
            message,
            taskId: firstTask.taskId,
            taskStatus: 'failed',
          })
        }
      }
      const ready = outcomes.filter(outcome => outcome.status !== 'failed').length
      if (ready > 0) {
        const state = refreshTaskReadiness({
          teamId,
          revision: 1,
          goal: args.team_goal.trim(),
          leaderSessionId: String(source.session.id),
          leaderName: sourceTitle,
          leaderRole: args.leader_role.trim(),
          members,
          tasks,
        })
        await coordinator.run(source.session, () => { appendWindowTeamState(source.session, state) })
        await scheduler.run(source, exec.signal)
      }
      const latest = coordinator.current(source.session)
      const latestTasks = latest?.teamId === teamId ? latest.tasks : tasks
      const renderedOutcomes = outcomes.map(outcome => ({
        ...outcome,
        taskStatus: latestTasks.find(task => task.id === outcome.taskId)?.status ?? outcome.taskStatus,
      }))
      const status: WindowTeamResult['status'] = ready === outcomes.length
        ? 'accepted'
        : ready === 0 ? 'rejected' : 'partial'
      const created = outcomes.filter(outcome => outcome.status === 'created').length
      const reused = outcomes.filter(outcome => outcome.status === 'reused').length
      return {
        status,
        teamId,
        code: ready === outcomes.length ? 'team-created' : ready === 0 ? 'team-failed' : 'team-partial',
        message: `${String(created)} role window(s) created and ${String(reused)} reused; dependency-ready tasks were scheduled`,
        members: renderedOutcomes,
        tasks: latestTasks,
      }
    },
  })
}

/** Add one dependency-aware task to the current leader's window team. */
export function createAddWindowTaskTool(
  config: ResolvedConfig,
  directory: ConversationWindowDirectory,
  coordinator: WindowTeamCoordinator,
  scheduler: WindowTeamScheduler,
) {
  return defineTool({
    name: 'add_window_task',
    description:
      'Add one new task after a window team already exists. Do not use this to build a graph known during create_window_team; put that graph in members[].tasks instead. Address the owner window with its target_link, or a title only when exactly one window has that title. Optional dependencies. Ready work starts automatically. Use only for a direct user request.',
    parameters: {
      target_link: { type: 'string', description: 'Canonical dsh://session/... link of the owner window from the directory. Prefer this.' },
      target_name: { type: 'string', description: 'Optional fallback by exact displayed title, only when exactly one window has that title.' },
      title: { type: 'string', required: true, description: 'Short task label shown in the team panel.' },
      task: { type: 'string', required: true, description: 'Exact self-contained work instruction.' },
      task_id: { type: 'string', description: 'Stable 2-64 character id; omit to generate one.' },
      depends_on: { type: 'array', description: 'Existing task ids that must complete first.', items: { type: 'string' } },
      owner_role: { type: 'string', description: 'Role used if the target window is new to this team.' },
      max_attempts: { type: 'number', description: 'Bounded technical attempts, up to the configured maximum.' },
    },
    output: {
      schema: teamMutationResultSchema,
      render: (_args, value) => [{ type: 'text', text: renderTeamMutationResult(value) }],
    },
    timeoutMs: config.requestTimeoutMs,
    async execute(args, exec) {
      const source = sourceAgent(exec)
      if ('code' in source) return rejectedMutation('', source.code, source.message)
      if (currentTurnDirectMessages(source.session.snapshotEvents()).length === 0) {
        return rejectedMutation('', 'missing-direct-message', 'adding a team task requires a direct user request')
      }
      const state = coordinator.current(source.session)
      if (state === null) return rejectedMutation('', 'no-team', 'the current window has no team')
      const taskId = args.task_id?.trim() || `task-${randomUUID()}`
      const validation = validateNewTask(state, taskId, args.title, args.task, args.depends_on ?? [], args.max_attempts, config)
      if (validation !== undefined) return rejectedMutation(state.teamId, validation.code, validation.message)
      const resolved = await directory.resolve(source, {
        ...(args.target_name === undefined ? {} : { targetName: args.target_name }),
        ...(args.target_link === undefined ? {} : { targetLink: args.target_link }),
      }, exec.signal)
      if ('code' in resolved) return rejectedMutation(state.teamId, resolved.code, resolved.message)
      const ownerName = resolved.window.title ?? args.target_name?.trim() ?? ''
      const ownerSessionId = String(resolved.window.sessionId)
      await coordinator.run(source.session, () => {
        const current = coordinator.current(source.session)
        if (current === null || current.teamId !== state.teamId) throw new Error('window team changed while adding the task')
        const members = current.members.some(member => member.sessionId === ownerSessionId)
          ? current.members
          : [...current.members, {
            sessionId: ownerSessionId,
            name: ownerName,
            role: args.owner_role?.trim() || 'team member',
            created: true,
          }]
        const task: WindowTeamTask = {
          id: taskId,
          title: args.title.trim(),
          instruction: args.task.trim(),
          ownerSessionId,
          ownerName,
          dependsOn: uniqueStrings(args.depends_on ?? []),
          status: 'blocked',
          attempts: 0,
          maxAttempts: args.max_attempts ?? config.maxTaskAttempts,
          note: null,
          failureKind: null,
        }
        appendWindowTeamState(source.session, nextWindowTeamState(current, {
          ...current,
          members,
          tasks: [...current.tasks, task],
        }))
      })
      const schedule = await scheduler.run(source, exec.signal)
      const task = coordinator.current(source.session)?.tasks.find(candidate => candidate.id === taskId) ?? null
      return acceptedMutation(state.teamId, 'task-added', 'the task was added and ready work was scheduled', task, schedule)
    },
  })
}

/** Final team-task result carried by one trusted reply. */
interface TeamTaskReportRequest {
  readonly source: Agent
  readonly leader: Agent
  readonly teamId: string
  readonly taskId: string
  readonly outcome: 'completed' | 'failed'
  readonly message: string
  readonly failureKind?: WindowTeamFailureKind
}

/** Record one member result and schedule work released by that result. */
async function recordTeamTaskReport(
  request: TeamTaskReportRequest & {
    readonly coordinator: WindowTeamCoordinator
    readonly scheduler: WindowTeamScheduler
    readonly signal: AbortSignal
  },
): Promise<WindowTeamMutationResult> {
  const before = request.coordinator.current(request.leader.session)
  if (before === null) return rejectedMutation(request.teamId, 'no-team', 'the leader window has no team')
  if (request.teamId !== before.teamId) {
    return rejectedMutation(before.teamId, 'team-mismatch', 'the assignment belongs to another team')
  }
  let updated: WindowTeamTask | null = null
  try {
    await request.coordinator.run(request.leader.session, () => {
      const state = request.coordinator.current(request.leader.session)
      if (state === null || state.teamId !== before.teamId) throw new Error('window team changed while recording a result')
      const task = state.tasks.find(candidate => candidate.id === request.taskId)
      if (task === undefined) throw new TeamMutationError('task-not-found', 'the team has no assigned task for this result')
      if (task.ownerSessionId !== String(request.source.session.id)) {
        throw new TeamMutationError('task-owner-mismatch', 'only the assigned member can report this task result')
      }
      if (task.status === 'completed') {
        throw new TeamMutationError('task-completed',
          'the task is already completed; if this is an ordinary window reply, resend it without task_outcome')
      }
      const failureKind = request.outcome === 'failed' ? request.failureKind ?? null : null
      const retry = failureKind === 'technical' && task.attempts < task.maxAttempts
      updated = {
        ...task,
        status: request.outcome === 'completed' ? 'completed' : retry ? 'ready' : 'failed',
        note: request.message.trim(),
        failureKind,
      }
      appendWindowTeamState(request.leader.session, nextWindowTeamState(state, {
        ...state,
        tasks: state.tasks.map(candidate => candidate.id === task.id ? updated as WindowTeamTask : candidate),
      }))
    })
  } catch (error: unknown) {
    if (error instanceof TeamMutationError) return rejectedMutation(before.teamId, error.code, error.message)
    throw error
  }
  if (updated === null) {
    return rejectedMutation(before.teamId, 'task-update-rejected', 'the task result was rejected')
  }
  const schedule = await request.scheduler.run(request.leader, request.signal)
  const latest = request.coordinator.current(request.leader.session)?.tasks.find(task => task.id === request.taskId) ?? updated
  return acceptedMutation(before.teamId, 'task-reported', 'the result was sent and dependencies were rescheduled', latest, schedule)
}

/** Move one non-running task to another visible conversation by title. */
export function createReassignWindowTaskTool(
  config: ResolvedConfig,
  directory: ConversationWindowDirectory,
  coordinator: WindowTeamCoordinator,
  scheduler: WindowTeamScheduler,
) {
  return defineTool({
    name: 'reassign_window_task',
    description:
      'Manually move a blocked, ready, or failed team task to another visible conversation. Running and completed work is not silently duplicated. Address the new owner with its target_link, or a title only when exactly one window has that title. Use only for a direct user request.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'Exact task id to move.' },
      target_link: { type: 'string', description: 'Canonical dsh://session/... link of the new owner window from the directory. Prefer this.' },
      target_name: { type: 'string', description: 'Optional fallback by exact displayed title, only when exactly one window has that title.' },
      owner_role: { type: 'string', description: 'Role used if the target is new to this team.' },
    },
    output: {
      schema: teamMutationResultSchema,
      render: (_args, value) => [{ type: 'text', text: renderTeamMutationResult(value) }],
    },
    timeoutMs: config.requestTimeoutMs,
    async execute(args, exec) {
      const source = sourceAgent(exec)
      if ('code' in source) return rejectedMutation('', source.code, source.message)
      if (currentTurnDirectMessages(source.session.snapshotEvents()).length === 0) {
        return rejectedMutation('', 'missing-direct-message', 'task reassignment requires a direct user request')
      }
      const before = coordinator.current(source.session)
      if (before === null) return rejectedMutation('', 'no-team', 'the current window has no team')
      const resolved = await directory.resolve(source, {
        ...(args.target_name === undefined ? {} : { targetName: args.target_name }),
        ...(args.target_link === undefined ? {} : { targetLink: args.target_link }),
      }, exec.signal)
      if ('code' in resolved) return rejectedMutation(before.teamId, resolved.code, resolved.message)
      const ownerSessionId = String(resolved.window.sessionId)
      const ownerName = resolved.window.title ?? args.target_name?.trim() ?? ''
      let updated: WindowTeamTask | null = null
      try {
        await coordinator.run(source.session, () => {
          const state = coordinator.current(source.session)
          if (state === null || state.teamId !== before.teamId) throw new Error('window team changed while reassigning the task')
          const task = state.tasks.find(candidate => candidate.id === args.task_id.trim())
          if (task === undefined) throw new TeamMutationError('task-not-found', 'the team has no task with that id')
          if (task.status === 'running' || task.status === 'queued') {
            throw new TeamMutationError('task-running', 'running work cannot be reassigned without first reaching a settled state')
          }
          if (task.status === 'completed') throw new TeamMutationError('task-completed', 'completed work is not reassigned')
          updated = {
            ...task,
            ownerSessionId,
            ownerName,
            status: 'blocked',
            attempts: 0,
            note: null,
            failureKind: null,
          }
          const members = state.members.some(member => member.sessionId === ownerSessionId)
            ? state.members
            : [...state.members, {
              sessionId: ownerSessionId,
              name: ownerName,
              role: args.owner_role?.trim() || 'team member',
              created: true,
            }]
          appendWindowTeamState(source.session, nextWindowTeamState(state, {
            ...state,
            members,
            tasks: state.tasks.map(candidate => candidate.id === task.id ? updated as WindowTeamTask : candidate),
          }))
        })
      } catch (error: unknown) {
        if (error instanceof TeamMutationError) return rejectedMutation(before.teamId, error.code, error.message)
        throw error
      }
      const schedule = await scheduler.run(source, exec.signal)
      const latest = coordinator.current(source.session)?.tasks.find(task => task.id === args.task_id.trim()) ?? updated
      return acceptedMutation(before.teamId, 'task-reassigned', 'the task owner changed and ready work was scheduled', latest, schedule)
    },
  })
}

/** List the leader-owned team state for natural-language coordination. */
export function createListWindowTeamTool(
  config: ResolvedConfig,
  directory: ConversationWindowDirectory,
  coordinator: WindowTeamCoordinator,
) {
  return defineTool({
    name: 'list_window_team',
    description: 'List the current window team, task ids, owners, dependencies, attempts, and states.',
    parameters: {},
    output: {
      schema: windowTeamListResultSchema,
      render: (_args, value) => [{ type: 'text', text: renderWindowTeamListResult(value) }],
    },
    timeoutMs: config.requestTimeoutMs,
    async execute(_args, exec) {
      const source = sourceAgent(exec)
      if ('code' in source) return { status: 'rejected' as const, code: source.code, message: source.message, team: null }
      let team = coordinator.current(source.session)
      if (team === null) {
        const assignment = latestTeamTaskAssignment(source.session.snapshotEvents())
        if (assignment !== undefined) {
          const resolved = await directory.resolveReplySource(source, assignment.sourceSessionId, exec.signal)
          if (!('code' in resolved)) team = coordinator.current(resolved.agent.session)
        }
      }
      if (team === null) return { status: 'empty' as const, code: 'no-team', message: 'this window has no team', team: null }
      return { status: 'ok' as const, code: 'listed', message: `${String(team.tasks.length)} task(s) in the current team`, team }
    },
  })
}

/** Register the stateless directory, direct routing, team creation, and optional model context. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = config as ResolvedConfig
  for (const [setting, value] of Object.entries(resolved)) assertPositiveInteger(setting, value)
  const ledger = new DeliveryLedger(resolved.maxRememberedMessages)
  const directory = new ConversationWindowDirectory(ctx.agents, ctx.sessionPersistence, ctx.sessionController)
  const provisioner = new ConversationWindowProvisioner(
    ctx.sessionController,
    windowConversationHost(ctx.get('productHost')),
  )
  const coordinator = new WindowTeamCoordinator()
  const scheduler = new WindowTeamScheduler({
    taskRetryDelayMs: resolved.taskRetryDelayMs,
  }, directory, coordinator)
  await directory.refresh()

  ctx.effect(() => {
    const disposers = [
      ctx.sessionProjections.register(windowTeamProjectionDefinition),
      ctx.tools.register(createListConversationWindowsTool(resolved, directory)),
      ctx.tools.register(createWindowMessageTool(resolved, directory, ledger, coordinator, scheduler)),
      ctx.tools.register(createWindowTeamTool(
        resolved,
        provisioner,
        directory,
        coordinator,
        scheduler,
        ctx.workspaceRegistry,
      )),
      ctx.tools.register(createListWindowTeamTool(resolved, directory, coordinator)),
      ctx.tools.register(createAddWindowTaskTool(resolved, directory, coordinator, scheduler)),
      ctx.tools.register(createReassignWindowTaskTool(resolved, directory, coordinator, scheduler)),
    ]
    return async () => {
      for (const dispose of disposers.reverse()) dispose()
      await scheduler.dispose()
      coordinator.clear()
      ledger.clear()
      directory.clear()
    }
  }, 'session-teams: conversation directory and team tools')

  const restoreTeam = async (agent: Agent): Promise<void> => {
    const team = coordinator.current(agent.session)
    if (team === null || team.leaderSessionId !== String(agent.session.id)) return
    const workspace = agent.session.header.cwd === undefined
      ? undefined
      : await ctx.workspaceRegistry.resolveByPath(agent.session.header.cwd)
    if (workspace !== undefined) {
      const knownWindows = new Set(directory.currentFor(agent).map(window => String(window.sessionId)))
      for (const member of team.members) {
        if (member.created && knownWindows.has(member.sessionId)) {
          await workspace.attachSession(SessionId(member.sessionId))
        }
      }
    }
    const queued = team.tasks.some(task => task.status === 'queued')
    if (queued) {
      appendWindowTeamState(agent.session, nextWindowTeamState(team, {
        ...team,
        tasks: team.tasks.map(task => task.status === 'queued'
          ? { ...task, status: 'ready' as const, note: 'recovered after plugin restart', failureKind: 'technical' as const }
          : task),
      }))
    }
    await scheduler.run(agent)
  }

  for (const agent of ctx.agents.roots()) {
    await restoreTeam(agent)
  }

  ctx.on('agent/created', ({ agent }) => {
    void restoreTeam(agent).catch((error: unknown) => {
      ctx.logger('session-teams').warn('failed to restore team workspace membership: %s', renderError(error))
    })
  })

  ctx.on('agent/disposed', () => {
    void directory.refresh().catch(() => undefined)
  })

  ctx.inject(['systemPrompt'], (promptCtx: Context & { systemPrompt: SystemPrompt }) => {
    promptCtx.systemPrompt.context({
      name: 'session-teams:directory',
      order: 125,
      text: context => context.agent === undefined
        ? ''
        : [
          directory.renderModelContext(context.agent, resolved.maxDirectoryEntries),
          renderTeamModelContext(coordinator.current(context.agent.session)),
        ].filter(Boolean).join('\n\n'),
    })
  })
}

/** Canonical source-session selector for integrations without the browser entry. */
export { serializeWindowLink as linkForSession }

function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Validate a team request before creating any window. */
function validateTeamRequest(
  teamGoal: string,
  leaderRole: string,
  members: readonly NormalizedTeamMemberRequest[],
  config: ResolvedConfig,
): { readonly code: string; readonly message: string } | undefined {
  if (teamGoal.trim().length === 0 || leaderRole.trim().length === 0) {
    return { code: 'invalid-team', message: 'team_goal and leader_role must contain visible text' }
  }
  if (teamGoal.length > config.maxTaskChars) {
    return { code: 'team-goal-too-large', message: 'team_goal exceeds the configured message limit' }
  }
  if (members.length === 0 || members.length > config.maxTeamMembers) {
    return { code: 'invalid-team-size', message: `members must contain 1-${String(config.maxTeamMembers)} role windows` }
  }
  const names = new Set<string>()
  const taskIds = new Set<string>()
  for (const member of members) {
    const name = member.name
    if (name.length === 0 || member.role.length === 0 || member.tasks.length === 0) {
      return { code: 'invalid-member', message: 'each member needs a visible name, role, and at least one task' }
    }
    if (names.has(name)) return { code: 'duplicate-member-name', message: `member name ${JSON.stringify(name)} is repeated` }
    names.add(name)
    for (const task of member.tasks) {
      if (task.task.length === 0 || task.taskTitle.length === 0 || task.task.length > config.maxTaskChars) {
        return { code: 'invalid-task', message: `every task for ${JSON.stringify(name)} needs visible text within the configured message limit` }
      }
      if (!TASK_ID_PATTERN.test(task.taskId)) {
        return { code: 'invalid-task-id', message: `task id ${JSON.stringify(task.taskId)} must use 2-64 safe characters` }
      }
      if (taskIds.has(task.taskId)) return { code: 'duplicate-task-id', message: `task id ${JSON.stringify(task.taskId)} is repeated` }
      if (!Number.isSafeInteger(task.maxAttempts) || task.maxAttempts <= 0 || task.maxAttempts > config.maxTaskAttempts) {
        return { code: 'invalid-max-attempts', message: `max_attempts must be between 1 and ${String(config.maxTaskAttempts)}` }
      }
      taskIds.add(task.taskId)
    }
  }
  const tasks = members.flatMap(member => member.tasks)
  if (tasks.length > config.maxTeamTasks) {
    return { code: 'team-task-limit', message: `the complete graph exceeds the configured ${String(config.maxTeamTasks)} task limit` }
  }
  for (const task of tasks) {
    if (task.dependsOn.length !== uniqueStrings(task.dependsOn).length) {
      return { code: 'duplicate-dependency', message: `task ${JSON.stringify(task.taskId)} repeats a dependency` }
    }
    for (const dependency of task.dependsOn) {
      if (!taskIds.has(dependency)) {
        return { code: 'unknown-dependency', message: `task ${JSON.stringify(task.taskId)} depends on unknown task ${JSON.stringify(dependency)}` }
      }
      if (dependency === task.taskId) {
        return { code: 'self-dependency', message: `task ${JSON.stringify(task.taskId)} cannot depend on itself` }
      }
    }
  }
  if (hasDependencyCycle(tasks.map(task => ({ id: task.taskId, dependsOn: task.dependsOn })))) {
    return { code: 'dependency-cycle', message: 'task dependencies must not contain a cycle' }
  }
  return undefined
}

/** Return a team refusal before any window is created. */
function rejectedTeam(teamId: string, code: string, message: string): WindowTeamResult {
  return { status: 'rejected', teamId, code, message, members: [], tasks: [] }
}

/** Error with a stable model-facing mutation code. */
class TeamMutationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'TeamMutationError'
  }
}

/** Normalize optional task fields before request-wide validation. */
function normalizeMemberRequest(
  member: TeamMemberRequest,
  index: number,
  config: ResolvedConfig,
): NormalizedTeamMemberRequest {
  const hasShorthand = member.task !== undefined
    || member.task_id !== undefined
    || member.task_title !== undefined
    || member.depends_on !== undefined
    || member.max_attempts !== undefined
  const requests: readonly TeamTaskRequest[] = member.tasks === undefined
    ? hasShorthand ? [{
      task: member.task ?? '',
      ...(member.task_id === undefined ? {} : { task_id: member.task_id }),
      ...(member.task_title === undefined ? {} : { task_title: member.task_title }),
      ...(member.depends_on === undefined ? {} : { depends_on: member.depends_on }),
      ...(member.max_attempts === undefined ? {} : { max_attempts: member.max_attempts }),
    }] : []
    : hasShorthand ? [] : member.tasks
  return {
    name: member.name.trim(),
    role: member.role.trim(),
    tasks: requests.map((task, taskIndex) => ({
      task: task.task.trim(),
      taskId: task.task_id?.trim() || (member.tasks === undefined
        ? `task-${String(index + 1)}`
        : `task-${String(index + 1)}-${String(taskIndex + 1)}`),
      taskTitle: task.task_title?.trim() || shortTaskTitle(task.task, taskIndex),
      dependsOn: task.depends_on?.map(value => value.trim()) ?? [],
      maxAttempts: task.max_attempts ?? config.maxTaskAttempts,
    })),
  }
}

/** Build one task for a newly created, reused, or failed role window. */
function teamTask(
  member: NormalizedTeamMemberRequest,
  task: NormalizedTeamTaskRequest,
  memberId: SessionId,
  created: boolean,
): WindowTeamTask {
  return {
    id: task.taskId,
    title: task.taskTitle,
    instruction: task.task,
    ownerSessionId: String(memberId),
    ownerName: member.name,
    dependsOn: [...task.dependsOn],
    status: created ? 'blocked' : 'failed',
    attempts: 0,
    maxAttempts: task.maxAttempts,
    note: null,
    failureKind: created ? null : 'technical',
  }
}

/** Keep generated task labels readable in the compact team panel. */
function shortTaskTitle(instruction: string, index: number): string {
  const compact = instruction.trim().replace(/\s+/gu, ' ')
  if (compact.length === 0) return `Task ${String(index + 1)}`
  return compact.length <= 72 ? compact : `${compact.slice(0, 69)}...`
}

/** Preserve order while removing repeated exact values. */
function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()))]
}

/** Detect a dependency cycle in a closed task graph. */
function hasDependencyCycle(tasks: readonly { readonly id: string; readonly dependsOn: readonly string[] }[]): boolean {
  const dependencies = new Map(tasks.map(task => [task.id, task.dependsOn] as const))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const dependency of dependencies.get(id) ?? []) {
      if (dependencies.has(dependency) && visit(dependency)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }
  return tasks.some(task => visit(task.id))
}

/** Validate one new task against the current closed team graph. */
function validateNewTask(
  state: WindowTeamProjection,
  taskId: string,
  title: string,
  instruction: string,
  dependsOn: readonly string[],
  maxAttempts: number | undefined,
  config: ResolvedConfig,
): { readonly code: string; readonly message: string } | undefined {
  if (state.tasks.length >= config.maxTeamTasks) {
    return { code: 'team-task-limit', message: `the team already has the configured ${String(config.maxTeamTasks)} task limit` }
  }
  if (!TASK_ID_PATTERN.test(taskId)) return { code: 'invalid-task-id', message: 'task_id must use 2-64 safe characters' }
  if (state.tasks.some(task => task.id === taskId)) return { code: 'duplicate-task-id', message: 'the team already has that task id' }
  if (title.trim().length === 0 || instruction.trim().length === 0 || instruction.length > config.maxTaskChars) {
    return { code: 'invalid-task', message: 'title and task must contain visible text within the configured message limit' }
  }
  const attempts = maxAttempts ?? config.maxTaskAttempts
  if (!Number.isSafeInteger(attempts) || attempts <= 0 || attempts > config.maxTaskAttempts) {
    return { code: 'invalid-max-attempts', message: `max_attempts must be between 1 and ${String(config.maxTaskAttempts)}` }
  }
  const normalizedDependencies = dependsOn.map(value => value.trim())
  if (normalizedDependencies.some(value => value.length === 0)) {
    return { code: 'invalid-dependency', message: 'dependency task ids must contain visible text' }
  }
  if (uniqueStrings(normalizedDependencies).length !== normalizedDependencies.length) {
    return { code: 'duplicate-dependency', message: 'depends_on repeats a task id' }
  }
  if (normalizedDependencies.includes(taskId)) return { code: 'self-dependency', message: 'a task cannot depend on itself' }
  const known = new Set(state.tasks.map(task => task.id))
  const unknown = normalizedDependencies.find(id => !known.has(id))
  if (unknown !== undefined) return { code: 'unknown-dependency', message: `unknown dependency ${JSON.stringify(unknown)}` }
  return undefined
}

/** Return a successful mutation result. */
function acceptedMutation(
  teamId: string,
  code: string,
  message: string,
  task: WindowTeamTask | null,
  schedule: WindowTeamScheduleResult,
): WindowTeamMutationResult {
  return { status: 'accepted', teamId, code, message, task, schedule }
}

/** Return a rejected mutation result without a scheduler side effect. */
function rejectedMutation(teamId: string, code: string, message: string): WindowTeamMutationResult {
  return { status: 'rejected', teamId, code, message, task: null, schedule: { started: [], failed: [] } }
}

/** Describe leader-owned task state to the model without exposing internal Session ids. */
function renderTeamModelContext(team: WindowTeamProjection | null): string {
  if (team === null) return ''
  return [
    '# Window team',
    `You lead the visible window team ${JSON.stringify(team.goal)} as ${team.leaderRole}.`,
    'Use list_window_team for exact task ids and states. Ready tasks are dispatched automatically after dependencies complete.',
    'Use add_window_task or reassign_window_task only when the user directly asks for coordination changes.',
    `Current task summary: ${team.tasks.map(task => `${task.id}=${task.status}@${task.ownerName}`).join(', ')}`,
  ].join('\n')
}

const messageResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true, enum: ['accepted', 'rejected'] },
    messageId: { type: 'string', required: true },
    targetLink: { type: 'string', required: true },
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
  },
} as const

const windowListResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true, enum: ['ok', 'rejected'] },
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
    windows: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          state: { type: 'string', required: true, enum: ['working', 'available'] },
          targetLink: { type: 'string', required: true },
        },
      },
    },
  },
} as const

const taskResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    instruction: { type: 'string', required: true },
    ownerSessionId: { type: 'string', required: true },
    ownerName: { type: 'string', required: true },
    dependsOn: { type: 'array', required: true, items: { type: 'string' } },
    status: { type: 'string', required: true, enum: ['blocked', 'ready', 'queued', 'running', 'completed', 'failed'] },
    attempts: { type: 'number', required: true },
    maxAttempts: { type: 'number', required: true },
    note: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    failureKind: { oneOf: [{ type: 'string', enum: ['technical', 'work'] }, { type: 'null' }], required: true },
  },
} as const

const memberResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string', required: true },
    name: { type: 'string', required: true },
    role: { type: 'string', required: true },
    created: { type: 'boolean', required: true },
  },
} as const

const windowTeamSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    teamId: { type: 'string', required: true },
    revision: { type: 'number', required: true },
    goal: { type: 'string', required: true },
    leaderSessionId: { type: 'string', required: true },
    leaderName: { type: 'string', required: true },
    leaderRole: { type: 'string', required: true },
    members: { type: 'array', required: true, items: memberResultSchema },
    tasks: { type: 'array', required: true, items: taskResultSchema },
  },
} as const

const teamResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true, enum: ['accepted', 'partial', 'rejected'] },
    teamId: { type: 'string', required: true },
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
    members: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          role: { type: 'string', required: true },
          status: { type: 'string', required: true, enum: ['created', 'reused', 'failed'] },
          targetLink: { type: 'string', required: true },
          code: { type: 'string', required: true },
          message: { type: 'string', required: true },
          taskId: { type: 'string', required: true },
          taskStatus: { type: 'string', required: true, enum: ['blocked', 'ready', 'queued', 'running', 'completed', 'failed'] },
        },
      },
    },
    tasks: { type: 'array', required: true, items: taskResultSchema },
  },
} as const

const teamMutationResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true, enum: ['accepted', 'rejected'] },
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
    teamId: { type: 'string', required: true },
    task: { oneOf: [taskResultSchema, { type: 'null' }], required: true },
    schedule: {
      type: 'object',
      required: true,
      additionalProperties: false,
      properties: {
        started: { type: 'array', required: true, items: { type: 'string' } },
        failed: { type: 'array', required: true, items: { type: 'string' } },
      },
    },
  },
} as const

const windowTeamListResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true, enum: ['ok', 'empty', 'rejected'] },
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
    team: { oneOf: [windowTeamSchema, { type: 'null' }], required: true },
  },
} as const
