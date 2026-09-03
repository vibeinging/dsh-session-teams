/** Durable log-only records and the official Session Projection for window teams. */
import { z } from 'zod'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {
  WindowTeamProjection,
  WindowTeamTask,
} from './team-types.ts'

const TEAM_STATE_PLUGIN = '@vibeinging/dsh-session-teams'
const TEAM_STATE_TASK_ID = 'session-teams-state'
const TEAM_STATE_SUBJECT = 'DSH Session Teams state'
const TEAM_STATE_RECORD_PREFIX = 'DSH Session Teams state v1\n\n'
const LEGACY_TEAM_STATE_PREFIX = 'Current window team state. This snapshot supersedes earlier window-team snapshots.\n\n'

const memberSchema = z.object({
  sessionId: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  created: z.boolean(),
}).strict()

const taskSchema = z.object({
  id: z.string().min(2).max(64),
  title: z.string().min(1),
  instruction: z.string().min(1),
  ownerSessionId: z.string().min(1),
  ownerName: z.string().min(1),
  dependsOn: z.array(z.string().min(2).max(64)),
  status: z.enum(['blocked', 'ready', 'queued', 'running', 'completed', 'failed']),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  note: z.string().nullable(),
  failureKind: z.enum(['technical', 'work']).nullable(),
}).strict()

/** Runtime schema used by the persisted projection cache and client wire. */
export const windowTeamSchema = z.object({
  teamId: z.string().min(8),
  revision: z.number().int().positive(),
  goal: z.string().min(1),
  leaderSessionId: z.string().min(1),
  leaderName: z.string().min(1),
  leaderRole: z.string().min(1),
  members: z.array(memberSchema),
  tasks: z.array(taskSchema),
}).strict()

const nullableWindowTeamSchema = windowTeamSchema.nullable()

const windowTeamTaskRecordSchema = z.object({
  version: z.literal(1),
  teamId: z.string().min(1),
  task: z.object({
    id: z.literal(TEAM_STATE_TASK_ID),
    revision: z.number().int().positive(),
    subject: z.literal(TEAM_STATE_SUBJECT),
    description: z.string().startsWith(TEAM_STATE_RECORD_PREFIX),
    status: z.literal('in_progress'),
    blockedBy: z.array(z.string()).max(0),
    writeScopes: z.tuple([z.literal(TEAM_STATE_PLUGIN)]),
  }).strict(),
}).strict()

type WindowTeamTaskRecord = z.infer<typeof windowTeamTaskRecordSchema>
type AppendKnownTeamTask = (type: 'team/task', data: WindowTeamTaskRecord) => SessionEvent

type WindowTeamProjectionDefinition = Omit<
  ProjectionDefinition<'windowTeam', WindowTeamProjection | null>,
  'wire'
> & {
  readonly wire: NonNullable<ProjectionDefinition<'windowTeam', WindowTeamProjection | null>['wire']>
}

/** Official projection unit carrying a rebuildable complete team view to the browser. */
export const windowTeamProjectionDefinition: WindowTeamProjectionDefinition = {
  key: 'windowTeam',
  stateVersion: 2,
  stateSchema: nullableWindowTeamSchema,
  init: () => null,
  apply: (state, event) => windowTeamFromEvent(event) ?? state,
  wire: {
    viewSchema: nullableWindowTeamSchema,
    view: state => state,
  },
}

/** Decode one current log-only record or an earlier model-visible snapshot. */
function windowTeamFromEvent(event: SessionEvent): WindowTeamProjection | undefined {
  const record = event as unknown as { readonly type: string; readonly data: unknown }
  if (record.type === 'team/task') {
    const parsedRecord = windowTeamTaskRecordSchema.safeParse(record.data)
    if (!parsedRecord.success) return undefined
    try {
      const parsed: unknown = JSON.parse(
        parsedRecord.data.task.description.slice(TEAM_STATE_RECORD_PREFIX.length),
      )
      const result = windowTeamSchema.safeParse(parsed)
      if (!result.success
        || result.data.revision !== parsedRecord.data.task.revision
        || parsedRecord.data.teamId !== stateRecordTeamId(result.data)) return undefined
      return result.data
    } catch {
      return undefined
    }
  }
  if (event.type !== 'user/message') return undefined
  const message = event.data
  if (message.source.kind !== 'plugin'
    || message.source.plugin !== TEAM_STATE_PLUGIN
    || message.source.form !== 'snapshot') return undefined
  const [block] = message.content
  if (message.content.length !== 1 || block?.type !== 'text' || !block.text.startsWith(LEGACY_TEAM_STATE_PREFIX)) {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(block.text.slice(LEGACY_TEAM_STATE_PREFIX.length))
    const result = windowTeamSchema.safeParse(parsed)
    return result.success ? result.data : undefined
  } catch {
    return undefined
  }
}

