/** Window collaboration action for the DSH session header. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WindowTeamProjection, WindowTeamTask, WindowTeamTaskStatus } from '../team-types.ts'
import { serializeWindowLink } from '../protocol.ts'
import type { WindowCollaborationKey } from './locales.ts'
import css from './WindowCollaborationAction.module.css'

/** Full props supplied by the session header action seat. */
export type WindowCollaborationActionProps =
  PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'sessionTeams'>

/** Session-list fields needed to present the same conversations as the sidebar. */
interface WindowSessionListView {
  readonly byId: Readonly<Record<string, {
    readonly displayTitle: string
    readonly running: boolean
    readonly blank?: boolean
    readonly origin?: string
    readonly cwd?: string
  } | undefined>>
}

/** Workspace-baseline fields needed to hide archived conversations like the sidebar. */
interface WorkspaceArchiveView {
  readonly archivedSessionIds?: readonly string[]
}

interface WindowListItem {
  readonly id: string
  readonly displayTitle: string
  readonly running: boolean
  readonly cwd: string | undefined
}

/** One conversation a user can select from the panel, carrying its exact address. */
interface WindowTarget {
  readonly id: string
  readonly displayTitle: string
}

/** Conversations of one workspace directory, ready to render as a group. */
interface WindowGroup {
  readonly key: string
  readonly label: string
  readonly current: boolean
  readonly windows: readonly WindowListItem[]
}

/** Show the search input once the directory grows past a single glanceable screen. */
const SEARCH_THRESHOLD = 6

/** Show the active visible-window team first, with the wider conversation list as a secondary view. */
export function WindowCollaborationAction({
  sessionId,
  useSessions,
  useWorkspaces,
  useProjection,
  useInput,
  inputActions,
  t,
}: WindowCollaborationActionProps) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [showDirectory, setShowDirectory] = useState(false)
  const [query, setQuery] = useState('')
  const sessions: WindowSessionListView = useSessions((snapshot: WindowSessionListView) => snapshot)
  const archivedIds = useWorkspaces((snapshot: WorkspaceArchiveView) => snapshot.archivedSessionIds)
  const draft = useInput((snapshot: InputState) => snapshot.draft)
  const team = (useProjection('windowTeam') as WindowTeamProjection | null | undefined) ?? null
  const currentTitle = sessions.byId[sessionId]?.displayTitle ?? t('current.fallback')
  const currentCwd = sessions.byId[sessionId]?.cwd
  const windows = conversationWindows(sessions, sessionId, new Set(archivedIds ?? []))
  const completed = team?.tasks.filter(task => task.status === 'completed').length ?? 0
  const taskCount = team?.tasks.length ?? 0
  const memberCount = team?.members.filter(member => member.created).length ?? 0
  const triggerCount = team === null ? windows.length : memberCount
  const badgeCount = team === null ? 0 : memberCount

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target) !== true) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const positionPanel = () => {
      const trigger = triggerRef.current
      const panel = panelRef.current
      if (trigger === null || panel === null) return
      const triggerBox = trigger.getBoundingClientRect()
      const panelBox = panel.getBoundingClientRect()
      const inset = 12
      const gap = 7
      const furthestLeft = Math.max(inset, window.innerWidth - panelBox.width - inset)
      const furthestTop = Math.max(inset, window.innerHeight - panelBox.height - inset)
      panel.style.left = `${String(Math.min(Math.max(triggerBox.left, inset), furthestLeft))}px`
      panel.style.top = `${String(Math.min(triggerBox.bottom + gap, furthestTop))}px`
    }
    positionPanel()
    window.addEventListener('resize', positionPanel)
    window.addEventListener('scroll', positionPanel, true)
    return () => {
      window.removeEventListener('resize', positionPanel)
      window.removeEventListener('scroll', positionPanel, true)
    }
  }, [open, showDirectory, query, taskCount, triggerCount])

  const triggerLabel: WindowCollaborationKey = team === null
    ? triggerCount === 0 ? 'trigger.label' : 'trigger.count'
    : 'trigger.team'
  const renderedTriggerLabel = t(triggerLabel, { count: triggerCount })
  const selectWindow = (target: WindowTarget) => {
    const link = serializeWindowLink(target.id)
    inputActions.setDraft(composeWindowDraft(t('composer.target', { name: target.displayTitle, link }), draft))
    setOpen(false)
    window.requestAnimationFrame(focusComposer)
  }

  return (
    <span ref={rootRef} className={css.root}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={renderedTriggerLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={renderedTriggerLabel}
        data-open={open}
        data-window-count={windows.length}
        data-team-count={memberCount}
        onClick={() => { setOpen(value => !value) }}
      >
        <CollaborationIcon className={css.triggerIcon} />
        {badgeCount > 0 && <span className={css.badge} aria-hidden="true">{badgeCount}</span>}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          className={css.panel}
          role="dialog"
          aria-label={t(team === null ? 'panel.title' : 'team.title')}
          tabIndex={-1}
        >
          {team === null
            ? (
              <DirectoryView
                currentTitle={currentTitle}
                currentCwd={currentCwd}
                windows={windows}
                query={query}
                setQuery={setQuery}
                onSelectWindow={selectWindow}
                t={t}
              />
            )
            : (
              <TeamView
                team={team}
                currentTitle={currentTitle}
                currentCwd={currentCwd}
                windows={windows}
                completed={completed}
                showDirectory={showDirectory}
                setShowDirectory={setShowDirectory}
                query={query}
                setQuery={setQuery}
                onSelectWindow={selectWindow}
                t={t}
              />
            )}
        </div>
      )}
    </span>
  )
}

