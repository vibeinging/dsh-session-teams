/** Current-turn routing facts derived from the authoritative session log. */
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import {
  isHumanUserSource,
  isSessionTeamsPlugin,
  parseVisibleWindowMessage,
  parseWindowMessage,
  parseWindowRelayMessage,
  type WindowMessage,
} from './protocol.ts'

interface TeamTaskAssignment extends WindowMessage {
  readonly teamId: string
  readonly taskId: string
}

/** Collapse only text blocks from one model-visible user message. */
function messageText(message: UserMessage): string {
  return message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

/** Find direct human messages entered into the currently executing step. */
export function currentDirectMessages(events: readonly SessionEvent[]): UserMessage[] {
  const stepStart = events.findLastIndex(event => event.type === 'step/start')
  if (stepStart < 0) return []
  const messages: UserMessage[] = []
  for (let index = stepStart + 1; index < events.length; index += 1) {
    const event = events[index]
    if (event?.type === 'step/end') break
    if (event?.type === 'user/message' && isHumanUserSource(event.data.source)) messages.push(event.data)
  }
  return messages
}

/** Find direct human messages admitted since the current turn began. */
export function currentTurnDirectMessages(events: readonly SessionEvent[]): UserMessage[] {
  const turnStart = events.findLastIndex(event => event.type === 'turn/start')
  if (turnStart < 0) return []
  const messages: UserMessage[] = []
  for (let index = turnStart + 1; index < events.length; index += 1) {
    const event = events[index]
    if (event?.type === 'turn/end') break
    if (event?.type === 'user/message' && isHumanUserSource(event.data.source)) messages.push(event.data)
  }
  return messages
}

/** Read the newest trusted window relay admitted into the current turn. */
export function currentWindowRelay(events: readonly SessionEvent[]): WindowMessage | undefined {
  const turnStart = events.findLastIndex(event => event.type === 'turn/start')
  if (turnStart < 0) return undefined
  for (let index = events.length - 1; index > turnStart; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    if (event?.type === 'turn/end') return undefined
    const relay = trustedWindowRelay(event)
    if (relay !== undefined) return relay
  }
  return undefined
}

/** Read the newest durable task assignment without letting ordinary relays shadow it. */
export function latestTeamTaskAssignment(events: readonly SessionEvent[]): TeamTaskAssignment | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    const relay = trustedWindowRelay(event)
    if (relay?.teamId !== undefined && relay.taskId !== undefined) {
      return { ...relay, teamId: relay.teamId, taskId: relay.taskId }
    }
  }
  return undefined
}

/** Parse one trusted registered, visible, or legacy window relay event. */
function trustedWindowRelay(event: SessionEvent): WindowMessage | undefined {
  if (event.type !== 'user/message') return undefined
  const source = event.data.source
  const registered = parseWindowRelayMessage(source, messageText(event.data))
  if (registered !== undefined) return registered
  const visible = parseVisibleWindowMessage(source, messageText(event.data))
  if (visible !== undefined) return visible
  if (source.kind !== 'plugin' || !isSessionTeamsPlugin(source.plugin) || source.form !== 'relay') return undefined
  return parseWindowMessage(messageText(event.data))
}
