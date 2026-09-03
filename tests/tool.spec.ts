import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type MessageSource } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import {
  appendWindowTeamState,
  createListWindowTeamTool,
  createReassignWindowTaskTool,
  createWindowMessageTool,
  createWindowTeamTool,
  DeliveryLedger,
  type ResolvedConfig,
  WindowTeamCoordinator,
  WindowTeamScheduler,
} from '../src/index.ts'
import type { ConversationWindowDirectory } from '../src/directory.ts'
import {
  parseWindowLink,
  parseVisibleWindowMessage,
  renderVisibleWindowMessage,
  renderWindowMessage,
  SESSION_TEAMS_PLUGIN,
  visibleWindowMessageSource,
} from '../src/protocol.ts'

const config: ResolvedConfig = {
  maxTaskChars: 1_000,
  maxRememberedMessages: 8,
  requestTimeoutMs: 30_000,
  maxTeamMembers: 4,
  maxTeamTasks: 16,
  maxTaskAttempts: 2,
  taskRetryDelayMs: 1,
  maxDirectoryEntries: 8,
}

/** Browser prompt shape the official web client attaches to real human turns. */
const BROWSER_PROMPT_SOURCE: MessageSource = {
  kind: 'user',
  rpcId: '75da81e6-b847-471c-8c44-8800ede5ac3d',
  clientTimeZone: 'Asia/Shanghai',
}

function turnEvents(text: string, source: MessageSource = BROWSER_PROMPT_SOURCE): SessionEvent[] {
  return [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } },
    {
      type: 'user/message', seq: 2, time: 3, surfaceOp: 'append',
      data: createUserMessage({ content: [{ type: 'text', text }], source }),
    },
  ]
}

function fakeAgent(id: string, events: SessionEvent[] = [], followup = vi.fn(), steer = vi.fn()): Agent {
  const mutableEvents = [...events]
  let surfaceNodes = mutableEvents.flatMap(event =>
    event.type === 'user/message' || event.type === 'assistant/message' || event.type === 'tool/result'
      ? [event.seq]
      : [])
  return {
    id: SessionId(id),
    options: { provider: 'mock', model: 'mock' },
    followup,
    steer,
    status: 'idle',
    session: {
      id: SessionId(id),
      events: mutableEvents,
      snapshotEvents: () => mutableEvents,
      surface: {
        get nodes() { return surfaceNodes },
      },
      header: { version: 0, id: SessionId(id), createdAt: 1, cwd: '/workspace', delegationDepth: 0 },
      append(type: string, data: unknown, options: {
        surfaceOp?: string | { op: 'replace'; start: number; end: number }
        sourceEventSeqs?: number[]
      } = {}) {
        const event = {
          type,
          seq: mutableEvents.length,
          time: mutableEvents.length + 1,
          data,
          ...options,
        } as SessionEvent
        mutableEvents.push(event)
        if (type === 'user/message' || type === 'assistant/message' || type === 'tool/result') {
          const operation = options.surfaceOp
          if (typeof operation === 'object') {
            surfaceNodes = surfaceNodes.filter(seq => seq < operation.start || seq > operation.end)
          }
          surfaceNodes.push(event.seq)
        }
        return event
      },
    },
  } as Agent
}

function execFor(agent: Agent): ToolRunContext {
  return { signal: new AbortController().signal, agent } as ToolRunContext
}

