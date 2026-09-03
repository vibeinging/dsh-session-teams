/** Conversation-window message delivery and duplicate suppression. */
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent';
import type { SessionId } from '@deepseek-ai/dsh-session';
import { type WindowMessage } from './protocol.ts';
/** Stable tool result returned for every non-cancelled message attempt. */
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
/** Public name matching conversation-window behavior. */
export type WindowMessageResult = WindowTaskResult;
/** Process-local duplicate suppression keyed by caller-visible message id. */
export declare class DeliveryLedger {
    #private;
    private readonly maxEntries;
    /** @param maxEntries - Maximum retained pending and completed message ids. */
    constructor(maxEntries: number);
    /** Number of retained message ids, exposed for invariant-style tests. */
    get size(): number;
    /** Forget process-local receipts during plugin disposal. */
    clear(): void;
    /** Run a delivery once for one message id and exact payload. */
    run(messageId: string, fingerprint: string, targetLink: string, deliver: () => Promise<WindowTaskResult>): Promise<WindowTaskResult>;
}
/** Values for one already-resolved conversation-window delivery. */
export interface DeliverWindowMessageOptions extends WindowMessage {
    /** Exact live ordinary Agent selected by the directory. */
    readonly target: Agent;
    /** Model messages steer current work; scheduled tasks open a distinct turn. */
    readonly delivery?: 'steer' | 'queue';
    /** Tool cancellation signal checked before the synchronous queue boundary. */
    readonly signal: AbortSignal;
}
/** Deliver one versioned relay to one ordinary conversation window. */
export declare function deliverWindowMessage(options: DeliverWindowMessageOptions): Promise<WindowTaskResult>;
/** Verify the exact live top-level Agent selected by the directory. */
export declare function resolveTargetWindow(target: Agent | undefined, targetSessionId: SessionId): Agent | {
    readonly code: 'target-not-active' | 'target-not-window' | 'target-mismatch';
    readonly message: string;
};
/** Compatibility options for the task-only API. */
export interface DeliverWindowTaskOptions {
    readonly agents: Pick<AgentRegistry, 'get'>;
    readonly sourceSessionId: SessionId;
    readonly targetSessionId: SessionId;
    readonly messageId: string;
    readonly task: string;
    readonly signal: AbortSignal;
}
/** Compatibility wrapper that queues one task in an active target. */
export declare function deliverWindowTask(options: DeliverWindowTaskOptions): Promise<WindowTaskResult>;
//# sourceMappingURL=delivery.d.ts.map