/** JSON-safe task and team values shared by Host projections and the browser panel. */

/** Lifecycle states shown for one coordinated task. */
export type WindowTeamTaskStatus = 'blocked' | 'ready' | 'queued' | 'running' | 'completed' | 'failed'

/** Failure classes that decide whether a bounded automatic retry is allowed. */
export type WindowTeamFailureKind = 'technical' | 'work'

/** One ordinary top-level conversation participating in a window team. */
export interface WindowTeamMember {
  /** Session identity used to correlate the standard conversation list. */
  readonly sessionId: string
  /** Exact visible conversation title. */
  readonly name: string
  /** Responsibility owned by this member. */
  readonly role: string
  /** Whether the ordinary conversation was created successfully. */
  readonly created: boolean
}

/** One dependency-aware unit of work assigned to a visible conversation. */
export interface WindowTeamTask {
  /** Stable team-local task identity. */
  readonly id: string
  /** Short user-facing task title. */
  readonly title: string
  /** Exact work instruction delivered to the member. */
  readonly instruction: string
  /** Current owner Session identity. */
  readonly ownerSessionId: string
  /** Current owner's exact visible title. */
  readonly ownerName: string
  /** Task ids that must complete first. */
  readonly dependsOn: string[]
  /** Current lifecycle state. */
  readonly status: WindowTeamTaskStatus
  /** Number of delivery or work attempts already started. */
  readonly attempts: number
  /** Largest number of technical attempts. */
  readonly maxAttempts: number
  /** Latest result or failure summary. */
  readonly note: string | null
  /** Latest failure class, absent before failure or after completion. */
  readonly failureKind: WindowTeamFailureKind | null
}

/** Complete leader-owned team state reconstructed from one Session log. */
export interface WindowTeamProjection {
  /** Stable team identity. */
  readonly teamId: string
  /** Monotonic whole-state revision. */
  readonly revision: number
  /** Shared requested outcome. */
  readonly goal: string
  /** Leader Session identity. */
  readonly leaderSessionId: string
  /** Leader's exact visible title. */
  readonly leaderName: string
  /** Leader's coordination responsibility. */
  readonly leaderRole: string
  /** Visible member conversations. */
  readonly members: WindowTeamMember[]
  /** Dependency-aware team tasks. */
  readonly tasks: WindowTeamTask[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Complete leader-owned window-team state, or null before a team exists. */
    windowTeam: WindowTeamProjection | null
  }

  interface SessionProjectionStateMap {
    /** Complete leader-owned window-team fold state. */
    windowTeam: WindowTeamProjection | null
  }
}