interface SharedViewProps {
  readonly currentTitle: string
  readonly currentCwd: string | undefined
  readonly windows: readonly WindowListItem[]
  readonly query: string
  readonly setQuery: (value: string) => void
  readonly onSelectWindow: (target: WindowTarget) => void
  readonly t: WindowCollaborationActionProps['t']
}

/** Empty-team directory view for direct title-based conversation. */
function DirectoryView({ currentTitle, currentCwd, windows, query, setQuery, onSelectWindow, t }: SharedViewProps) {
  const matches = searchWindows(windows, query)
  const groups = workspaceGroups(matches, currentCwd, t)
  return (
    <>
      <PanelHeading
        icon={<CollaborationIcon className={css.headingIconSvg} />}
        title={t('panel.title')}
        subtitle={t('panel.subtitle')}
      />
      <CurrentWindow title={currentTitle} label={t('current.label')} />
      {windows.length > SEARCH_THRESHOLD && (
        <SearchInput value={query} onChange={setQuery} placeholder={t('search.placeholder')} />
      )}
      {windows.length > 0 ? (
        <div className={css.section}>
          <div className={css.sectionHeading}>
            <span>{t('window.list')}</span>
            <span className={css.sectionCount}>{t('panel.count', { count: matches.length })}</span>
          </div>
          {matches.length === 0
            ? <div className={css.searchEmpty}>{t('search.empty')}</div>
            : <GroupedConversationList groups={groups} onSelectWindow={onSelectWindow} t={t} />}
        </div>
      ) : (
        <div className={css.empty}>
          <span className={css.emptyTitle}>{t('empty.title')}</span>
          <span className={css.emptyBody}>{t('empty.body')}</span>
        </div>
      )}
      <PanelHint>{t(windows.length === 0 ? 'hint.empty' : 'hint.ready')}</PanelHint>
    </>
  )
}

interface TeamViewProps extends SharedViewProps {
  readonly team: WindowTeamProjection
  readonly completed: number
  readonly showDirectory: boolean
  readonly setShowDirectory: (value: boolean) => void
}

