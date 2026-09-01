/** Browser entry: register the copy-link action in the conversation header. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { WindowLinkAction } from './WindowLinkAction.tsx'
import { en, zh, type WindowLinkKey } from './locales.ts'

export { WindowLinkAction, type WindowLinkActionProps } from './WindowLinkAction.tsx'
export type { WindowLinkKey } from './locales.ts'

/** Dictionary namespace owned by the plugin. */
const NS = 'windowLink'

/** Browser services required by the link action. */
export const inject = ['slots', 'locale']

/**
 * Register localized copy feedback and the session-header action.
 * @param ctx - DSH client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'window-link: dictionaries')
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'window-link-copy',
    locale: NS,
  }, WindowLinkAction))
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy-link action labels. */
    windowLink: WindowLinkKey
  }
}
