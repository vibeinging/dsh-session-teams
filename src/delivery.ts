/** Conversation-window message delivery and duplicate suppression. */
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  renderVisibleWindowMessage,
  serializeWindowLink,
  visibleWindowMessageSource,
  type WindowMessage,
} from './protocol.ts'

/** Stable tool result returned for every non-cancelled message attempt. */
export interface WindowTaskResult {
  /** Accepted means queued; rejected means definitely not queued. */
  readonly status: 'accepted' | 'rejected'
  /** Sender-selected correlation key. */
  readonly messageId: string
  /** Canonical destination link, or the refused raw input when it did not parse. */
  readonly targetLink: string
  /** Stable machine-readable outcome. */
  readonly code: string
  /** Short model-facing explanation. */
  readonly message: string
}

/** Public name matching conversation-window behavior. */
export type WindowMessageResult = WindowTaskResult

interface DeliveryRecord {
  readonly fingerprint: string
  readonly promise: Promise<WindowTaskResult>
  settled: boolean
}

/** Process-local duplicate suppression keyed by caller-visible message id. */
export class DeliveryLedger {
  readonly #records = new Map<string, DeliveryRecord>()

  /** @param maxEntries - Maximum retained pending and completed message ids. */
  constructor(private readonly maxEntries: number) {}

  /** Number of retained message ids, exposed for invariant-style tests. */
  get size(): number {
    return this.#records.size
  }

  /** Forget process-local receipts during plugin disposal. */
  clear(): void {
    this.#records.clear()
  }

  /** Run a delivery once for one message id and exact payload. */
  run(
    messageId: string,
    fingerprint: string,
    targetLink: string,
    deliver: () => Promise<WindowTaskResult>,
  ): Promise<WindowTaskResult> {
    const existing = this.#records.get(messageId)
    if (existing !== undefined) {
      if (existing.fingerprint === fingerprint) return existing.promise
      return Promise.resolve({
        status: 'rejected',
        messageId,
        targetLink,
        code: 'message-id-conflict',
        message: 'message_id was already used for a different target or message',
      })
    }
    this.#evictSettled()
    if (this.#records.size >= this.maxEntries) {
      return Promise.resolve({
        status: 'rejected',
        messageId,
        targetLink,
        code: 'ledger-capacity',
        message: 'too many deliveries are still pending; try again after they settle',
      })
    }
    const record: DeliveryRecord = {
      fingerprint,
      promise: Promise.resolve().then(deliver),
      settled: false,
    }
    this.#records.set(messageId, record)
    void record.promise.finally(() => { record.settled = true }).catch(() => undefined)
    return record.promise
  }

  /** Remove oldest completed receipts until a new record can fit. */
  #evictSettled(): void {
    if (this.#records.size < this.maxEntries) return
    for (const [messageId, record] of this.#records) {
      if (!record.settled) continue
      this.#records.delete(messageId)
      if (this.#records.size < this.maxEntries) return
    }
  }
}

/** Values for one already-resolved conversation-window delivery. */
export interface DeliverWindowMessageOptions extends WindowMessage {
  /** Exact live ordinary Agent selected by the directory. */
  readonly target: Agent
  /** Model messages steer current work; scheduled tasks open a distinct turn. */
  readonly delivery?: 'steer' | 'queue'
  /** Tool cancellation signal checked before the synchronous queue boundary. */
  readonly signal: AbortSignal
}

/** Deliver one versioned relay to one ordinary conversation window. */
export async function deliverWindowMessage(options: DeliverWindowMessageOptions): Promise<WindowTaskResult> {
  const targetLink = serializeWindowLink(options.targetSessionId)
  options.signal.throwIfAborted()
  const target = resolveTargetWindow(options.target, options.targetSessionId)
  if ('code' in target) {
    return {
      status: 'rejected',
      messageId: options.messageId,
      targetLink,
      code: target.code,
      message: target.message,
    }
  }
  try {
    const message = createUserMessage({
      content: [{ type: 'text', text: renderVisibleWindowMessage(options) }],
      source: visibleWindowMessageSource(options),
    })
    if (options.delivery === 'queue') target.followup(message)
    else target.steer(message)
    return {
      status: 'accepted',
      messageId: options.messageId,
      targetLink,
      code: 'queued',
      message: 'the conversation accepted the message and may continue when useful',
    }
  } catch (error: unknown) {
    if (options.signal.aborted) throw error
    return {
      status: 'rejected',
      messageId: options.messageId,
      targetLink,
      code: 'target-unavailable',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Verify the exact live top-level Agent selected by the directory. */
export function resolveTargetWindow(
  target: Agent | undefined,
  targetSessionId: SessionId,
): Agent | { readonly code: 'target-not-active' | 'target-not-window' | 'target-mismatch'; readonly message: string } {
  if (target === undefined) return { code: 'target-not-active', message: 'the target conversation is not active' }
  if (target.session.id !== targetSessionId) return { code: 'target-mismatch', message: 'the resolved conversation identity changed' }
  if (target.session.header.origin === 'subagent' || (target.session.header.delegationDepth ?? 0) !== 0) {
    return { code: 'target-not-window', message: 'subagent sessions are not conversation windows' }
  }
  return target
}

/** Compatibility options for the task-only API. */
export interface DeliverWindowTaskOptions {
  readonly agents: Pick<AgentRegistry, 'get'>
  readonly sourceSessionId: SessionId
  readonly targetSessionId: SessionId
  readonly messageId: string
  readonly task: string
  readonly signal: AbortSignal
}

/** Compatibility wrapper that queues one task in an active target. */
export function deliverWindowTask(options: DeliverWindowTaskOptions): Promise<WindowTaskResult> {
  const target = options.agents.get(options.targetSessionId)
  if (target === undefined) {
    return Promise.resolve({
      status: 'rejected',
      messageId: options.messageId,
      targetLink: serializeWindowLink(options.targetSessionId),
      code: 'target-not-active',
      message: 'the target conversation is not active',
    })
  }
  return deliverWindowMessage({
    target,
    sourceSessionId: options.sourceSessionId,
    sourceName: String(options.sourceSessionId),
    targetSessionId: options.targetSessionId,
    messageId: options.messageId,
    conversationId: options.messageId,
    delivery: 'queue',
    message: options.task,
    signal: options.signal,
  })
}
