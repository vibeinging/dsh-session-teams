/** Durable log-only records and the official Session Projection for window teams. */
import { z } from 'zod';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import type { WindowTeamProjection } from './team-types.ts';
/** Runtime schema used by the persisted projection cache and client wire. */
export declare const windowTeamSchema: z.ZodObject<{
    teamId: z.ZodString;
    revision: z.ZodNumber;
    goal: z.ZodString;
    leaderSessionId: z.ZodString;
    leaderName: z.ZodString;
    leaderRole: z.ZodString;
    members: z.ZodArray<z.ZodObject<{
        sessionId: z.ZodString;
        name: z.ZodString;
        role: z.ZodString;
        created: z.ZodBoolean;
    }, z.core.$strict>>;
    tasks: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        instruction: z.ZodString;
        ownerSessionId: z.ZodString;
        ownerName: z.ZodString;
        dependsOn: z.ZodArray<z.ZodString>;
        status: z.ZodEnum<{
            queued: "queued";
            running: "running";
            blocked: "blocked";
            ready: "ready";
            completed: "completed";
            failed: "failed";
        }>;
        attempts: z.ZodNumber;
        maxAttempts: z.ZodNumber;
        note: z.ZodNullable<z.ZodString>;
        failureKind: z.ZodNullable<z.ZodEnum<{
            technical: "technical";
            work: "work";
        }>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
type WindowTeamProjectionDefinition = Omit<ProjectionDefinition<'windowTeam', WindowTeamProjection | null>, 'wire'> & {
    readonly wire: NonNullable<ProjectionDefinition<'windowTeam', WindowTeamProjection | null>['wire']>;
};
/** Official projection unit carrying a rebuildable complete team view to the browser. */
export declare const windowTeamProjectionDefinition: WindowTeamProjectionDefinition;
/** Fold the latest whole team state directly from the Session log. */
export declare function foldWindowTeam(events: readonly SessionEvent[]): WindowTeamProjection | null;
/** Append one validated known event that never enters or replaces the model surface. */
export declare function appendWindowTeamState(session: Session, state: WindowTeamProjection): WindowTeamProjection;
/** Recompute waiting and ready tasks after a dependency or owner change. */
export declare function refreshTaskReadiness(state: WindowTeamProjection): WindowTeamProjection;
/** Return a state replacement with one new revision and normalized dependency readiness. */
export declare function nextWindowTeamState(state: WindowTeamProjection, change: Omit<WindowTeamProjection, 'revision'>): WindowTeamProjection;
/** Serialize mutations per leader Session so concurrent tools cannot lose updates. */
export declare class WindowTeamCoordinator {
    #private;
    /** Read the current immutable state from the authoritative Session log. */
    current(session: Session): WindowTeamProjection | null;
    /** Run one state operation after prior work for the same leader has settled. */
    run<T>(session: Session, operation: () => Promise<T> | T): Promise<T>;
    /** Drop process-local serialization tails during plugin disposal. */
    clear(): void;
}
export {};
//# sourceMappingURL=team-state.d.ts.map