/** Fold the latest whole team state directly from the Session log. */
export function foldWindowTeam(events: readonly SessionEvent[]): WindowTeamProjection | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    const state = windowTeamFromEvent(event)
    if (state !== undefined) return state
    const legacy = event as { readonly type: string; readonly data: unknown }
    if (legacy.type === 'window-team/state') {
      const result = windowTeamSchema.safeParse(legacy.data)
      if (result.success) return result.data
    }
  }
  return null
}

/** Append one validated known event that never enters or replaces the model surface. */
export function appendWindowTeamState(session: Session, state: WindowTeamProjection): WindowTeamProjection {
  const validated = windowTeamSchema.parse(state)
  const json = JSON.stringify(validated)
  const append = session.append.bind(session) as unknown as AppendKnownTeamTask
  append('team/task', {
    version: 1,
    teamId: stateRecordTeamId(validated),
    task: {
      id: TEAM_STATE_TASK_ID,
      revision: validated.revision,
      subject: TEAM_STATE_SUBJECT,
      description: `${TEAM_STATE_RECORD_PREFIX}${json}`,
      status: 'in_progress',
      blockedBy: [],
      writeScopes: [TEAM_STATE_PLUGIN],
    },
  })
  return validated
}

/** Keep this plugin's records outside the implicit Team rooted at the leader Session. */
function stateRecordTeamId(state: WindowTeamProjection): string {
  return `${TEAM_STATE_PLUGIN}:${state.leaderSessionId}:${state.teamId}`
}

/** Recompute waiting and ready tasks after a dependency or owner change. */
export function refreshTaskReadiness(state: WindowTeamProjection): WindowTeamProjection {
  const completed = new Set(state.tasks.filter(task => task.status === 'completed').map(task => task.id))
  let changed = false
  const tasks = state.tasks.map(task => {
    if (task.status !== 'blocked' && task.status !== 'ready') return task
    const status: WindowTeamTask['status'] = task.dependsOn.every(id => completed.has(id)) ? 'ready' : 'blocked'
    if (status === task.status) return task
    changed = true
    return { ...task, status }
  })
  return changed ? { ...state, tasks } : state
}

/** Return a state replacement with one new revision and normalized dependency readiness. */
export function nextWindowTeamState(
  state: WindowTeamProjection,
  change: Omit<WindowTeamProjection, 'revision'>,
): WindowTeamProjection {
  return refreshTaskReadiness({ ...change, revision: state.revision + 1 })
}

/** Serialize mutations per leader Session so concurrent tools cannot lose updates. */
export class WindowTeamCoordinator {
  readonly #tails = new Map<string, Promise<void>>()

  /** Read the current immutable state from the authoritative Session log. */
  current(session: Session): WindowTeamProjection | null {
    return foldWindowTeam(session.snapshotEvents())
  }

  /** Run one state operation after prior work for the same leader has settled. */
  async run<T>(session: Session, operation: () => Promise<T> | T): Promise<T> {
    const key = String(session.id)
    const prior = this.#tails.get(key) ?? Promise.resolve()
    let resolveTail: () => void = () => undefined
    const tail = new Promise<void>(resolve => { resolveTail = resolve })
    this.#tails.set(key, tail)
    await prior.catch(() => undefined)
    try {
      return await operation()
    } finally {
      resolveTail()
      if (this.#tails.get(key) === tail) this.#tails.delete(key)
    }
  }

  /** Drop process-local serialization tails during plugin disposal. */
  clear(): void {
    this.#tails.clear()
  }
}
