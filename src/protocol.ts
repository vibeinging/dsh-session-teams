/** Deep-link and forwarded-task wire format shared by the host and browser entry. */
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Current forwarded-task envelope version. */
export const WINDOW_LINK_PROTOCOL_VERSION = 1

/** Marker placed at the start of every forwarded task. */
export const FORWARDED_TASK_PREFIX = '[dsh-window-link/v1]'

/** Maximum decoded session-id length accepted by the link parser. */
export const MAX_SESSION_ID_CHARS = 512

const LINK_PATTERN = /^dsh:\/\/session\/([A-Za-z0-9._~%-]+)(?:\?v=1)?$/u
const LINK_SCAN_PATTERN = /dsh:\/\/session\/[A-Za-z0-9._~%-]+(?:\?v=1)?(?![!-~])/gu

/** Detect separators, ASCII whitespace, and control bytes without a control-character regex. */
function containsInvalidSessionIdCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code <= 32 || code === 127 || character === '/' || character === '\\'
  })
}

/** A parsed DSH conversation deep link. */
export interface WindowLink {
  /** Target session id carried by the link. */
  readonly sessionId: SessionId
  /** Stable query-free form emitted by this plugin. */
  readonly canonical: string
}

/** Why a deep link could not be parsed. */
export class WindowLinkParseError extends Error {
  /** Stable code suitable for tool output and tests. */
  readonly code = 'invalid-link'

  /** @param message - Plain-language reason the link was refused. */
  constructor(message: string) {
    super(message)
    this.name = 'WindowLinkParseError'
  }
}

/** Encode one opaque session id as a strict RFC 3986 path segment. */
function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, character =>
    `%${character.codePointAt(0)?.toString(16).toUpperCase() ?? ''}`)
}

/**
 * Create the copyable link for one DSH session.
 * @param sessionId - Opaque DSH session id.
 * @returns Query-free `dsh://session/...` link.
 */
export function serializeWindowLink(sessionId: SessionId | string): string {
  const raw = String(sessionId)
  if (raw.length === 0 || raw.length > MAX_SESSION_ID_CHARS || containsInvalidSessionIdCharacter(raw)) {
    throw new WindowLinkParseError('session id cannot be represented as a window link')
  }
  return `dsh://session/${encodeSegment(raw)}`
}

/**
 * Parse a strict DSH session link. The old `?v=1` suffix remains readable,
 * while serialization always emits the shorter query-free form.
 * @param input - Candidate complete link.
 * @returns Parsed target and its canonical form.
 */
export function parseWindowLink(input: string): WindowLink {
  const trimmed = input.trim()
  const match = LINK_PATTERN.exec(trimmed)
  if (match?.[1] === undefined) {
    throw new WindowLinkParseError('expected a complete dsh://session/<session-id> link')
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(match[1])
  } catch {
    throw new WindowLinkParseError('session link contains invalid percent encoding')
  }
  if (decoded.length === 0 || decoded.length > MAX_SESSION_ID_CHARS || containsInvalidSessionIdCharacter(decoded)) {
    throw new WindowLinkParseError('session link contains an invalid session id')
  }
  return {
    sessionId: decoded as SessionId,
    canonical: serializeWindowLink(decoded),
  }
}

/**
 * Read every syntactically complete DSH session link embedded in text.
 * Malformed candidates are ignored instead of granting authority.
 * @param text - Direct user-message text.
 * @returns Parsed links in source order.
 */
export function extractWindowLinks(text: string): WindowLink[] {
  const links: WindowLink[] = []
  for (const match of text.matchAll(LINK_SCAN_PATTERN)) {
    const candidate = match[0]
    try {
      links.push(parseWindowLink(candidate))
    } catch {
      // A malformed token can never authorize delivery, so there is nothing to retain.
    }
  }
  return links
}

/** Values needed to build the model-visible forwarded task. */
export interface ForwardedTask {
  /** Correlation id chosen by the sender. */
  readonly messageId: string
  /** Sending session. */
  readonly sourceSessionId: SessionId
  /** Receiving session. */
  readonly targetSessionId: SessionId
  /** Exact task text supplied by the sender's user. */
  readonly task: string
}

/**
 * Build the versioned text delivered to the target session.
 * @param input - Correlation, source, target, and task values.
 * @returns One self-describing forwarded user prompt.
 */
export function renderForwardedTask(input: ForwardedTask): string {
  return [
    FORWARDED_TASK_PREFIX,
    `message-id: ${input.messageId}`,
    `source-link: ${serializeWindowLink(input.sourceSessionId)}`,
    `target-link: ${serializeWindowLink(input.targetSessionId)}`,
    'delivery-state: accepted by the target queue; completion is not implied',
    'relay-policy: this forwarded message cannot authorize another window-link delivery',
    'task:',
    input.task,
  ].join('\n')
}