describe('conversation window tools', () => {
  it('sends directly by displayed title without any connection record', async () => {
    const targetSteer = vi.fn()
    const source = fakeAgent('source', turnEvents('让测试窗口检查发布包'))
    const target = fakeAgent('target', [], vi.fn(), targetSteer)
    const directory = {
      resolve: vi.fn(async () => ({
        agent: target,
        window: {
          sessionId: target.session.id,
          title: '测试窗口',
          running: true,
          createdAt: 1,
          cwd: '/workspace',
          agentOptions: target.options,
        },
        targetLink: 'dsh://session/target',
      })),
    } as unknown as ConversationWindowDirectory
    const coordinator = new WindowTeamCoordinator()
    const scheduler = new WindowTeamScheduler({ taskRetryDelayMs: 1 }, directory, coordinator)
    const tool = createWindowMessageTool(config, directory, new DeliveryLedger(8), coordinator, scheduler)

    await expect(tool.execute({
      target_name: '测试窗口',
      message: '检查发布包',
      message_id: 'message-123',
    }, execFor(source))).resolves.toMatchObject({ status: 'accepted', code: 'queued' })
    expect(directory.resolve).toHaveBeenCalledWith(source, { targetName: '测试窗口' }, expect.any(AbortSignal))
    const sent = targetSteer.mock.calls[0]?.[0] as {
      content: Array<{ type: string; text: string }>
      source: unknown
    }
    expect(parseVisibleWindowMessage(sent.source, sent.content[0]?.text ?? '')).toMatchObject({
      message: '检查发布包',
      sourceSessionId: 'source',
      targetSessionId: 'target',
    })
  })

  it('lets a team member continue an exchange only with the source window', async () => {
    const sourceSteer = vi.fn()
    const leader = fakeAgent('leader', [], vi.fn(), sourceSteer)
    const incoming = renderWindowMessage({
      conversationId: 'conversation-123',
      teamId: 'team-12345678',
      message: '完成测试',
      messageId: 'incoming-123',
      sourceSessionId: SessionId('leader'),
      targetSessionId: SessionId('member'),
    })
    const member = fakeAgent('member', turnEvents(incoming, {
      kind: 'plugin', plugin: SESSION_TEAMS_PLUGIN, form: 'relay',
    }))
    const directory = {
      resolveReplySource: vi.fn(async () => ({
        agent: leader,
        window: {
          sessionId: leader.session.id,
          title: '产品窗口',
          running: true,
          createdAt: 1,
          cwd: '/workspace',
          agentOptions: leader.options,
        },
        targetLink: 'dsh://session/leader',
      })),
    } as unknown as ConversationWindowDirectory
    const coordinator = new WindowTeamCoordinator()
    const scheduler = new WindowTeamScheduler({ taskRetryDelayMs: 1 }, directory, coordinator)
    const tool = createWindowMessageTool(config, directory, new DeliveryLedger(8), coordinator, scheduler)

    await expect(tool.execute({ message: '测试通过', message_id: 'reply-123' }, execFor(member)))
      .resolves.toMatchObject({ status: 'accepted', code: 'queued' })
    const sent = sourceSteer.mock.calls[0]?.[0] as {
      content: Array<{ type: string; text: string }>
      source: unknown
    }
    expect(parseVisibleWindowMessage(sent.source, sent.content[0]?.text ?? '')).toMatchObject({
      conversationId: 'conversation-123',
      teamId: 'team-12345678',
      message: '测试通过',
    })
  })

  it('routes a relayed reply to its source when the guessed target name matches no window', async () => {
    const sourceSteer = vi.fn()
    const leader = fakeAgent('leader', [], vi.fn(), sourceSteer)
    const incoming = renderWindowMessage({
      conversationId: 'conversation-123',
      message: '请问快排算法实现好了没有？',
      messageId: 'incoming-123',
      sourceSessionId: SessionId('leader'),
      targetSessionId: SessionId('member'),
    })
    const member = fakeAgent('member', turnEvents(incoming, {
      kind: 'plugin', plugin: SESSION_TEAMS_PLUGIN, form: 'relay',
    }))
    const directory = {
      resolveReplySource: vi.fn(async () => ({
        agent: leader,
        window: {
          sessionId: leader.session.id,
          title: '任务分配与团队协调',
          running: true,
          createdAt: 1,
          cwd: '/workspace',
          agentOptions: leader.options,
        },
        targetLink: 'dsh://session/leader',
      })),
      resolve: vi.fn(async (_source: Agent, selectors: { readonly targetName?: string }) => ({
        targetLink: '',
        code: 'target-name-not-found',
        message: `no conversation has the exact title ${selectors.targetName ?? ''}`,
      })),
    } as unknown as ConversationWindowDirectory
    const coordinator = new WindowTeamCoordinator()
    const scheduler = new WindowTeamScheduler({ taskRetryDelayMs: 1 }, directory, coordinator)
    const tool = createWindowMessageTool(config, directory, new DeliveryLedger(8), coordinator, scheduler)

    await expect(tool.execute({
      message: '快排已实现，测试全部通过',
      message_id: 'reply-456',
      target_name: '分配快排任务给队员',
    }, execFor(member))).resolves.toMatchObject({ status: 'accepted', code: 'queued' })
    expect(sourceSteer).toHaveBeenCalledTimes(1)
  })

  it('still rejects a relayed reply that names another existing window', async () => {
    const sourceSteer = vi.fn()
    const leader = fakeAgent('leader', [], vi.fn(), sourceSteer)
    const other = fakeAgent('other')
    const incoming = renderWindowMessage({
      conversationId: 'conversation-123',
      message: '请回复我',
      messageId: 'incoming-123',
      sourceSessionId: SessionId('leader'),
      targetSessionId: SessionId('member'),
    })
    const member = fakeAgent('member', turnEvents(incoming, {
      kind: 'plugin', plugin: SESSION_TEAMS_PLUGIN, form: 'relay',
    }))
    const directory = {
      resolveReplySource: vi.fn(async () => ({
        agent: leader,
        window: {
          sessionId: leader.session.id,
          title: '任务分配与团队协调',
          running: true,
          createdAt: 1,
          cwd: '/workspace',
          agentOptions: leader.options,
        },
        targetLink: 'dsh://session/leader',
      })),
      resolve: vi.fn(async () => ({
        agent: other,
        window: {
          sessionId: other.session.id,
          title: '分配快排任务给队员',
          running: false,
          createdAt: 1,
          cwd: '/workspace',
          agentOptions: other.options,
        },
        targetLink: 'dsh://session/other',
      })),
    } as unknown as ConversationWindowDirectory
    const coordinator = new WindowTeamCoordinator()
    const scheduler = new WindowTeamScheduler({ taskRetryDelayMs: 1 }, directory, coordinator)
    const tool = createWindowMessageTool(config, directory, new DeliveryLedger(8), coordinator, scheduler)

    await expect(tool.execute({
      message: '改投给别人',
      message_id: 'reply-789',
      target_name: '分配快排任务给队员',
    }, execFor(member))).resolves.toMatchObject({ status: 'rejected', code: 'relay-target-denied' })
    expect(sourceSteer).not.toHaveBeenCalled()
  })

  it('creates named top-level role windows and starts each assignment', async () => {
    const source = fakeAgent('leader', turnEvents('创建开发和测试两个窗口'))
    const created: Agent[] = []
    const create = vi.fn(async () => {
      const item = fakeAgent(`created-${String(created.length + 1)}`)
      created.push(item)
      return { sessionId: item.session.id, agent: item }
    })
    const directory = {
      listFor: vi.fn(async () => []),
      resolve: vi.fn(async (_source: Agent, selector: { targetLink?: string }) => {
        const id = parseWindowLink(selector.targetLink ?? '').sessionId
        const item = created.find(agent => agent.session.id === id)
        if (item === undefined) throw new Error('missing created member')
        return {
          agent: item,
          window: {
            sessionId: item.session.id,
            title: id,
            running: true,
            createdAt: 1,
            cwd: '/workspace',
            agentOptions: item.options,
          },
          targetLink: selector.targetLink ?? '',
        }
      }),
    } as unknown as ConversationWindowDirectory
    const attachSession = vi.fn(async () => {})
    const workspace = { id: 'workspace-1', attachSession }
    const workspaces = {
      resolveByPath: vi.fn(async () => workspace),
    }
    const coordinator = new WindowTeamCoordinator()
    const scheduler = new WindowTeamScheduler({ taskRetryDelayMs: 1 }, directory, coordinator)
    const tool = createWindowTeamTool(
      config,
      { create },
      directory,
      coordinator,
      scheduler,
      workspaces,
    )

    const result = await tool.execute({
      team_goal: '完成新功能',
      leader_role: '产品负责人',
      members: [
        { name: '开发窗口', role: '写代码', task: '实现功能' },
        { name: '测试窗口', role: '做测试', task: '验证功能' },
      ],
    }, execFor(source))

    expect(result).toMatchObject({ status: 'accepted', code: 'team-created' })
    expect(create).toHaveBeenCalledTimes(2)
    expect(workspaces.resolveByPath).toHaveBeenCalledWith('/workspace')
    expect(create.mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({ source, title: '开发窗口', cwd: '/workspace', workspace }),
      expect.objectContaining({ source, title: '测试窗口', cwd: '/workspace', workspace }),
    ])
    expect(attachSession).not.toHaveBeenCalled()
    expect(created).toHaveLength(2)
    for (const member of created) {
      expect(member.followup).toHaveBeenCalledTimes(1)
      const sent = (member.followup as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
        content: Array<{ type: string; text: string }>
        source: unknown
      }
      const relay = parseVisibleWindowMessage(sent.source, sent.content[0]?.text ?? '')
      expect(relay).toMatchObject({
        teamId: expect.stringMatching(/^team-/u),
        taskId: expect.stringMatching(/^task-/u),
      })
      expect(relay?.message).toContain('Team goal: 完成新功能')
    }
  })

  it('creates a complete multi-step dependency graph in one team call', async () => {
    const source = fakeAgent('leader', turnEvents('让聪明1和聪明2轮流数到4'))
    const created: Agent[] = []
    const create = vi.fn(async () => {
      const item = fakeAgent(`created-${String(created.length + 1)}`)
      created.push(item)
      return { sessionId: item.session.id, agent: item }
    })
    const directory = {
      listFor: vi.fn(async () => []),
      resolve: vi.fn(async (_source: Agent, selector: { targetLink?: string }) => {
        const id = parseWindowLink(selector.targetLink ?? '').sessionId
        const item = created.find(agent => agent.session.id === id)
        if (item === undefined) throw new Error('missing created member')
        return {
          agent: item,
          window: {
            sessionId: item.session.id,
            title: id,
            running: true,
            createdAt: 1,
            cwd: '/workspace',
            agentOptions: item.options,
          },
          targetLink: selector.targetLink ?? '',
        }
      }),
    } as unknown as ConversationWindowDirectory
    const coordinator = new WindowTeamCoordinator()
    const scheduler = new WindowTeamScheduler({ taskRetryDelayMs: 1 }, directory, coordinator)
    const tool = createWindowTeamTool(
      config,
      { create },
      directory,
      coordinator,
      scheduler,
      { resolveByPath: vi.fn(async () => ({ attachSession: vi.fn(async () => {}) })) },
    )

    const result = await tool.execute({
      team_goal: '聪明1和聪明2轮流数到4',
      leader_role: '聪明老师',
      members: [
        {
          name: '聪明1',
          role: '报奇数',
          tasks: [
            { task_id: 'count-1', task_title: '报1', task: '只回复1' },
            { task_id: 'count-3', task_title: '报3', task: '只回复3', depends_on: ['count-2'] },
          ],
        },
        {
          name: '聪明2',
          role: '报偶数',
          tasks: [
            { task_id: 'count-2', task_title: '报2', task: '只回复2', depends_on: ['count-1'] },
            { task_id: 'count-4', task_title: '报4', task: '只回复4', depends_on: ['count-3'] },
          ],
        },
      ],
    }, execFor(source))

    expect(result).toMatchObject({
      status: 'accepted',
      code: 'team-created',
      tasks: [
        { id: 'count-1', ownerName: '聪明1', status: 'running' },
        { id: 'count-3', ownerName: '聪明1', status: 'blocked' },
        { id: 'count-2', ownerName: '聪明2', status: 'blocked' },
        { id: 'count-4', ownerName: '聪明2', status: 'blocked' },
      ],
    })
    expect(create).toHaveBeenCalledTimes(2)
    expect(created[0]?.followup).toHaveBeenCalledTimes(1)
    expect(created[1]?.followup).not.toHaveBeenCalled()
    expect(coordinator.current(source.session)?.tasks).toHaveLength(4)
  })

  it('rejects an invalid complete graph before creating any window', async () => {
    const source = fakeAgent('leader', turnEvents('创建两个有依赖的窗口'))
    const create = vi.fn()
    const attachSession = vi.fn(async () => {})
    const tool = createWindowTeamTool(
      config,
      { create } as never,
      { listFor: vi.fn(async () => []) } as unknown as ConversationWindowDirectory,
      new WindowTeamCoordinator(),
      new WindowTeamScheduler(
        { taskRetryDelayMs: 1 },
        { resolve: vi.fn() } as unknown as ConversationWindowDirectory,
        new WindowTeamCoordinator(),
      ),
      { resolveByPath: vi.fn(async () => ({ attachSession })) },
    )

    await expect(tool.execute({
      team_goal: '验证完整任务图',
      leader_role: '负责人',
      members: [{
        name: '测试窗口',
        role: '测试',
        tasks: [{ task_id: 'test-task', task: '开始测试', depends_on: ['missing-task'] }],
      }],
    }, execFor(source))).resolves.toMatchObject({
      status: 'rejected',
      code: 'unknown-dependency',
    })
    expect(create).not.toHaveBeenCalled()
    expect(attachSession).not.toHaveBeenCalled()
  })

  it('reuses one existing exact-title window when creating a team', async () => {
    const source = fakeAgent('leader', turnEvents('让已有的聪明1加入团队'))
    const existing = fakeAgent('smart-1')
    const existingWindow = {
      sessionId: existing.session.id,
      title: '聪明1',
      running: false,
      createdAt: 1,
      cwd: '/workspace',
      agentOptions: existing.options,
    }
    const create = vi.fn()
    const directory = {
      listFor: vi.fn(async () => [existingWindow]),
      resolve: vi.fn(async () => ({
        agent: existing,
        window: { ...existingWindow, running: true },
        targetLink: 'dsh://session/smart-1',
      })),
    } as unknown as ConversationWindowDirectory
    const attachSession = vi.fn(async () => {})
    const coordinator = new WindowTeamCoordinator()
    const scheduler = new WindowTeamScheduler({ taskRetryDelayMs: 1 }, directory, coordinator)
    const tool = createWindowTeamTool(
      config,
      { create } as never,
      directory,
      coordinator,
      scheduler,
      { resolveByPath: vi.fn(async () => ({ attachSession })) },
    )

    const result = await tool.execute({
      team_goal: '完成报数',
      leader_role: '老师',
      members: [{ name: '聪明1', role: '报数', task: '回复1' }],
    }, execFor(source))

    expect(result).toMatchObject({
      status: 'accepted',
      members: [{ name: '聪明1', status: 'reused', code: 'reused' }],
      tasks: [{ ownerSessionId: 'smart-1', ownerName: '聪明1', status: 'running' }],
    })
    expect(create).not.toHaveBeenCalled()
    expect(attachSession).toHaveBeenCalledWith(existing.session.id)
    expect(existing.followup).toHaveBeenCalledTimes(1)
  })

  it('rejects an ambiguous existing title before creating any window', async () => {
    const source = fakeAgent('leader', turnEvents('创建聪明1'))
    const create = vi.fn()
    const resolve = vi.fn()
    const windows = ['smart-old-1', 'smart-old-2'].map(id => ({
      sessionId: SessionId(id),
      title: '聪明1',
      running: false,
      createdAt: 1,
      cwd: '/workspace',
      agentOptions: { provider: 'mock', model: 'mock' },
    }))
    const tool = createWindowTeamTool(
      config,
      { create } as never,
      { listFor: vi.fn(async () => windows), resolve } as never,
      {} as never,
      {} as never,
      {} as never,
    )

    await expect(tool.execute({
      team_goal: '完成报数',
      leader_role: '老师',
      members: [{ name: '聪明1', role: '报数', task: '回复1' }],
    }, execFor(source))).resolves.toMatchObject({ status: 'rejected', code: 'target-name-ambiguous' })
    expect(create).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('does not create any window when member names collide', async () => {
    const source = fakeAgent('leader', turnEvents('创建两个窗口'))
    const create = vi.fn()
    const tool = createWindowTeamTool(
      config,
      { create } as never,
      { listFor: vi.fn(async () => []) } as never,
      {} as never,
      {} as never,
      {} as never,
    )
    await expect(tool.execute({
      team_goal: '完成需求',
      leader_role: '产品',
      members: [
        { name: '开发', role: '编码', task: '实现' },
        { name: '开发', role: '测试', task: '验证' },
      ],
    }, execFor(source))).resolves.toMatchObject({ status: 'rejected', code: 'duplicate-member-name' })
    expect(create).not.toHaveBeenCalled()
  })

  it('reports a normal conversation provisioning failure without inventing a partial member', async () => {
    const source = fakeAgent('leader', turnEvents('创建开发窗口'))
    const create = vi.fn(async () => { throw new Error('workspace write failed') })
    const workspaceRegistry = {
      resolveByPath: vi.fn(async () => ({ id: 'workspace-1', attachSession: vi.fn() })),
    }
    const coordinator = new WindowTeamCoordinator()
    const directory = { listFor: vi.fn(async () => []) } as unknown as ConversationWindowDirectory
    const scheduler = new WindowTeamScheduler({ taskRetryDelayMs: 1 }, directory, coordinator)
    const tool = createWindowTeamTool(
      config,
      { create } as never,
      directory,
      coordinator,
      scheduler,
      workspaceRegistry,
    )

    await expect(tool.execute({
      team_goal: '完成开发',
      leader_role: '产品',
      members: [{ name: '开发窗口', role: '开发', task: '实现功能' }],
    }, execFor(source))).resolves.toMatchObject({
      status: 'rejected',
      code: 'team-failed',
      members: [{ status: 'failed', message: 'workspace write failed' }],
    })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('starts a dependent task only after its prerequisite reports completion', async () => {
    const leaderSteer = vi.fn()
    const leader = fakeAgent('leader', turnEvents('按依赖完成开发和测试'), vi.fn(), leaderSteer)
    const code = fakeAgent('code')
    const test = fakeAgent('test')
    const byId = new Map([[String(code.session.id), code], [String(test.session.id), test]])
    const directory = {
      resolve: vi.fn(async (_source: Agent, selector: { targetLink?: string }) => {
        const id = parseWindowLink(selector.targetLink ?? '').sessionId
        const target = byId.get(String(id))
        if (target === undefined) throw new Error('unknown member')
        return {
          agent: target,
          window: {
            sessionId: target.session.id,
            title: String(id),
            running: true,
            createdAt: 1,
            cwd: '/workspace',
            agentOptions: target.options,
          },
          targetLink: selector.targetLink ?? '',
        }
      }),
      resolveReplySource: vi.fn(async () => ({
        agent: leader,
        window: {
          sessionId: leader.session.id,
          title: '产品窗口',
          running: true,
          createdAt: 1,
          cwd: '/workspace',
          agentOptions: leader.options,
        },
        targetLink: 'dsh://session/leader',
      })),
    } as unknown as ConversationWindowDirectory
    const coordinator = new WindowTeamCoordinator()
    const scheduler = new WindowTeamScheduler({ taskRetryDelayMs: 1 }, directory, coordinator)
    appendWindowTeamState(leader.session, {
      teamId: 'team-dependency',
      revision: 1,
      goal: '完成开发和测试',
      leaderSessionId: 'leader',
      leaderName: '产品窗口',
      leaderRole: '产品负责人',
      members: [
        { sessionId: 'code', name: '开发窗口', role: '开发', created: true },
        { sessionId: 'test', name: '测试窗口', role: '测试', created: true },
      ],
      tasks: [
        {
          id: 'code-task', title: '实现功能', instruction: '实现功能', ownerSessionId: 'code', ownerName: '开发窗口',
          dependsOn: [], status: 'ready', attempts: 0, maxAttempts: 2, note: null, failureKind: null,
        },
        {
          id: 'test-task', title: '验证功能', instruction: '验证功能', ownerSessionId: 'test', ownerName: '测试窗口',
          dependsOn: ['code-task'], status: 'blocked', attempts: 0, maxAttempts: 2, note: null, failureKind: null,
        },
      ],
    })

    await expect(scheduler.run(leader)).resolves.toEqual({ started: ['code-task'], failed: [] })
    expect(code.followup).toHaveBeenCalledTimes(1)
    expect(test.followup).not.toHaveBeenCalled()
    const assignment = (code.followup as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    code.session.append('turn/start', { turn: 1 })
    code.session.append('step/start', { turn: 1, step: 1 })
    code.session.append('user/message', assignment, { surfaceOp: 'append' })

    const message = createWindowMessageTool(config, directory, new DeliveryLedger(8), coordinator, scheduler)
    await expect(message.execute({
      message: '实现进行到一半，没有阻塞',
      message_id: 'progress-message-1',
    }, execFor(code))).resolves.toMatchObject({ status: 'accepted', code: 'queued' })
    expect(coordinator.current(leader.session)?.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'code-task', status: 'running' }),
      expect.objectContaining({ id: 'test-task', status: 'blocked' }),
    ]))
    expect(test.followup).not.toHaveBeenCalled()

    code.session.append('step/end', { turn: 1, step: 1 })
    code.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    code.session.append('turn/start', { turn: 2 })
    code.session.append('step/start', { turn: 2, step: 1 })
    code.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '产品窗口:\n完成后请提交最终结果' }],
      source: {
        kind: 'user',
        sessionTeams: {
          version: 1,
          plugin: SESSION_TEAMS_PLUGIN,
          messageId: 'reminder-message-1',
          conversationId: 'reminder-conversation-1',
          sourceSessionId: 'leader',
          targetSessionId: 'code',
          sourceName: '产品窗口',
        },
      } as unknown as MessageSource,
    }), { surfaceOp: 'append' })

    await expect(message.execute({
      message: '实现完成',
      message_id: 'result-message-1',
      task_outcome: 'completed',
    }, execFor(code))).resolves.toMatchObject({
      status: 'accepted',
      code: 'queued',
      message: expect.stringContaining('team task completed'),
    })
    expect(leaderSteer).toHaveBeenCalledTimes(2)
    const report = leaderSteer.mock.calls[1]?.[0] as {
      content: Array<{ type: string; text: string }>
      source: unknown
    }
    expect(parseVisibleWindowMessage(report.source, report.content[0]?.text ?? '')).toMatchObject({
      teamId: 'team-dependency',
      taskId: 'code-task',
      message: '实现完成',
    })
    expect(test.followup).toHaveBeenCalledTimes(1)
    expect(coordinator.current(leader.session)?.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'code-task', status: 'completed' }),
      expect.objectContaining({ id: 'test-task', status: 'running', attempts: 1 }),
    ]))
  })

  it('delivers an ordinary reply when a completed member reports with task_outcome', async () => {
    const leaderSteer = vi.fn()
    const leader = fakeAgent('leader', turnEvents('让开发窗口实现后汇报'), vi.fn(), leaderSteer)
    const code = fakeAgent('code')
    const taskRelay = {
      conversationId: 'conversation-task-1',
      teamId: 'team-dependency',
      taskId: 'code-task',
      message: '实现功能并汇报',
      messageId: 'task-message-1',
      sourceSessionId: SessionId('leader'),
      sourceName: '产品窗口',
      targetSessionId: SessionId('code'),
    }
    // Durable history: the member's own completed task assignment.
    code.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: renderVisibleWindowMessage(taskRelay) }],
      source: visibleWindowMessageSource(taskRelay),
    }), { surfaceOp: 'append' })
    // Current turn: an ordinary task-less window message from the leader.
    const reminderRelay = {
      conversationId: 'conversation-reminder-1',
      message: '完成后请回复收到',
      messageId: 'reminder-message-1',
      sourceSessionId: SessionId('leader'),
      sourceName: '产品窗口',
      targetSessionId: SessionId('code'),
    }
    code.session.append('turn/start', { turn: 2 })
    code.session.append('step/start', { turn: 2, step: 1 })
    code.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: renderVisibleWindowMessage(reminderRelay) }],
      source: visibleWindowMessageSource(reminderRelay),
    }), { surfaceOp: 'append' })

    const byId = new Map([[String(code.session.id), code]])
    const directory = {
      resolve: vi.fn(async (_source: Agent, selector: { targetLink?: string }) => {
        const id = parseWindowLink(selector.targetLink ?? '').sessionId
        const target = byId.get(String(id))
        if (target === undefined) throw new Error('unknown member')
        return {
          agent: target,
          window: {
            sessionId: target.session.id,
            title: String(id),
            running: true,
            createdAt: 1,
            cwd: '/workspace',
            agentOptions: target.options,
          },
          targetLink: selector.targetLink ?? '',
        }
      }),
      resolveReplySource: vi.fn(async () => ({
        agent: leader,
        window: {
          sessionId: leader.session.id,
          title: '产品窗口',
          running: true,
          createdAt: 1,
          cwd: '/workspace',
          agentOptions: leader.options,
        },
        targetLink: 'dsh://session/leader',
      })),
    } as unknown as ConversationWindowDirectory
    const coordinator = new WindowTeamCoordinator()
    const scheduler = new WindowTeamScheduler({ taskRetryDelayMs: 1 }, directory, coordinator)
    appendWindowTeamState(leader.session, {
      teamId: 'team-dependency',
      revision: 1,
      goal: '完成开发和测试',
      leaderSessionId: 'leader',
      leaderName: '产品窗口',
      leaderRole: '产品负责人',
      members: [{ sessionId: 'code', name: '开发窗口', role: '开发', created: true }],
      tasks: [{
        id: 'code-task', title: '实现功能', instruction: '实现功能并汇报', ownerSessionId: 'code',
        ownerName: '开发窗口', dependsOn: [], status: 'completed', attempts: 1, maxAttempts: 2,
        note: '实现完成', failureKind: null,
      }],
    })
    const tool = createWindowMessageTool(config, directory, new DeliveryLedger(8), coordinator, scheduler)

    await expect(tool.execute({
      message: '收到',
      message_id: 'reply-message-1',
      task_outcome: 'completed',
    }, execFor(code))).resolves.toMatchObject({
      status: 'accepted',
      code: 'delivered-as-reply',
      message: expect.stringContaining('delivered as an ordinary reply'),
    })
    expect(leaderSteer).toHaveBeenCalledTimes(1)
    const reply = leaderSteer.mock.calls[0]?.[0] as {
      content: Array<{ type: string; text: string }>
      source: unknown
    }
    expect(parseVisibleWindowMessage(reply.source, reply.content[0]?.text ?? '')).toMatchObject({
      message: '收到',
      sourceSessionId: 'code',
      targetSessionId: 'leader',
    })
    expect(coordinator.current(leader.session)?.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'code-task', status: 'completed' }),
    ]))
  })

  it('lists leader-owned team state from a member after an ordinary reminder', async () => {
    const leader = fakeAgent('leader')
    appendWindowTeamState(leader.session, {
      teamId: 'team-listing-1',
      revision: 1,
      goal: '完成测试',
      leaderSessionId: 'leader',
      leaderName: '产品窗口',
      leaderRole: '产品负责人',
      members: [{ sessionId: 'member', name: '测试窗口', role: '测试', created: true }],
      tasks: [{
        id: 'test-task', title: '验证功能', instruction: '运行测试', ownerSessionId: 'member', ownerName: '测试窗口',
        dependsOn: [], status: 'running', attempts: 1, maxAttempts: 2, note: null, failureKind: null,
      }],
    })
    const member = fakeAgent('member', turnEvents('产品窗口:\n运行测试', {
      kind: 'user',
      sessionTeams: {
        version: 1,
        plugin: SESSION_TEAMS_PLUGIN,
        messageId: 'assignment-message-1',
        conversationId: 'assignment-conversation-1',
        teamId: 'team-listing-1',
        taskId: 'test-task',
        sourceSessionId: 'leader',
        targetSessionId: 'member',
        sourceName: '产品窗口',
      },
    } as unknown as MessageSource))
    member.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '产品窗口:\n请同步当前进度' }],
      source: {
        kind: 'user',
        sessionTeams: {
          version: 1,
          plugin: SESSION_TEAMS_PLUGIN,
          messageId: 'reminder-message-2',
          conversationId: 'reminder-conversation-2',
          sourceSessionId: 'leader',
          targetSessionId: 'member',
          sourceName: '产品窗口',
        },
      } as unknown as MessageSource,
    }), { surfaceOp: 'append' })
    const directory = {
      resolveReplySource: vi.fn(async () => ({
        agent: leader,
        window: {
          sessionId: leader.session.id,
          title: '产品窗口',
          running: true,
          createdAt: 1,
          cwd: '/workspace',
          agentOptions: leader.options,
        },
        targetLink: 'dsh://session/leader',
      })),
    } as unknown as ConversationWindowDirectory
    const tool = createListWindowTeamTool(config, directory, new WindowTeamCoordinator())

    await expect(tool.execute({}, execFor(member))).resolves.toMatchObject({
      status: 'ok',
      code: 'listed',
      team: { teamId: 'team-listing-1', tasks: [{ id: 'test-task', status: 'running' }] },
    })
    expect(directory.resolveReplySource).toHaveBeenCalledWith(member, 'leader', expect.any(AbortSignal))
  })

  it('retries a temporary delivery failure within the task attempt limit', async () => {
    const leader = fakeAgent('leader', turnEvents('运行可重试任务'))
    const member = fakeAgent('member')
    let calls = 0
    const directory = {
      resolve: vi.fn(async (_source: Agent, selector: { targetLink?: string }) => {
        calls += 1
        if (calls === 1) {
          return { targetLink: selector.targetLink ?? '', code: 'target-unavailable', message: 'temporary unavailable' }
        }
        return {
          agent: member,
          window: {
            sessionId: member.session.id,
            title: '执行窗口',
            running: true,
            createdAt: 1,
            cwd: '/workspace',
            agentOptions: member.options,
          },
          targetLink: selector.targetLink ?? '',
        }
      }),
    } as unknown as ConversationWindowDirectory
    const coordinator = new WindowTeamCoordinator()
    appendWindowTeamState(leader.session, {
      teamId: 'team-retry-1', revision: 1, goal: '完成可重试任务', leaderSessionId: 'leader', leaderName: '产品窗口', leaderRole: '负责人',
      members: [{ sessionId: 'member', name: '执行窗口', role: '执行', created: true }],
      tasks: [{
        id: 'retry-task', title: '可重试任务', instruction: '执行', ownerSessionId: 'member', ownerName: '执行窗口',
        dependsOn: [], status: 'ready', attempts: 0, maxAttempts: 2, note: null, failureKind: null,
      }],
    })
    const scheduler = new WindowTeamScheduler({ taskRetryDelayMs: 1 }, directory, coordinator)

    await expect(scheduler.run(leader)).resolves.toEqual({ started: ['retry-task'], failed: [] })
    expect(directory.resolve).toHaveBeenCalledTimes(2)
    expect(member.followup).toHaveBeenCalledTimes(1)
    expect(coordinator.current(leader.session)?.tasks[0]).toMatchObject({ status: 'running', attempts: 2 })
  })

  it('moves settled work to another visible window and schedules the new owner', async () => {
    const leader = fakeAgent('leader', turnEvents('把失败任务转给测试窗口'))
    const target = fakeAgent('test')
    const directory = {
      resolve: vi.fn(async () => ({
        agent: target,
        window: {
          sessionId: target.session.id,
          title: '测试窗口',
          running: false,
          createdAt: 1,
          cwd: '/workspace',
          agentOptions: target.options,
        },
        targetLink: 'dsh://session/test',
      })),
    } as unknown as ConversationWindowDirectory
    const coordinator = new WindowTeamCoordinator()
    appendWindowTeamState(leader.session, {
      teamId: 'team-transfer', revision: 1, goal: '完成验证', leaderSessionId: 'leader', leaderName: '产品窗口', leaderRole: '负责人',
      members: [{ sessionId: 'old', name: '旧窗口', role: '测试', created: true }],
      tasks: [{
        id: 'transfer-task', title: '验证结果', instruction: '验证结果', ownerSessionId: 'old', ownerName: '旧窗口',
        dependsOn: [], status: 'failed', attempts: 2, maxAttempts: 2, note: '测试未通过', failureKind: 'work',
      }],
    })
    const scheduler = new WindowTeamScheduler({ taskRetryDelayMs: 1 }, directory, coordinator)
    const reassign = createReassignWindowTaskTool(config, directory, coordinator, scheduler)

    await expect(reassign.execute({ task_id: 'transfer-task', target_name: '测试窗口' }, execFor(leader)))
      .resolves.toMatchObject({
        status: 'accepted',
        task: { id: 'transfer-task', ownerSessionId: 'test', ownerName: '测试窗口', status: 'running', attempts: 1 },
      })
    expect(target.followup).toHaveBeenCalledTimes(1)
  })
})
