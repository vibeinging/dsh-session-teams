/** Task delivery and process-local duplicate suppression. */
import type { AgentRegistry } from '@deepseek-ai/dsh-agent';
import type { SessionId } from '@deepseek-ai/dsh-session';
/** Stable tool result returned for every non-cancelled delivery attempt. */
export interface WindowTaskResult {
    /** Accepted means queued; rejected means definitely not queued. */
    readonly status: 'accepted' | 'rejected';
    /** Sender-selected correlation key. */
    readonly messageId: string;
    /** Canonical destination link, or the refused raw input when it did not parse. */
    readonly targetLink: string;
    /** Stable machine-readable outcome. */
    readonly code: string;
    /** Short model-facing explanation. */
    readonly message: string;
}
/**
 * Process-local duplicate suppression keyed by caller-visible message id.
 * Completed records remain until capacity eviction; no result is claimed to
 * survive a Host restart.
 */
export declare class DeliveryLedger {
    #private;
    private readonly maxEntries;
    /** @param maxEntries - Maximum retained pending and completed message ids. */
    constructor(maxEntries: number);
    /** Number of retained message ids, exposed for invariant-style tests. */
    get size(): number;
    /** Forget all retained process-local receipts during plugin disposal. */
    clear(): void;
    /**
     * Run a delivery once for a message id and exact payload.
     * @param messageId - Caller-visible correlation key.
     * @param fingerprint - Exact target and task identity.
     * @param deliver - Side effect executed only for a new id.
     * @returns Shared first result, or a definite refusal for conflict/capacity.
     */
    run(messageId: string, fingerprint: string, targetLink: string, deliver: () => Promise<WindowTaskResult>): Promise<WindowTaskResult>;
}
/** Values for one gateway delivery. */
export interface DeliverWindowTaskOptions {
    /** Official live-agent directory for the current Host. */
    readonly agents: Pick<AgentRegistry, 'get'>;
    /** Calling top-level session. */
    readonly sourceSessionId: SessionId;
    /** Receiving top-level session. */
    readonly targetSessionId: SessionId;
    /** Caller-visible correlation key. */
    readonly messageId: string;
    /** Exact user task text. */
    readonly task: string;
    /** Tool cancellation signal checked before the synchronous queue boundary. */
    readonly signal: AbortSignal;
}
/**
 * Deliver one versioned envelope to an active ordinary agent on this Host.
 * @param options - Source, target, payload, agent directory, and cancellation.
 * @returns Accepted or definitely rejected receipt.
 */
export declare function deliverWindowTask(options: DeliverWindowTaskOptions): Promise<WindowTaskResult>;
//# sourceMappingURL=delivery.d.ts.map