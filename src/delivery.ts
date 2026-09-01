/** Task delivery and process-local duplicate suppression. */
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { renderForwardedTask, serializeWindowLink } from './protocol.ts'

/** Stable tool result returned for every non-cancelled delivery attempt. */
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

interface DeliveryRecord {
  readonly fingerprint: string
  readonly promise: Promise<WindowTaskResult>
  settled: boolean
}

/**
 * Process-local duplicate suppression keyed by caller-visible message id.
 * Completed records remain until capacity eviction; no result is claimed to
 * survive a Host restart.
 */
export class DeliveryLedger {
  readonly #records = new Map<string, DeliveryRecord>()

  /** @param maxEntries - Maximum retained pending and completed message ids. */
  constructor(private readonly maxEntries: number) {}

  /** Number of retained message ids, exposed for invariant-style tests. */
  get size(): number {
    return this.#records.size
  }

  /** Forget all retained process-local receipts during plugin disposal. */
  clear(): void {
    this.#records.clear()
  }

  /**
   * Run a delivery once for a message id and exact payload.
   * @param messageId - Caller-visible correlation key.
   * @param fingerprint - Exact target and task identity.
   * @param deliver - Side effect executed only for a new id.
   * @returns Shared first result, or a definite refusal for conflict/capacity.
   */
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
        message: 'message_id was already used for a different target or task',
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

/** Values for one gateway delivery. */
export interface DeliverWindowTaskOptions {
  /** Official live-agent directory for the current Host. */
  readonly agents: Pick<AgentRegistry, 'get'>
  /** Calling top-level session. */
  readonly sourceSessionId: SessionId
  /** Receiving top-level session. */
  readonly targetSessionId: SessionId
  /** Caller-visible correlation key. */
  readonly messageId: string
  /** Exact user task text. */
  readonly task: string
  /** Tool cancellation signal checked before the synchronous queue boundary. */
  readonly signal: AbortSignal
}

/**
 * Deliver one versioned envelope to an active ordinary agent on this Host.
 * @param options - Source, target, payload, agent directory, and cancellation.
 * @returns Accepted or definitely rejected receipt.
 */
export async function deliverWindowTask(options: DeliverWindowTaskOptions): Promise<WindowTaskResult> {
  const targetLink = serializeWindowLink(options.targetSessionId)
  options.signal.throwIfAborted()
  const target = options.agents.get(options.targetSessionId)
  if (target === undefined) {
    return {
      status: 'rejected',
      messageId: options.messageId,
      targetLink,
      code: 'target-not-active',
      message: 'the target session is not active in this Host process',
    }
  }
  if (target.session.header.origin === 'subagent') {
    return {
      status: 'rejected',
      messageId: options.messageId,
      targetLink,
      code: 'target-not-window',
      message: 'subagent sessions are not addressable as conversation windows',
    }
  }
  try {
    target.followup(createUserMessage({
      content: [{
        type: 'text',
        text: renderForwardedTask({
          messageId: options.messageId,
          sourceSessionId: options.sourceSessionId,
          targetSessionId: options.targetSessionId,
          task: options.task,
        }),
      }],
      source: { kind: 'user' },
    }))
    return {
      status: 'accepted',
      messageId: options.messageId,
      targetLink,
      code: 'queued',
      message: 'the active target window accepted the task for its next turn',
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
