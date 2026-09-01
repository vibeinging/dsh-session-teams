/** Current-turn authorization derived from the authoritative session log. */
import type { SessionEvent, SessionId, UserMessage } from '@deepseek-ai/dsh-session'
import { extractWindowLinks, FORWARDED_TASK_PREFIX } from './protocol.ts'

/** Result of checking whether the current human prompt grants one target. */
export type WindowLinkAuthority =
  | { readonly ok: true }
  | {
    readonly ok: false
    readonly code: 'missing-agent' | 'missing-direct-message' | 'relay-denied' | 'link-not-authorized'
    readonly message: string
  }

/** Collapse only text blocks; non-text content never carries a deep-link grant. */
function messageText(message: UserMessage): string {
  return message.content
    .flatMap(block => block.type === 'text' ? [block.text] : [])
    .join('\n')
}

/**
 * Find direct user messages entered into the currently executing step.
 * @param events - Calling agent's authoritative event log.
 * @returns Direct user messages after the newest `step/start` boundary.
 */
export function currentDirectMessages(events: readonly SessionEvent[]): UserMessage[] {
  const stepStart = events.findLastIndex(event => event.type === 'step/start')
  if (stepStart < 0) return []
  const messages: UserMessage[] = []
  for (let index = stepStart + 1; index < events.length; index += 1) {
    const event = events[index]
    if (event?.type === 'step/end') break
    if (event?.type === 'user/message' && event.data.source.kind === 'user') {
      messages.push(event.data)
    }
  }
  return messages
}

/**
 * Require the target link in this step's direct user input and deny relays.
 * @param events - Calling agent's authoritative event log, or undefined when no agent owns the call.
 * @param targetSessionId - Parsed destination.
 * @returns Explicit grant or stable refusal.
 */
export function authorizeWindowLink(
  events: readonly SessionEvent[] | undefined,
  targetSessionId: SessionId,
): WindowLinkAuthority {
  if (events === undefined) {
    return { ok: false, code: 'missing-agent', message: 'window task delivery requires an agent-owned tool call' }
  }
  const direct = currentDirectMessages(events)
  if (direct.length === 0) {
    return { ok: false, code: 'missing-direct-message', message: 'no direct user message exists in the current step' }
  }
  const texts = direct.map(messageText)
  if (texts.some(text => text.includes(FORWARDED_TASK_PREFIX))) {
    return { ok: false, code: 'relay-denied', message: 'a forwarded task cannot forward another task' }
  }
  const authorized = texts.some(text =>
    extractWindowLinks(text).some(link => link.sessionId === targetSessionId))
  return authorized
    ? { ok: true }
    : {
        ok: false,
        code: 'link-not-authorized',
        message: 'the complete target link must appear in the current direct user message',
      }
}
