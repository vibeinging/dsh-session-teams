// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WindowCollaborationAction } from '../src/client/WindowCollaborationAction.tsx'
import { WindowRelayMessage } from '../src/client/WindowRelayMessage.tsx'
import { apply, inject } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'
import { renderVisibleWindowMessage, visibleWindowMessageSource, windowRelaySource, WINDOW_RELAY_REPLY_CONTRACT, WINDOW_RELAY_SOURCE_FRAMING } from '../src/protocol.ts'
import type { WindowTeamProjection } from '../src/team-types.ts'

const messages: Record<string, string> = zh

const t = (key: string, params?: Record<string, unknown>): string => {
  let message = messages[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) message = message.replace(`{${name}}`, String(value))
  return message
}

function props(
  sessionId: string,
  peers: Array<{
    id: string
    title: string
    running: boolean
    blank?: boolean
    origin?: string
    cwd?: string
  }> = [],
  team: WindowTeamProjection | null = null,
  draft = '',
  setDraft = vi.fn(),
  currentCwd?: string,
  archivedIds: readonly string[] = [],
) {
  const sessionList = {
    byId: Object.fromEntries([
      [sessionId, {
        displayTitle: '产品窗口',
        running: false,
        ...(currentCwd === undefined ? {} : { cwd: currentCwd }),
      }],
      ...peers.map(peer => [peer.id, {
        displayTitle: peer.title,
        running: peer.running,
        ...(peer.blank === undefined ? {} : { blank: peer.blank }),
        ...(peer.origin === undefined ? {} : { origin: peer.origin }),
        ...(peer.cwd === undefined ? {} : { cwd: peer.cwd }),
      }]),
    ]),
  }
  const workspaceList = { archivedSessionIds: archivedIds }
  return {
    sessionId,
    t,
    useSessions: (select: (snapshot: typeof sessionList) => unknown) => select(sessionList),
    useWorkspaces: (select: (snapshot: typeof workspaceList) => unknown) => select(workspaceList),
    useProjection: () => team,
    useInput: (select: (snapshot: { draft: string }) => unknown) => select({ draft }),
    inputActions: { setDraft },
  } as never
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('conversation window header action', () => {
  it('registers through the declared conversation header action slot', () => {
    const OriginalUser = () => null
    const OriginalSteering = () => null
    const OriginalContext = () => null
    const localeRegister = vi.fn(() => () => {})
    const localeBind = vi.fn(() => t)
    const slotRegister = vi.fn(() => () => {})
    const slotInject = vi.fn((_name: string, register: () => void) => { register() })
    const entriesOfSlot = vi.fn(() => [
      { component: OriginalUser, options: { key: 'user', priority: 0 } },
      { component: OriginalSteering, options: { key: 'steering', priority: 0 } },
      { component: OriginalContext, options: { key: 'context', priority: 0 } },
    ])
    const subscribe = vi.fn(() => () => {})
    const effect = vi.fn((register: () => unknown) => { register() })
    apply({
      effect,
      locale: { register: localeRegister, bind: localeBind },
      slots: { inject: slotInject, register: slotRegister, entriesOfSlot, subscribe },
      sessions: { open: vi.fn() },
    } as never)
    expect(inject).toEqual(['slots', 'locale', 'sessions'])
    expect(localeRegister).toHaveBeenCalledWith('sessionTeams', expect.any(Object))
    expect(slotRegister).toHaveBeenCalledWith(expect.objectContaining({
      name: 'conversation.session.header.actions',
      id: 'session-teams-directory',
    }), WindowCollaborationAction)
    for (const key of ['user', 'steering', 'context']) {
      expect(slotRegister).toHaveBeenCalledWith(expect.objectContaining({
        name: 'conversation.chat.node',
        key,
        priority: -1,
        locale: 'sessionTeams',
      }), expect.any(Function))
    }
  })

  it('waits until the built-in Chat message renderers finish registering', () => {
    const OriginalUser = () => null
    const OriginalSteering = () => null
    const OriginalContext = () => null
    let entries: Array<{ component: () => null; options: { key: string; priority: number } }> = []
    let changed = () => {}
    const slotRegister = vi.fn(() => () => {})
    apply({
      effect: (register: () => unknown) => { register() },
      locale: { register: () => () => {}, bind: () => t },
      slots: {
        inject: (_name: string, register: () => void) => { register() },
        register: slotRegister,
        entriesOfSlot: () => entries,
        subscribe: (_name: string, listener: () => void) => {
          changed = listener
          return () => {}
        },
      },
      sessions: { open: vi.fn() },
    } as never)
    const relayKeys = (options: { key: string }) => ['user', 'steering', 'context'].includes(options.key)
    expect(slotRegister.mock.calls.filter(([options]) => relayKeys(options))).toHaveLength(0)
    entries = [
      { component: OriginalUser, options: { key: 'user', priority: 0 } },
      { component: OriginalSteering, options: { key: 'steering', priority: 0 } },
    ]
    changed()
    expect(slotRegister.mock.calls.filter(([options]) => relayKeys(options))).toHaveLength(0)
    entries = [
      { component: OriginalUser, options: { key: 'user', priority: 0 } },
      { component: OriginalSteering, options: { key: 'steering', priority: 0 } },
      { component: OriginalContext, options: { key: 'context', priority: 0 } },
    ]
    changed()
    expect(slotRegister.mock.calls.filter(([options]) => relayKeys(options))).toHaveLength(3)
  })

  it('shows an empty team-oriented state without invitation controls', () => {
    const view = render(<WindowCollaborationAction {...props('session-one')} />)
    fireEvent.click(view.getByRole('button', { name: '窗口协作' }))
    expect(view.getByRole('dialog', { name: '窗口协作' })).toBeDefined()
    expect(view.getByText('还没有其他对话')).toBeDefined()
    expect(view.getByText('试试说“创建两个窗口，一个开发，一个测试”。')).toBeDefined()
    expect(view.queryByText(/邀请/u)).toBeNull()
  })

  it('shows every conversation with working and available state', () => {
    const view = render(<WindowCollaborationAction {...props('session-current', [
      { id: 'code', title: '开发窗口', running: true },
      { id: 'test', title: '测试窗口', running: false },
    ])} />)
    const trigger = view.getByRole('button', { name: '可对话的窗口：2 个' })
    expect(trigger.getAttribute('data-window-count')).toBe('2')
    fireEvent.click(trigger)
    expect(view.getByText('产品窗口')).toBeDefined()
    expect(view.getByText('开发窗口')).toBeDefined()
    expect(view.getByText('测试窗口')).toBeDefined()
    expect(view.getByText('工作中')).toBeDefined()
    expect(view.getByText('可对话')).toBeDefined()
    expect(view.getByText('直接说“让测试窗口检查结果”即可投递，不需要连接或会话 ID。')).toBeDefined()
    expect(view.getByRole('dialog', { name: '窗口协作' }).style.left).toBe('12px')
  })

  it('hides blank and subagent-only sessions like the standard sidebar', () => {
    const view = render(<WindowCollaborationAction {...props('session-current', [
      { id: 'scratch', title: '0475a995-临时会话', running: false, blank: true },
      { id: 'child', title: '子代理路由', running: false, origin: 'subagent' },
      { id: 'test', title: '测试窗口', running: false },
    ])} />)
    const trigger = view.getByRole('button', { name: '可对话的窗口：1 个' })
    fireEvent.click(trigger)
    expect(view.getByText('测试窗口')).toBeDefined()
    expect(view.queryByText('0475a995-临时会话')).toBeNull()
    expect(view.queryByText('子代理路由')).toBeNull()
  })

  it('hides archived conversations from the directory', () => {
    const view = render(
      <WindowCollaborationAction
        {...props('session-current', [
          { id: 'archived', title: '已归档窗口', running: false },
          { id: 'active', title: '活跃窗口', running: false },
        ], null, '', vi.fn(), undefined, ['archived'])}
      />,
    )
    fireEvent.click(view.getByRole('button', { name: '可对话的窗口：1 个' }))
    expect(view.getByText('活跃窗口')).toBeDefined()
    expect(view.queryByText('已归档窗口')).toBeNull()
  })

  it('groups conversations by workspace with the current workspace first', () => {
    const view = render(
      <WindowCollaborationAction
        {...props('session-current', [
          { id: 'same', title: '本区窗口', running: false, cwd: '/Volumes/NBDATA/DSH组件测试' },
          { id: 'other', title: '别区窗口', running: false, cwd: '/Users/Four/PersonalProjects/一一玩偶计划' },
        ], null, '', vi.fn(), '/Volumes/NBDATA/DSH组件测试')}
      />,
    )
    fireEvent.click(view.getByRole('button', { name: '可对话的窗口：2 个' }))
    expect(view.getByText('当前 · DSH组件测试')).toBeDefined()
    expect(view.getByText('一一玩偶计划')).toBeDefined()
    const rows = view.getAllByRole('button', { name: /跟“/u }).map(row => row.getAttribute('aria-label') ?? '')
    expect(rows.indexOf('跟“本区窗口”对话')).toBeLessThan(rows.indexOf('跟“别区窗口”对话'))
  })

  it('filters the directory by the search query', () => {
    const peers = Array.from({ length: 7 }, (_value, index) => ({
      id: `w${String(index)}`, title: `窗口${String(index)}`, running: false,
    }))
    const view = render(<WindowCollaborationAction {...props('session-current', peers)} />)
    fireEvent.click(view.getByRole('button', { name: '可对话的窗口：7 个' }))
    const input = view.getByPlaceholderText('搜索对话')
    fireEvent.change(input, { target: { value: '窗口3' } })
    expect(view.getByText('窗口3')).toBeDefined()
    expect(view.queryByText('窗口1')).toBeNull()
    fireEvent.change(input, { target: { value: '完全不匹配' } })
    expect(view.getByText('没有匹配的对话')).toBeDefined()
  })

  it('puts the selected conversation in the composer and preserves the draft', async () => {
    const setDraft = vi.fn()
    const focus = vi.fn()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0)
      return 1
    })
    const view = render(
      <>
        <WindowCollaborationAction
          {...props('session-current', [
            { id: 'test', title: '测试窗口', running: false },
          ], null, '检查结果', setDraft)}
        />
        <div data-composer-input="true" tabIndex={0} onFocus={focus} />
      </>,
    )
    fireEvent.click(view.getByRole('button', { name: '可对话的窗口：1 个' }))
    fireEvent.click(view.getByRole('button', { name: '跟“测试窗口”对话' }))
    expect(setDraft).toHaveBeenCalledWith('跟“测试窗口”说：检查结果')
    expect(view.queryByRole('dialog', { name: '窗口协作' })).toBeNull()
    await waitFor(() => { expect(focus).toHaveBeenCalledOnce() })
  })

  it('closes the directory with Escape and restores trigger focus', () => {
    const view = render(<WindowCollaborationAction {...props('session-keyboard', [
      { id: 'test', title: '测试窗口', running: false },
    ])} />)
    const trigger = view.getByRole('button', { name: '可对话的窗口：1 个' })
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('dialog', { name: '对话窗口' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('shows team roles, progress, and task state before unrelated conversations', () => {
    const team: WindowTeamProjection = {
      teamId: 'team-12345678',
      revision: 3,
      goal: '完成窗口协作功能',
      leaderSessionId: 'leader',
      leaderName: '产品窗口',
      leaderRole: '产品负责人',
      members: [
        { sessionId: 'code', name: '开发窗口', role: '写代码', created: true },
        { sessionId: 'test', name: '测试窗口', role: '做测试', created: true },
      ],
      tasks: [
        {
          id: 'code-task', title: '实现任务调度', instruction: '实现任务调度', ownerSessionId: 'code', ownerName: '开发窗口',
          dependsOn: [], status: 'completed', attempts: 1, maxAttempts: 2, note: 'done', failureKind: null,
        },
        {
          id: 'test-task', title: '验证依赖执行', instruction: '验证依赖执行', ownerSessionId: 'test', ownerName: '测试窗口',
          dependsOn: ['code-task'], status: 'running', attempts: 1, maxAttempts: 2, note: null, failureKind: null,
        },
      ],
    }
    const view = render(<WindowCollaborationAction {...props('leader', [
      { id: 'code', title: '开发窗口', running: false },
      { id: 'test', title: '测试窗口', running: true },
      { id: 'other', title: '资料窗口', running: false },
    ], team)} />)
    const trigger = view.getByRole('button', { name: '窗口团队：2 个成员' })
    fireEvent.click(trigger)
    expect(view.getByRole('dialog', { name: '窗口团队' })).toBeDefined()
    expect(view.getByText('完成窗口协作功能')).toBeDefined()
    expect(view.getByText('实现任务调度')).toBeDefined()
    expect(view.getByText('已完成')).toBeDefined()
    expect(view.getByText('验证依赖执行')).toBeDefined()
    expect(view.getByText('执行中')).toBeDefined()
    expect(view.queryByText('资料窗口')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: /其他对话/u }))
    expect(view.getByText('资料窗口')).toBeDefined()
  })

  it('lets the leader select a team member as the composer target', () => {
    const setDraft = vi.fn()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    const team: WindowTeamProjection = {
      teamId: 'team-12345678',
      revision: 1,
      goal: '联调功能',
      leaderSessionId: 'leader',
      leaderName: '产品窗口',
      leaderRole: '产品负责人',
      members: [{ sessionId: 'test', name: '测试窗口', role: '做测试', created: true }],
      tasks: [],
    }
    const view = render(<WindowCollaborationAction {...props('leader', [
      { id: 'test', title: '测试窗口', running: false },
    ], team, '', setDraft)} />)
    fireEvent.click(view.getByRole('button', { name: '窗口团队：1 个成员' }))
    fireEvent.click(view.getByRole('button', { name: '跟“测试窗口”对话' }))
    expect(setDraft).toHaveBeenCalledWith('跟“测试窗口”说：')
  })

})

