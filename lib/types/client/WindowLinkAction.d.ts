import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/** Full props supplied by the session header action seat. */
export type WindowLinkActionProps = PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'windowLink'>;
/**
 * Write the session link through the browser clipboard surface.
 * @param text - Exact canonical deep link.
 * @returns Whether either browser clipboard path accepted the copy.
 */
export declare function writeWindowLinkClipboard(text: string): Promise<boolean>;
/** Copy the current session link and expose success or failure to assistive text. */
export declare function WindowLinkAction({ sessionId, t }: WindowLinkActionProps): import("react").JSX.Element;
//# sourceMappingURL=WindowLinkAction.d.ts.map