/** Team-first view with progress, roles, and task state. */
function TeamView({
  team,
  currentTitle,
  currentCwd,
  windows,
  completed,
  showDirectory,
  setShowDirectory,
  query,
  setQuery,
  onSelectWindow,
  t,
}: TeamViewProps) {
  const active = team.tasks.filter(task => task.status === 'running' || task.status === 'queued').length
  const other = otherWindows(team, windows)
  const otherMatches = searchWindows(other, query)
  const otherGroups = workspaceGroups(otherMatches, currentCwd, t)
  return (
    <>
      <PanelHeading
        icon={<TeamIcon className={css.headingIconSvg} />}
        title={t('team.title')}
        subtitle={team.goal}
        aside={(
          <span className={css.progressText}>
            <strong>{completed}</strong> / {team.tasks.length}
          </span>
        )}
      />
      <div className={css.progressTrack} aria-label={t('team.progress', { completed, count: team.tasks.length })}>
        <span style={{ width: `${String(team.tasks.length === 0 ? 0 : completed / team.tasks.length * 100)}%` }} />
      </div>
      <div className={css.teamSummary}>
        <span>{t('team.members', { count: team.members.filter(member => member.created).length })}</span>
        <span className={css.summaryDivider} aria-hidden="true" />
        <span>{t('team.active', { count: active })}</span>
      </div>

      <div className={css.memberList} role="list" aria-label={t('team.members.label')}>
        <MemberRow
          name={currentTitle}
          role={team.leaderRole}
          task={null}
          leader
          complete={team.tasks.length > 0 && completed === team.tasks.length}
          t={t}
        />
        {team.members.filter(member => member.created).map(member => {
          const title = windows.find(window => window.id === member.sessionId)?.displayTitle ?? member.name
          return (
            <MemberRow
              key={member.sessionId}
              name={title}
              role={member.role}
              task={primaryTask(team.tasks.filter(task => task.ownerSessionId === member.sessionId))}
              leader={false}
              complete={false}
              onSelect={() => { onSelectWindow({ id: member.sessionId, displayTitle: title }) }}
              t={t}
            />
          )
        })}
      </div>

      {other.length > 0 && (
        <div className={css.otherSection}>
          <button
            type="button"
            className={css.disclosure}
            aria-expanded={showDirectory}
            onClick={() => { setShowDirectory(!showDirectory) }}
          >
            <span>{t('other.title')}</span>
            <span className={css.disclosureMeta}>{t('other.count', { count: other.length })}</span>
            <ChevronIcon className={css.chevron} open={showDirectory} />
          </button>
          {showDirectory && (
            <>
              {other.length > SEARCH_THRESHOLD && (
                <SearchInput value={query} onChange={setQuery} placeholder={t('search.placeholder')} />
              )}
              {otherMatches.length === 0
                ? <div className={css.searchEmpty}>{t('search.empty')}</div>
                : <GroupedConversationList groups={otherGroups} onSelectWindow={onSelectWindow} t={t} compact />}
            </>
          )}
        </div>
      )}
      <PanelHint>{t('team.hint')}</PanelHint>
    </>
  )
}

/** One directory list split into labeled workspace groups. */
function GroupedConversationList({ groups, onSelectWindow, t, compact = false }: {
  readonly groups: readonly WindowGroup[]
  readonly onSelectWindow: (target: WindowTarget) => void
  readonly t: WindowCollaborationActionProps['t']
  readonly compact?: boolean
}) {
  return (
    <>
      {groups.map(group => (
        <div className={css.group} key={group.key === '' ? 'unnamed' : group.key}>
          <div className={css.groupHeading}>
            <span className={css.groupLabel}>{group.label}</span>
            <span className={css.groupCount}>{t('panel.count', { count: group.windows.length })}</span>
          </div>
          <ConversationList windows={group.windows} onSelectWindow={onSelectWindow} t={t} compact={compact} />
        </div>
      ))}
    </>
  )
}

interface SearchInputProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder: string
}

/** Filter-by-title input; Escape clears the query before the panel reacts. */
function SearchInput({ value, onChange, placeholder }: SearchInputProps) {
  return (
    <div className={css.searchRow}>
      <SearchIcon className={css.searchIcon} />
      <input
        className={css.searchInput}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={event => { onChange(event.target.value) }}
        onKeyDown={event => {
          if (event.key === 'Escape' && value.length > 0) {
            event.stopPropagation()
            onChange('')
          }
        }}
      />
    </div>
  )
}

interface PanelHeadingProps {
  readonly icon: ReactNode
  readonly title: string
  readonly subtitle: string
  readonly aside?: ReactNode
}

function PanelHeading({ icon, title, subtitle, aside }: PanelHeadingProps) {
  return (
    <div className={css.panelHeader}>
      <span className={css.headingIcon} aria-hidden="true">{icon}</span>
      <span className={css.headingText}>
        <span className={css.panelTitle}>{title}</span>
        <span className={css.panelSubtitle}>{subtitle}</span>
      </span>
      {aside}
    </div>
  )
}

