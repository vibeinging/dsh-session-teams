/** Browser entry: register the conversation directory in the session header. */
import { createElement, type ElementType } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { WindowCollaborationAction } from './WindowCollaborationAction.tsx'
import { WindowRelayMessage } from './WindowRelayMessage.tsx'
import { en, zh, type WindowCollaborationKey } from './locales.ts'

export {
  WindowCollaborationAction,
  WindowCollaborationAction as WindowLinkAction,
  type WindowCollaborationActionProps,
  type WindowCollaborationActionProps as WindowLinkActionProps,
} from './WindowCollaborationAction.tsx'
export { WindowRelayMessage, type WindowRelayMessageProps } from './WindowRelayMessage.tsx'
export type { WindowCollaborationKey, WindowLinkKey } from './locales.ts'

/** Dictionary namespace owned by the plugin. */
const NS = 'sessionTeams'

/** Browser services required by the directory and navigable relay messages. */
export const inject = ['slots', 'locale', 'sessions']

/**
 * Register localized directory labels and the session-header action.
 * @param ctx - DSH client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-teams: dictionaries')
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'session-teams-directory',
    locale: NS,
  }, WindowCollaborationAction))
  ctx.slots.inject('conversation.chat.node', () => installRelayRenderers(ctx))
}

type RelayNodeKind = 'user' | 'steering' | 'context'
type RelayRendererProps<Kind extends RelayNodeKind> =
  Omit<ChatNodeViewProps<Kind>, 't'> & PropsLocale<'sessionTeams'>

/** Chat message-node kinds a relay can surface in: registered relays land on the context node. */
const RELAY_NODE_KINDS = ['user', 'steering', 'context'] as const satisfies readonly RelayNodeKind[]

/** Wait for Chat's own entries because a Slot declaration becomes visible before its injectors finish. */
function installRelayRenderers(ctx: ClientContext): () => void {
  let disposeRenderers: (() => void) | undefined
  const installWhenReady = () => {
    if (disposeRenderers !== undefined) return
    const entries = ctx.slots.entriesOfSlot('conversation.chat.node')
    const originals = RELAY_NODE_KINDS.flatMap(kind => {
      const entry = entries.find(candidate => candidate.options.key === kind)
      return entry === undefined ? [] : [{ kind, entry }]
    })
    if (originals.length !== RELAY_NODE_KINDS.length) return
    const disposers: (() => void)[] = []
    try {
      for (const original of originals) disposers.push(registerRelayRenderer(ctx, original.kind, original.entry))
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    disposeRenderers = () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }
  const unsubscribe = ctx.slots.subscribe('conversation.chat.node', installWhenReady)
  installWhenReady()
  return () => {
    unsubscribe()
    disposeRenderers?.()
  }
}

/** Decorate one trusted relay cell while retaining Chat's original renderer as fallback. */
function registerRelayRenderer<Kind extends RelayNodeKind>(
  ctx: ClientContext,
  key: Kind,
  original: ReturnType<ClientContext['slots']['entriesOfSlot']>[number],
): () => void {
  const Original = original.component as ElementType
  const chatT = ctx.locale.bind('chat')
  const sessions = ctx.sessions as unknown as ISessions
  const priority = (original.options.priority ?? 0) - 1
  const RelayAwareRenderer = (props: RelayRendererProps<Kind>) => createElement(WindowRelayMessage, {
    node: props.node,
    useSessions: props.useSessions,
    t: props.t,
    openSession: sessionId => { sessions.open(sessionId) },
    fallback: createElement(Original, { ...props, t: chatT }),
  })
  return ctx.slots.register({
    name: 'conversation.chat.node',
    key,
    priority,
    locale: NS,
  }, RelayAwareRenderer)
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Conversation-directory action labels. */
    sessionTeams: WindowCollaborationKey
  }
}