describe('relayed conversation message', () => {
  const relay = {
    messageId: 'message-12345678',
    conversationId: 'conversation-12345678',
    sourceSessionId: 'session-student-a',
    sourceName: '数数·学生甲',
    targetSessionId: 'session-teacher',
    message: '5',
  } as const

  const relayNode = {
    data: {
      time: new Date('2026-09-02T11:08:00+08:00').getTime(),
      content: [{ type: 'text', text: renderVisibleWindowMessage(relay) }],
      source: visibleWindowMessageSource(relay),
    },
  } as never

  function relaySessions(available = true) {
    const snapshot = {
      byId: available ? { 'session-student-a': { displayTitle: '数数·学生甲' } } : {},
    }
    return (select: (value: typeof snapshot) => unknown) => select(snapshot)
  }

  it('shows a compact source entry and opens that exact conversation', () => {
    const openSession = vi.fn()
    const view = render(
      <WindowRelayMessage
        node={relayNode}
        useSessions={relaySessions() as never}
        fallback={<span>原消息</span>}
        openSession={openSession}
        t={t}
      />,
    )
    expect(view.getByText('来自')).toBeDefined()
    expect(view.getByText('5')).toBeDefined()
    expect(view.queryByText('数数·学生甲:\n5')).toBeNull()
    expect(view.queryByText(new RegExp(WINDOW_RELAY_REPLY_CONTRACT.slice(0, 40)))).toBeNull()
    expect(view.queryByText(new RegExp(WINDOW_RELAY_SOURCE_FRAMING.slice(0, 40)))).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '打开会话“数数·学生甲”' }))
    expect(openSession).toHaveBeenCalledWith('session-student-a')
  })

  it('retains the source label without a broken navigation action when the session is absent', () => {
    const view = render(
      <WindowRelayMessage
        node={relayNode}
        useSessions={relaySessions(false) as never}
        fallback={<span>原消息</span>}
        openSession={vi.fn()}
        t={t}
      />,
    )
    expect(view.getByText('数数·学生甲')).toBeDefined()
    expect(view.queryByRole('button', { name: '打开会话“数数·学生甲”' })).toBeNull()
  })

  it('shows the same card for a message carried by the registered window-relay kind', () => {
    const openSession = vi.fn()
    const registeredNode = {
      data: {
        time: new Date('2026-09-03T11:08:00+08:00').getTime(),
        content: [{ type: 'text', text: renderVisibleWindowMessage(relay) }],
        source: windowRelaySource(relay),
      },
    } as never
    const view = render(
      <WindowRelayMessage
        node={registeredNode}
        useSessions={relaySessions() as never}
        fallback={<span>原消息</span>}
        openSession={openSession}
        t={t}
      />,
    )
    expect(view.getByText('来自')).toBeDefined()
    expect(view.getByText('5')).toBeDefined()
    fireEvent.click(view.getByRole('button', { name: '打开会话“数数·学生甲”' }))
    expect(openSession).toHaveBeenCalledWith('session-student-a')
  })

  it('uses the built-in renderer for ordinary user messages', () => {
    const ordinaryNode = {
      data: {
        time: Date.now(),
        content: [{ type: 'text', text: '人工输入' }],
        source: { kind: 'user' },
      },
    } as never
    const view = render(
      <WindowRelayMessage
        node={ordinaryNode}
        useSessions={relaySessions() as never}
        fallback={<span>原消息</span>}
        openSession={vi.fn()}
        t={t}
      />,
    )
    expect(view.getByText('原消息')).toBeDefined()
    expect(view.queryByText('来自')).toBeNull()
  })
})