function CurrentWindow({ title, label }: { readonly title: string; readonly label: string }) {
  return (
    <div className={css.currentRow}>
      <span className={css.avatar} aria-hidden="true">{initial(title)}</span>
      <span className={css.currentText}>
        <span className={css.eyebrow}>{label}</span>
        <span className={css.currentTitle}>{title}</span>
      </span>
    </div>
  )
}

interface MemberRowProps {
  readonly name: string
  readonly role: string
  readonly task: WindowTeamTask | null
  readonly leader: boolean
  readonly complete: boolean
  readonly onSelect?: () => void
  readonly t: WindowCollaborationActionProps['t']
}

function MemberRow({ name, role, task, leader, complete, onSelect, t }: MemberRowProps) {
  const content = (
    <>
      <span className={leader ? css.leaderAvatar : css.memberAvatar} aria-hidden="true">{initial(name)}</span>
      <span className={css.memberText}>
        <span className={css.memberTitleLine}>
          <span className={css.memberName}>{name}</span>
          {leader && <span className={css.leaderTag}>{t('current.leader')}</span>}
        </span>
        <span className={css.memberRole}>{role}</span>
        {task !== null && (
          <span className={css.taskLine} title={task.title}>
            <span className={css.taskBranch} aria-hidden="true" />
            {task.title}
          </span>
        )}
      </span>
      {task === null
        ? complete
          ? <TaskStatus status="completed" t={t} />
          : <span className={css.coordinatingStatus}>{t('task.coordinating')}</span>
        : <TaskStatus status={task.status} t={t} />}
    </>
  )
  return (
    <div role="listitem">
      {onSelect === undefined
        ? <div className={css.memberRow}>{content}</div>
        : (
          <button
            type="button"
            className={css.memberRow}
            aria-label={t('window.compose', { name })}
            title={t('window.compose', { name })}
            onClick={onSelect}
          >
            {content}
          </button>
        )}
    </div>
  )
}

function TaskStatus({ status, t }: { readonly status: WindowTeamTaskStatus; readonly t: WindowCollaborationActionProps['t'] }) {
  return (
    <span className={css.taskStatus} data-status={status}>
      <span className={css.statusDot} aria-hidden="true" />
      {t(`task.${status}` as WindowCollaborationKey)}
    </span>
  )
}

function ConversationList({ windows, onSelectWindow, t, compact = false }: {
  readonly windows: readonly WindowListItem[]
  readonly onSelectWindow: (target: WindowTarget) => void
  readonly t: WindowCollaborationActionProps['t']
  readonly compact?: boolean
}) {
  return (
    <div className={compact ? css.compactWindowList : css.windowList} role="list" aria-label={t('window.list')}>
      {windows.map(window => (
        <div key={window.id} role="listitem">
          <button
            type="button"
            className={css.windowRow}
            aria-label={t('window.compose', { name: window.displayTitle })}
            title={t('window.compose', { name: window.displayTitle })}
            onClick={() => { onSelectWindow({ id: window.id, displayTitle: window.displayTitle }) }}
          >
            <span className={css.smallAvatar} aria-hidden="true">{initial(window.displayTitle)}</span>
            <span className={css.windowTitle}>{window.displayTitle}</span>
            <span className={window.running ? css.workingStatus : css.availableStatus}>
              <span className={css.statusDot} aria-hidden="true" />
              {t(window.running ? 'window.working' : 'window.available')}
            </span>
          </button>
        </div>
      ))}
    </div>
  )
}

function PanelHint({ children }: { readonly children: ReactNode }) {
  return (
    <div className={css.footer}>
      <span className={css.hintMark} aria-hidden="true">i</span>
      <span>{children}</span>
    </div>
  )
}

/** List ordinary addressable conversations, hiding blank, subagent, and archived rows like the sidebar. */
function conversationWindows(
  sessions: WindowSessionListView,
  sessionId: string,
  archived: ReadonlySet<string>,
): WindowListItem[] {
  return Object.entries(sessions.byId)
    .flatMap(([id, summary]) => id === sessionId || summary === undefined
      || summary.blank === true || summary.origin === 'subagent' || archived.has(id)
        ? []
        : [{ id, displayTitle: summary.displayTitle, running: summary.running, cwd: summary.cwd }])
    .sort((left, right) => {
      if (left.running !== right.running) return left.running ? -1 : 1
      return left.displayTitle.localeCompare(right.displayTitle)
    })
}

