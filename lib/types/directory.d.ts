/** Conversation directory and cold-session activation for ordinary DSH windows. */
import type { Agent, AgentOptions, AgentRegistry } from '@deepseek-ai/dsh-agent';
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session';
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence';
import type { WindowSessionController } from './provisioner.ts';
/** Official services used by directory lookup, resume, and team creation. */
export type WindowAgentDirectory = Pick<AgentRegistry, 'get' | 'list'>;
/** Session-persistence reads needed by the conversation directory. */
export type WindowSessionPersistence = Pick<SessionPersistence, 'inspect' | 'listSnapshots'>;
/** One ordinary top-level conversation visible to the current Host. */
export interface ConversationWindow {
    /** Durable conversation identity. */
    readonly sessionId: SessionId;
    /** Latest explicit or generated conversation title. */
    readonly title: string | undefined;
    /** Whether an Agent is currently live in this Host process. */
    readonly running: boolean;
    /** Original conversation creation time. */
    readonly createdAt: number;
    /** Workspace used to keep routing aligned with the visible conversation list. */
    readonly cwd: string | undefined;
    /** Most recently logged model route, used when a cold conversation is resumed. */
    readonly agentOptions: AgentOptions;
}
/** A resolved target plus its live Agent. */
export interface ResolvedConversationWindow {
    readonly window: ConversationWindow;
    readonly agent: Agent;
    readonly targetLink: string;
}
/** Stable target-selection failure returned without waking any conversation. */
export interface ConversationTargetFailure {
    readonly code: string;
    readonly message: string;
    readonly targetLink: string;
}
/** Directory-backed lookup with revision caching and deduplicated cold resumes. */
export declare class ConversationWindowDirectory {
    #private;
    private readonly agents;
    private readonly persistence;
    private readonly sessions;
    /** @param agents - Official live Agent registry. @param persistence - Official durable session store. */
    constructor(agents: WindowAgentDirectory, persistence: WindowSessionPersistence, sessions: Pick<WindowSessionController, 'resolveAgent'>);
    /** Refresh cold metadata, reusing inspection results whose durable revision is unchanged. */
    refresh(signal?: AbortSignal): Promise<void>;
    /** List every other ordinary conversation visible to the current Host. */
    listFor(source: Agent, signal?: AbortSignal): Promise<ConversationWindow[]>;
    /** Read the current cached and live directory without an asynchronous persistence call. */
    currentFor(source: Agent): ConversationWindow[];
    /** Resolve an exact displayed title, canonical link, or the sole other window. */
    resolve(source: Agent, selectors: {
        readonly targetName?: string;
        readonly targetLink?: string;
    }, signal?: AbortSignal): Promise<ResolvedConversationWindow | ConversationTargetFailure>;
    /** Resolve one trusted relay source without requiring a user-facing title. */
    resolveReplySource(source: Agent, targetSessionId: SessionId, signal?: AbortSignal): Promise<ResolvedConversationWindow | ConversationTargetFailure>;
    /** Render the bounded synchronous directory snapshot included with model context. */
    renderModelContext(source: Agent, maxEntries: number): string;
    /** Clear only process-local observations during plugin teardown. */
    clear(): void;
    /** Resume a cold conversation once through the normal Session composition boundary. */
    activate(sessionId: SessionId, signal?: AbortSignal): Promise<Agent>;
}
/** Read an ordinary live conversation into the common directory shape. */
export declare function windowFromLiveAgent(agent: Agent): ConversationWindow;
/** Read the latest logged route without guessing from title or workspace metadata. */
export declare function readLoggedAgentOptions(events: readonly SessionEvent[]): AgentOptions;
//# sourceMappingURL=directory.d.ts.map