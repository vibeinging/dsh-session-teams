/** Current-turn routing facts derived from the authoritative session log. */
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session';
import { type WindowMessage } from './protocol.ts';
interface TeamTaskAssignment extends WindowMessage {
    readonly teamId: string;
    readonly taskId: string;
}
/** Find direct human messages entered into the currently executing step. */
export declare function currentDirectMessages(events: readonly SessionEvent[]): UserMessage[];
/** Find direct human messages admitted since the current turn began. */
export declare function currentTurnDirectMessages(events: readonly SessionEvent[]): UserMessage[];
/** Read the newest trusted window relay admitted into the current turn. */
export declare function currentWindowRelay(events: readonly SessionEvent[]): WindowMessage | undefined;
/** Read the newest durable task assignment without letting ordinary relays shadow it. */
export declare function latestTeamTaskAssignment(events: readonly SessionEvent[]): TeamTaskAssignment | undefined;
export {};
//# sourceMappingURL=authority.d.ts.map