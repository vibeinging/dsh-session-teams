import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { AgentRegistry } from '@deepseek-ai/dsh-agent';
import { DeliveryLedger } from './delivery.ts';
import { serializeWindowLink } from './protocol.ts';
export { authorizeWindowLink, currentDirectMessages, type WindowLinkAuthority, } from './authority.ts';
export { DeliveryLedger, deliverWindowTask, type DeliverWindowTaskOptions, type WindowTaskResult, } from './delivery.ts';
export { extractWindowLinks, FORWARDED_TASK_PREFIX, MAX_SESSION_ID_CHARS, parseWindowLink, renderForwardedTask, serializeWindowLink, WINDOW_LINK_PROTOCOL_VERSION, WindowLinkParseError, type ForwardedTask, type WindowLink, } from './protocol.ts';
/** Cordis plugin name used in loader diagnostics. */
export declare const name = "window-link";
/** Host services required by the plugin. */
export declare const inject: string[];
/** Default largest task payload accepted from the model-facing tool. */
export declare const DEFAULT_MAX_TASK_CHARS = 20000;
/** Default number of process-local message receipts retained for duplicate suppression. */
export declare const DEFAULT_MAX_REMEMBERED_MESSAGES = 1024;
/** Default in-process API request deadline. */
export declare const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
/** Host plugin configuration. */
export interface Config {
    /** Largest forwarded task in UTF-16 characters (default 20000). */
    maxTaskChars?: number;
    /** Maximum process-local message ids retained (default 1024). */
    maxRememberedMessages?: number;
    /** API request deadline in milliseconds (default 30000). */
    requestTimeoutMs?: number;
}
/** Validated deployment settings with usable defaults. */
export declare const Config: z<Config>;
interface ResolvedConfig {
    readonly maxTaskChars: number;
    readonly maxRememberedMessages: number;
    readonly requestTimeoutMs: number;
}
/**
 * Build the tool definition around an API client and one receipt ledger.
 * Exported for focused composition tests; normal callers use {@link apply}.
 * @param config - Fully resolved limits.
 * @param agents - Official live-agent directory.
 * @param ledger - Process-local duplicate ledger.
 * @returns Typed DSH tool definition.
 */
export declare function createWindowTaskTool(config: ResolvedConfig, agents: Pick<AgentRegistry, 'get'>, ledger: DeliveryLedger): import("@deepseek-ai/dsh-tools").ToolDefinition;
/**
 * Register the window-task tool over the Host's official live-agent directory.
 * @param ctx - Cordis context providing tools and agents.
 * @param config - Loader-resolved limits.
 */
export declare function apply(ctx: Context, config: Config): void;
/** Canonical source-session link helper for integrations without the browser entry. */
export { serializeWindowLink as linkForSession };
//# sourceMappingURL=index.d.ts.map