/** Apply the title query, case-insensitively, without mutating the source list. */
function searchWindows(windows: readonly WindowListItem[], query: string): WindowListItem[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return [...windows]
  return windows.filter(window => window.displayTitle.toLowerCase().includes(needle))
}

/** Collapse the directory into workspace groups, current workspace first. */
function workspaceGroups(
  windows: readonly WindowListItem[],
  currentCwd: string | undefined,
  t: WindowCollaborationActionProps['t'],
): WindowGroup[] {
  const byKey = new Map<string, WindowListItem[]>()
  for (const window of windows) {
    const key = window.cwd ?? ''
    const bucket = byKey.get(key)
    if (bucket === undefined) byKey.set(key, [window])
    else bucket.push(window)
  }
  return [...byKey.entries()]
    .map(([key, groupWindows]) => ({
      key,
      current: key !== '' && key === currentCwd,
      label: key === ''
        ? t('group.unnamed')
        : key === currentCwd ? t('group.current', { name: workspaceLabel(key) }) : workspaceLabel(key),
      windows: groupWindows,
    }))
    .sort((left, right) => {
      if (left.current !== right.current) return left.current ? -1 : 1
      return left.label.localeCompare(right.label)
    })
}

/** Derive a short workspace label from its directory path. */
function workspaceLabel(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/u, '')
  const segment = trimmed.split('/').filter(Boolean).at(-1)
  return segment === undefined || segment.length === 0 ? cwd : segment
}

function primaryTask(tasks: readonly WindowTeamTask[]): WindowTeamTask | null {
  const order: Record<WindowTeamTaskStatus, number> = {
    running: 0,
    queued: 1,
    ready: 2,
    failed: 3,
    blocked: 4,
    completed: 5,
  }
  return [...tasks].sort((left, right) => order[left.status] - order[right.status])[0] ?? null
}

function otherWindows(team: WindowTeamProjection, windows: readonly WindowListItem[]): WindowListItem[] {
  const memberIds = new Set(team.members.map(member => member.sessionId))
  return windows.filter(window => !memberIds.has(window.id))
}

function initial(title: string): string {
  return Array.from(title.trim())[0]?.toLocaleUpperCase() ?? '-'
}

function composeWindowDraft(prefix: string, draft: string): string {
  if (draft.startsWith(prefix)) return draft
  return draft.trim().length === 0 ? prefix : `${prefix}${draft}`
}

function focusComposer(): void {
  document.querySelector<HTMLElement>('[data-composer-input="true"]')?.focus()
}

function CollaborationIcon({ className }: { readonly className: string | undefined }) {
  return (
    <svg className={className} viewBox="0 0 18 18" aria-hidden="true">
      <rect x="1.75" y="3" width="10" height="8" rx="2" />
      <path d="M4.5 11v2l2.4-2" />
      <rect x="6.25" y="7" width="10" height="8" rx="2" />
      <path d="M13.5 15v1.5L11.6 15" />
    </svg>
  )
}

function TeamIcon({ className }: { readonly className: string | undefined }) {
  return (
    <svg className={className} viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="6" cy="6" r="2.25" />
      <circle cx="13" cy="7" r="1.75" />
      <path d="M2.5 14c.5-2.35 1.7-3.5 3.5-3.5s3 1.15 3.5 3.5M10.5 14c.35-1.85 1.2-2.75 2.55-2.75 1.3 0 2.15.9 2.45 2.75" />
    </svg>
  )
}

function ChevronIcon({ className, open }: { readonly className: string | undefined; readonly open: boolean }) {
  return (
    <svg className={className} data-open={open} viewBox="0 0 14 14" aria-hidden="true">
      <path d="m4 5.5 3 3 3-3" />
    </svg>
  )
}

function SearchIcon({ className }: { readonly className: string | undefined }) {
  return (
    <svg className={className} viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="6" cy="6" r="3.75" />
      <path d="m8.75 8.75 3 3" />
    </svg>
  )
}
