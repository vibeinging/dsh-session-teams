/** Current-turn authorization derived from the authoritative session log. */
import type { SessionEvent, SessionId, UserMessage } from '@deepseek-ai/dsh-session';
/** Result of checking whether the current human prompt grants one target. */
export type WindowLinkAuthority = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly code: 'missing-agent' | 'missing-direct-message' | 'relay-denied' | 'link-not-authorized';
    readonly message: string;
};
/**
 * Find direct user messages entered into the currently executing step.
 * @param events - Calling agent's authoritative event log.
 * @returns Direct user messages after the newest `step/start` boundary.
 */
export declare function currentDirectMessages(events: readonly SessionEvent[]): UserMessage[];
/**
 * Require the target link in this step's direct user input and deny relays.
 * @param events - Calling agent's authoritative event log, or undefined when no agent owns the call.
 * @param targetSessionId - Parsed destination.
 * @returns Explicit grant or stable refusal.
 */
export declare function authorizeWindowLink(events: readonly SessionEvent[] | undefined, targetSessionId: SessionId): WindowLinkAuthority;
//# sourceMappingURL=authority.d.ts.map