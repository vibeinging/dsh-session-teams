/** Compact, navigable presentation for a message relayed from another conversation. */
import { type ReactNode } from 'react';
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
type RelayNode = ChatNodeViewProps<'user' | 'steering' | 'context'>['node'];
type UseSessions = ChatNodeViewProps<'user'>['useSessions'];
/** Props kept explicit so the relay presentation can be tested without a Slot registry. */
export interface WindowRelayMessageProps extends PropsLocale<'sessionTeams'> {
    /** Final Chat node currently being rendered. */
    readonly node: RelayNode;
    /** Session-directory selector supplied by the standard Chat Slot props. */
    readonly useSessions: UseSessions;
    /** Original Chat renderer used when the message is not owned by this plugin. */
    readonly fallback: ReactNode;
    /** Open a listed conversation through the Session Controller. */
    readonly openSession: (sessionId: SessionId) => void;
}
/** Preserve the original renderer unless durable relay metadata and visible text agree. */
export declare function WindowRelayMessage({ node, useSessions, fallback, openSession, t }: WindowRelayMessageProps): string | number | boolean | import("react").JSX.Element | Iterable<ReactNode> | null | undefined;
export {};
//# sourceMappingURL=WindowRelayMessage.d.ts.map