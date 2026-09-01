/** Browser entry: register the copy-link action in the conversation header. */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type WindowLinkKey } from './locales.ts';
export { WindowLinkAction, type WindowLinkActionProps } from './WindowLinkAction.tsx';
export type { WindowLinkKey } from './locales.ts';
/** Browser services required by the link action. */
export declare const inject: string[];
/**
 * Register localized copy feedback and the session-header action.
 * @param ctx - DSH client root context.
 */
export declare function apply(ctx: ClientContext): void;
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Copy-link action labels. */
        windowLink: WindowLinkKey;
    }
}
//# sourceMappingURL=index.d.ts.map