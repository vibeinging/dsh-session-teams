/** Deep-link and forwarded-task wire format shared by the host and browser entry. */
import type { SessionId } from '@deepseek-ai/dsh-session';
/** Current forwarded-task envelope version. */
export declare const WINDOW_LINK_PROTOCOL_VERSION = 1;
/** Marker placed at the start of every forwarded task. */
export declare const FORWARDED_TASK_PREFIX = "[dsh-window-link/v1]";
/** Maximum decoded session-id length accepted by the link parser. */
export declare const MAX_SESSION_ID_CHARS = 512;
/** A parsed DSH conversation deep link. */
export interface WindowLink {
    /** Target session id carried by the link. */
    readonly sessionId: SessionId;
    /** Stable query-free form emitted by this plugin. */
    readonly canonical: string;
}
/** Why a deep link could not be parsed. */
export declare class WindowLinkParseError extends Error {
    /** Stable code suitable for tool output and tests. */
    readonly code = "invalid-link";
    /** @param message - Plain-language reason the link was refused. */
    constructor(message: string);
}
/**
 * Create the copyable link for one DSH session.
 * @param sessionId - Opaque DSH session id.
 * @returns Query-free `dsh://session/...` link.
 */
export declare function serializeWindowLink(sessionId: SessionId | string): string;
/**
 * Parse a strict DSH session link. The old `?v=1` suffix remains readable,
 * while serialization always emits the shorter query-free form.
 * @param input - Candidate complete link.
 * @returns Parsed target and its canonical form.
 */
export declare function parseWindowLink(input: string): WindowLink;
/**
 * Read every syntactically complete DSH session link embedded in text.
 * Malformed candidates are ignored instead of granting authority.
 * @param text - Direct user-message text.
 * @returns Parsed links in source order.
 */
export declare function extractWindowLinks(text: string): WindowLink[];
/** Values needed to build the model-visible forwarded task. */
export interface ForwardedTask {
    /** Correlation id chosen by the sender. */
    readonly messageId: string;
    /** Sending session. */
    readonly sourceSessionId: SessionId;
    /** Receiving session. */
    readonly targetSessionId: SessionId;
    /** Exact task text supplied by the sender's user. */
    readonly task: string;
}
/**
 * Build the versioned text delivered to the target session.
 * @param input - Correlation, source, target, and task values.
 * @returns One self-describing forwarded user prompt.
 */
export declare function renderForwardedTask(input: ForwardedTask): string;
//# sourceMappingURL=protocol.d.ts.map