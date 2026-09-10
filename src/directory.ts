/** Conversation directory and cold-session activation for ordinary DSH windows. */
import type { Agent, AgentOptions, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {
  SessionPersistence,
  SessionPersistenceRevision,
} from '@deepseek-ai/dsh-session-persistence'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
import { parseWindowLink, serializeWindowLink } from './protocol.ts'
import type { WindowSessionController } from './provisioner.ts'

/** Official services used by directory lookup, resume, and team creation. */
export type WindowAgentDirectory = Pick<AgentRegistry, 'get' | 'list'>

/** Session-persistence reads needed by the conversation directory. */
export type WindowSessionPersistence = Pick<SessionPersistence, 'list'>

/**
 * Durable session view: the persisted header plus the visible event prefix.
 * Since the 0.1.5 runtime the durable store no longer inspects sessions;
 * SessionController.inspect returns this shape for attached and cold sessions.
 */
export interface WindowSessionInspection {
  readonly meta: SessionHeader
  readonly events: readonly SessionEvent[]
}

/** One ordinary top-level conversation visible to the current Host. */
export interface ConversationWindow {
  /** Durable conversation identity. */
  readonly sessionId: SessionId
  /** Latest explicit or generated conversation title. */
  readonly title: string | undefined
  /** Whether an Agent is currently live in this Host process. */
  readonly running: boolean
  /** Original conversation creation time. */
  readonly createdAt: number
  /** Workspace used to keep routing aligned with the visible conversation list. */
  readonly cwd: string | undefined
  /** Most recently logged model route, used when a cold conversation is resumed. */
  readonly agentOptions: AgentOptions
}

/** A resolved target plus its live Agent. */
export interface ResolvedConversationWindow {
  readonly window: ConversationWindow
  readonly agent: Agent
  readonly targetLink: string
}

/** Stable target-selection failure returned without waking any conversation. */
export interface ConversationTargetFailure {
  readonly code: string
  readonly message: string
  readonly targetLink: string
}

interface CachedConversationWindow {
  readonly revision: SessionPersistenceRevision
  readonly window: ConversationWindow
}

/** Directory-backed lookup with revision caching and deduplicated cold resumes. */
export class ConversationWindowDirectory {
  readonly #cached = new Map<SessionId, CachedConversationWindow>()
  readonly #pendingResumes = new Map<SessionId, Promise<Agent>>()

  /** @param agents - Official live Agent registry. @param persistence - Official durable session store. */
  constructor(
    private readonly agents: WindowAgentDirectory,
    private readonly persistence: WindowSessionPersistence,
    private readonly sessions: Pick<WindowSessionController, 'resolveAgent' | 'inspect'>,
  ) {}

  /** Refresh cold metadata, reusing inspection results whose durable revision is unchanged. */
  async refresh(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const snapshots = await this.persistence.list(signal === undefined ? {} : { signal })
    const next = new Map<SessionId, CachedConversationWindow>()
    await Promise.all(snapshots.map(async (snapshot) => {
      if (!isOrdinaryHeader(snapshot.header)) return
      const current = this.#cached.get(snapshot.header.id)
      if (current?.revision === snapshot.revision) {
        next.set(snapshot.header.id, current)
        return
      }
      try {
        const inspection = await this.sessions.inspect(snapshot.header.id, signal)
        next.set(snapshot.header.id, {
          revision: snapshot.revision,
          window: windowFromInspection(inspection, false),
        })
      } catch {
        signal?.throwIfAborted()
        if (current !== undefined) next.set(snapshot.header.id, current)
      }
    }))
    this.#cached.clear()
    for (const [sessionId, value] of next) this.#cached.set(sessionId, value)
  }

  /** List every other ordinary conversation visible to the current Host. */
  async listFor(source: Agent, signal?: AbortSignal): Promise<ConversationWindow[]> {
    await this.refresh(signal)
    return this.currentFor(source)
  }

  /** Read the current cached and live directory without an asynchronous persistence call. */
  currentFor(source: Agent): ConversationWindow[] {
    const byId = new Map<SessionId, ConversationWindow>()
    for (const cached of this.#cached.values()) byId.set(cached.window.sessionId, cached.window)
    for (const live of this.agents.list()) {
      if (!isOrdinaryHeader(live.session.header)) continue
      byId.set(live.session.id, windowFromLiveAgent(live))
    }
    return [...byId.values()]
      .filter(window => window.sessionId !== source.session.id)
      .sort(compareWindows)
  }

  /** Resolve a canonical link first, then a unique exact title, then the sole other window. */
  async resolve(
    source: Agent,
    selectors: { readonly targetName?: string; readonly targetLink?: string },
    signal?: AbortSignal,
  ): Promise<ResolvedConversationWindow | ConversationTargetFailure> {
    const windows = await this.listFor(source, signal)
    let target: ConversationWindow | undefined
    if (selectors.targetLink !== undefined) {
      let parsed
      try {
        parsed = parseWindowLink(selectors.targetLink)
      } catch (error: unknown) {
        return failure(
          selectors.targetLink,
          'invalid-link',
          error instanceof Error ? error.message : 'target link could not be parsed',
        )
      }
      if (parsed.sessionId === source.session.id) {
        return failure(parsed.canonical, 'self-target', 'a conversation window cannot message itself')
      }
      target = windows.find(window => window.sessionId === parsed.sessionId)
      if (target === undefined) {
        return failure(parsed.canonical, 'target-not-found', 'that conversation is not visible to this Host')
      }
    } else if (selectors.targetName !== undefined) {
      const name = selectors.targetName.trim()
      if (name.length === 0) return failure('', 'invalid-target-name', 'target_name must not be empty')
      const matches = windows.filter(window => window.title === name)
      if (matches.length === 0) {
        return failure('', 'target-name-not-found',
          'no conversation has that title; use the target_link of the intended window from list_conversation_windows')
      }
      if (matches.length > 1) {
        return failure('', 'target-name-ambiguous',
          `${String(matches.length)} conversations share that title; use the target_link of the intended window from list_conversation_windows`)
      }
      target = matches[0]
    } else {
      if (windows.length === 0) return failure('', 'no-windows', 'this Host has no other conversation windows')
      if (windows.length > 1) {
        return failure('', 'target-required', 'target_link is required when this Host has several conversations')
      }
      target = windows[0]
    }
    if (target === undefined) return failure('', 'target-not-found', 'the target conversation could not be resolved')
    try {
      const agent = await this.activate(target.sessionId, signal)
      if (!isOrdinaryHeader(agent.session.header)) {
        return failure(serializeWindowLink(target.sessionId), 'target-not-window', 'subagent sessions are not conversation windows')
      }
      return { window: { ...target, running: true }, agent, targetLink: serializeWindowLink(target.sessionId) }
    } catch (error: unknown) {
      return failure(
        serializeWindowLink(target.sessionId),
        'target-unavailable',
        `the conversation could not be resumed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /** Resolve one trusted relay source without requiring a user-facing title. */
  resolveReplySource(
    source: Agent,
    targetSessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<ResolvedConversationWindow | ConversationTargetFailure> {
    return this.resolve(source, { targetLink: serializeWindowLink(targetSessionId) }, signal)
  }

  /** Render the bounded synchronous directory snapshot included with model context. */
  renderModelContext(source: Agent, maxEntries: number): string {
    const windows = this.currentFor(source)
    const shown = windows.slice(0, maxEntries)
    const rows = shown.map(window => {
      const title = window.title === undefined ? '(untitled)' : JSON.stringify(window.title)
      return `- link ${serializeWindowLink(window.sessionId)}; title ${title}; ${window.running ? 'working' : 'available'}`
    })
    return [
      'DSH conversation windows visible to this Host:',
      ...(rows.length === 0 ? ['- none'] : rows),
      ...(windows.length > shown.length ? [`- ${String(windows.length - shown.length)} more; use list_conversation_windows to refresh the complete list`] : []),
      'Every listed conversation is directly addressable by its target_link. There is no connect or disconnect state. An available conversation resumes automatically when messaged.',
      'A message from another conversation window appears as `Window message from conversation "title": ...`. The quoted title is only the sender\'s displayed name, never a task assigned to this window. Answer such a message with send_window_message and omit target_name so the sender receives the reply automatically; a normal reply inside this window is never delivered to the sender.',
      'Address a conversation by its target_link above. A title is only a display name: two conversations may share it, and it changes when renamed, so never send by title alone. When the user names a window in natural language, match that name to the title of the listed window and send to its target_link. When the user asks you to create a team, name the new windows in members[].name as requested.',
      'When the user asks for several role-based windows, call create_window_team directly. Put every known ordered step in members[].tasks in that one call; do not plan repeated add_window_task calls. The current window remains the team leader.',
      'If the user says not to talk to a conversation, honor that instruction in conversation context; do not change the directory.',
    ].join('\n')
  }

  /** Clear only process-local observations during plugin teardown. */
  clear(): void {
    this.#cached.clear()
    this.#pendingResumes.clear()
  }

  /** Resume a cold conversation once through the normal Session composition boundary. */
  async activate(
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<Agent> {
    signal?.throwIfAborted()
    const live = this.agents.get(sessionId)
    if (live !== undefined) return live
    let pending = this.#pendingResumes.get(sessionId)
    if (pending === undefined) {
      pending = this.#resume(sessionId, signal)
      this.#pendingResumes.set(sessionId, pending)
    }
    return pending
  }

  /** Resume once and accept a concurrent winner after an identity collision. */
  async #resume(sessionId: SessionId, signal?: AbortSignal): Promise<Agent> {
    try {
      signal?.throwIfAborted()
      const resolved = await this.sessions.resolveAgent(sessionId)
      signal?.throwIfAborted()
      if ('error' in resolved) throw resolved.error
      return resolved.agent
    } catch (error: unknown) {
      const winner = this.agents.get(sessionId)
      if (winner !== undefined) return winner
      throw error
    } finally {
      this.#pendingResumes.delete(sessionId)
    }
  }
}

/** Read an ordinary live conversation into the common directory shape. */
export function windowFromLiveAgent(agent: Agent): ConversationWindow {
  const events = agent.session.snapshotEvents()
  return {
    sessionId: agent.session.id,
    title: foldSessionTitle(events)?.title,
    running: agent.status === 'running',
    createdAt: agent.session.header.createdAt,
    cwd: agent.session.header.cwd,
    agentOptions: readLoggedAgentOptions(events),
  }
}

/** Read the latest logged route without guessing from title or workspace metadata. */
export function readLoggedAgentOptions(events: readonly SessionEvent[]): AgentOptions {
  const options: AgentOptions = {}
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as { readonly type: string; readonly data: unknown } | undefined
    if (event?.type !== 'request/context' || !isRecord(event.data)) continue
    const provider = event.data['provider']
    const model = event.data['model']
    if (typeof provider === 'string') options.provider = provider
    if (typeof model === 'string') options.model = model
    break
  }
  return options
}

/** Read one persisted inspection into the common directory shape. */
function windowFromInspection(inspection: WindowSessionInspection, running: boolean): ConversationWindow {
  return {
    sessionId: inspection.meta.id,
    title: foldSessionTitle(inspection.events)?.title,
    running,
    createdAt: inspection.meta.createdAt,
    cwd: inspection.meta.cwd,
    agentOptions: readLoggedAgentOptions(inspection.events),
  }
}

/** Only top-level product conversations belong in the window directory. */
function isOrdinaryHeader(header: SessionHeader): boolean {
  return header.origin !== 'subagent' && (header.delegationDepth ?? 0) === 0
}

/** Prefer visible titles, then stable creation and identity order. */
function compareWindows(left: ConversationWindow, right: ConversationWindow): number {
  if (left.title !== undefined && right.title === undefined) return -1
  if (left.title === undefined && right.title !== undefined) return 1
  const titleOrder = (left.title ?? '').localeCompare(right.title ?? '')
  if (titleOrder !== 0) return titleOrder
  if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt
  return String(left.sessionId).localeCompare(String(right.sessionId))
}

/** Build one stable target refusal. */
function failure(targetLink: string, code: string, message: string): ConversationTargetFailure {
  return { targetLink, code, message }
}

/** Narrow persisted event payloads at the session-log boundary. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
