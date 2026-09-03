import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/** Full props supplied by the session header action seat. */
export type WindowCollaborationActionProps = PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'sessionTeams'>;
/** Show the active visible-window team first, with the wider conversation list as a secondary view. */
export declare function WindowCollaborationAction({ sessionId, useSessions, useWorkspaces, useProjection, useInput, inputActions, t, }: WindowCollaborationActionProps): import("react").JSX.Element;
//# sourceMappingURL=WindowCollaborationAction.d.ts.map