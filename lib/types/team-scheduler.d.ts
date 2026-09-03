import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ConversationWindowDirectory } from './directory.ts';
import { WindowTeamCoordinator } from './team-state.ts';
import type { WindowTeamProjection, WindowTeamTask } from './team-types.ts';
/** Scheduler limits resolved from plugin configuration. */
export interface WindowTeamSchedulerConfig {
    /** Delay before retrying a technical failure. */
    readonly taskRetryDelayMs: number;
}
/** Observable outcome of one scheduler drain. */
export interface WindowTeamScheduleResult {
    /** Tasks accepted by their owner windows. */
    readonly started: string[];
    /** Tasks that exhausted retries or failed permanently. */
    readonly failed: string[];
}
/** Dispatch every ready task once its dependencies complete. */
export declare class WindowTeamScheduler {
    #private;
    private readonly config;
    private readonly directory;
    private readonly coordinator;
    constructor(config: WindowTeamSchedulerConfig, directory: ConversationWindowDirectory, coordinator: WindowTeamCoordinator);
    /** Coalesce concurrent drains for the same leader Session. */
    run(leader: Agent, signal?: AbortSignal): Promise<WindowTeamScheduleResult>;
    /** Cancel retry delays and wait for all active drains to settle. */
    dispose(): Promise<void>;
}
/** Render a self-contained task contract that reports through the normal message tool. */
export declare function renderTaskAssignment(state: WindowTeamProjection, task: WindowTeamTask): string;
//# sourceMappingURL=team-scheduler.d.ts.map