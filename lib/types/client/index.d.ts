import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type WindowCollaborationKey } from './locales.ts';
export { WindowCollaborationAction, WindowCollaborationAction as WindowLinkAction, type WindowCollaborationActionProps, type WindowCollaborationActionProps as WindowLinkActionProps, } from './WindowCollaborationAction.tsx';
export { WindowRelayMessage, type WindowRelayMessageProps } from './WindowRelayMessage.tsx';
export type { WindowCollaborationKey, WindowLinkKey } from './locales.ts';
/** Browser services required by the directory and navigable relay messages. */
export declare const inject: string[];
/**
 * Register localized directory labels and the session-header action.
 * @param ctx - DSH client root context.
 */
export declare function apply(ctx: ClientContext): void;
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Conversation-directory action labels. */
        sessionTeams: WindowCollaborationKey;
    }
}
//# sourceMappingURL=index.d.ts.map