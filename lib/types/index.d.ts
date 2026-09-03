import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace';
import { ConversationWindowDirectory } from './directory.ts';
import { DeliveryLedger } from './delivery.ts';
import { serializeWindowLink } from './protocol.ts';
import { ConversationWindowProvisioner } from './provisioner.ts';
import { WindowTeamCoordinator } from './team-state.ts';
import { WindowTeamScheduler, type WindowTeamScheduleResult } from './team-scheduler.ts';
import type { WindowTeamProjection, WindowTeamTask, WindowTeamTaskStatus } from './team-types.ts';
export { currentDirectMessages, currentTurnDirectMessages, currentWindowRelay, } from './authority.ts';
export { ConversationWindowDirectory, readLoggedAgentOptions, windowFromLiveAgent, type ConversationTargetFailure, type ConversationWindow, type ResolvedConversationWindow, type WindowAgentDirectory, type WindowSessionPersistence, } from './directory.ts';
export { DeliveryLedger, deliverWindowMessage, deliverWindowTask, resolveTargetWindow, type DeliverWindowMessageOptions, type DeliverWindowTaskOptions, type WindowMessageResult, type WindowTaskResult, } from './delivery.ts';
export { extractWindowLinks, FORWARDED_TASK_PREFIX, isSessionTeamsPlugin, LEGACY_SESSION_TEAMS_MESSAGE_PREFIX, LEGACY_WINDOW_LINK_PLUGIN, LEGACY_WINDOW_MESSAGE_PREFIX, MAX_SESSION_ID_CHARS, isHumanUserSource, isVisibleWindowMessageSource, isWindowMessageSourceClaim, isWindowRelaySource, parseVisibleWindowMessage, parseWindowLink, parseWindowMessage, parseWindowRelayMessage, renderForwardedTask, renderVisibleWindowMessage, renderWindowMessage, SESSION_TEAMS_MESSAGE_PREFIX, SESSION_TEAMS_PLUGIN, SESSION_TEAMS_PROTOCOL_VERSION, SESSION_TEAMS_VISIBLE_RELAY_VERSION, serializeWindowLink, WINDOW_LINK_PLUGIN, WINDOW_LINK_PROTOCOL_VERSION, WINDOW_MESSAGE_PREFIX, WINDOW_RELAY_REPLY_CONTRACT, WINDOW_RELAY_SOURCE_FRAMING, WINDOW_RELAY_SOURCE_FORM, WINDOW_RELAY_SOURCE_KIND, WindowLinkParseError, windowRelaySource, type ForwardedTask, type WindowLink, type WindowMessage, type VisibleWindowMessageSource, type WindowRelaySource, visibleWindowMessageSource, } from './protocol.ts';
export { ConversationWindowProvisioner, currentModelSelection, windowConversationHost, type ProvisionConversationWindowRequest, type ProvisionedConversationWindow, type WindowConversationHost, type WindowSessionController, } from './provisioner.ts';
export { appendWindowTeamState, foldWindowTeam, refreshTaskReadiness, WindowTeamCoordinator, windowTeamProjectionDefinition, } from './team-state.ts';
export { WindowTeamScheduler, renderTaskAssignment, type WindowTeamScheduleResult, type WindowTeamSchedulerConfig, } from './team-scheduler.ts';
export type { WindowTeamFailureKind, WindowTeamMember, WindowTeamProjection, WindowTeamTask, WindowTeamTaskStatus, } from './team-types.ts';
/** Cordis plugin name used in loader diagnostics. */
export declare const name = "session-teams";
/** Required Host services; system prompt remains an optional child. */
export declare const inject: string[];
/** Default largest message payload accepted from a model-facing tool. */
export declare const DEFAULT_MAX_TASK_CHARS = 20000;
/** Default number of process-local receipts retained for duplicate suppression. */
export declare const DEFAULT_MAX_REMEMBERED_MESSAGES = 1024;
/** Default in-process tool deadline. */
export declare const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
/** Default largest team created by one user request. */
export declare const DEFAULT_MAX_TEAM_MEMBERS = 8;
/** Default largest number of tasks retained by one team. */
export declare const DEFAULT_MAX_TEAM_TASKS = 64;
/** Default number of technical attempts allowed for a task. */
export declare const DEFAULT_MAX_TASK_ATTEMPTS = 2;
/** Default delay before retrying a temporary task failure. */
export declare const DEFAULT_TASK_RETRY_DELAY_MS = 1000;
/** Default number of conversation titles placed directly in model context. */
export declare const DEFAULT_MAX_DIRECTORY_ENTRIES = 32;
/** Host plugin configuration. */
export interface Config {
    /** Largest sent message in UTF-16 characters (default 20000). */
    maxTaskChars?: number;
    /** Maximum process-local message ids retained (default 1024). */
    maxRememberedMessages?: number;
    /** API request deadline in milliseconds (default 30000). */
    requestTimeoutMs?: number;
    /** Largest role-window team created by one tool call (default 8). */
    maxTeamMembers?: number;
    /** Largest number of tasks retained by one team (default 64). */
    maxTeamTasks?: number;
    /** Largest automatic technical attempts per task (default 2). */
    maxTaskAttempts?: number;
    /** Delay before retrying a temporary task failure (default 1000). */
    taskRetryDelayMs?: number;
    /** Largest conversation directory snapshot added to model context (default 32). */
    maxDirectoryEntries?: number;
}
/** Validated deployment settings with usable defaults. */
export declare const Config: z<Config>;
/** Fully resolved settings used by tool factories and tests. */
export interface ResolvedConfig {
    readonly maxTaskChars: number;
    readonly maxRememberedMessages: number;
    readonly requestTimeoutMs: number;
    readonly maxTeamMembers: number;
    readonly maxTeamTasks: number;
    readonly maxTaskAttempts: number;
    readonly taskRetryDelayMs: number;
    readonly maxDirectoryEntries: number;
}
/** Canonical window-list result. */
export interface WindowListResult {
    readonly status: 'ok' | 'rejected';
    readonly code: string;
    readonly message: string;
    readonly windows: {
        readonly title: string | null;
        readonly state: 'working' | 'available';
        readonly targetLink: string;
    }[];
}
/** One requested task inside an atomic team graph. */
export interface TeamTaskRequest {
    readonly task: string;
    readonly task_id?: string;
    readonly task_title?: string;
    readonly depends_on?: readonly string[];
    readonly max_attempts?: number;
}
/** One requested role window with either a one-task shorthand or a complete task list. */
export interface TeamMemberRequest {
    readonly name: string;
    readonly role: string;
    readonly task?: string;
    readonly task_id?: string;
    readonly task_title?: string;
    readonly depends_on?: readonly string[];
    readonly max_attempts?: number;
    readonly tasks?: readonly TeamTaskRequest[];
}
/** One team-member creation outcome. */
export interface TeamMemberResult {
    readonly name: string;
    readonly role: string;
    readonly status: 'created' | 'reused' | 'failed';
    readonly targetLink: string;
    readonly code: string;
    readonly message: string;
    readonly taskId: string;
    readonly taskStatus: WindowTeamTaskStatus;
}
/** Canonical result of one multi-window team creation. */
export interface WindowTeamResult {
    readonly status: 'accepted' | 'partial' | 'rejected';
    readonly teamId: string;
    readonly code: string;
    readonly message: string;
    readonly members: TeamMemberResult[];
    readonly tasks: WindowTeamTask[];
}
/** Canonical result of one task-state mutation or scheduler drain. */
export interface WindowTeamMutationResult {
    readonly status: 'accepted' | 'rejected';
    readonly code: string;
    readonly message: string;
    readonly teamId: string;
    readonly task: WindowTeamTask | null;
    readonly schedule: WindowTeamScheduleResult;
}
/** Canonical current-team query result. */
export interface WindowTeamListResult {
    readonly status: 'ok' | 'empty' | 'rejected';
    readonly code: string;
    readonly message: string;
    readonly team: WindowTeamProjection | null;
}
/** Build the directory refresh and list tool. */
export declare function createListConversationWindowsTool(config: ResolvedConfig, directory: ConversationWindowDirectory): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Build direct conversation and source-locked reply delivery. */
export declare function createWindowMessageTool(config: ResolvedConfig, directory: ConversationWindowDirectory, ledger: DeliveryLedger, coordinator: WindowTeamCoordinator, scheduler: WindowTeamScheduler): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Build several visible role windows and schedule dependency-ready first tasks. */
export declare function createWindowTeamTool(config: ResolvedConfig, provisioner: Pick<ConversationWindowProvisioner, 'create'>, directory: ConversationWindowDirectory, coordinator: WindowTeamCoordinator, scheduler: WindowTeamScheduler, workspaceRegistry: Pick<WorkspaceRegistry, 'resolveByPath'>): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Add one dependency-aware task to the current leader's window team. */
export declare function createAddWindowTaskTool(config: ResolvedConfig, directory: ConversationWindowDirectory, coordinator: WindowTeamCoordinator, scheduler: WindowTeamScheduler): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Move one non-running task to another visible conversation by title. */
export declare function createReassignWindowTaskTool(config: ResolvedConfig, directory: ConversationWindowDirectory, coordinator: WindowTeamCoordinator, scheduler: WindowTeamScheduler): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** List the leader-owned team state for natural-language coordination. */
export declare function createListWindowTeamTool(config: ResolvedConfig, directory: ConversationWindowDirectory, coordinator: WindowTeamCoordinator): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Register the stateless directory, direct routing, team creation, and optional model context. */
export declare function apply(ctx: Context, config: Config): Promise<void>;
/** Canonical source-session selector for integrations without the browser entry. */
export { serializeWindowLink as linkForSession };
//# sourceMappingURL=index.d.ts.map