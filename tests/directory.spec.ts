import { describe, expect, it, vi } from 'vitest'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { ConversationWindowDirectory } from '../src/directory.ts'

function header(id: string, cwd = '/workspace', extra: Partial<SessionHeader> = {}): SessionHeader {
  return {
    version: 0,
    id: SessionId(id),
    createdAt: 1,
    cwd,
    isSeeded: false,
    ...extra,
  }
}

function titleAndRoute(title: string, provider = 'provider-a', model = 'model-a'): SessionEvent[] {
  return [
    {
      type: 'session/title', seq: 0, time: 1,
      data: { title, messageSeqs: [], source: { kind: 'user' } },
    },
    { type: 'request/context', seq: 1, time: 2, data: { provider, model } },
  ] as SessionEvent[]
}

function agent(id: string, title: string, cwd = '/workspace'): Agent {
  const events = titleAndRoute(title)
  return {
    id: SessionId(id),
    options: { provider: 'live-provider', model: 'live-model' },
    session: { id: SessionId(id), header: header(id, cwd), snapshotEvents: () => events },
    status: 'idle',
  } as Agent
}

function fixture(records: Array<{ header: SessionHeader; events: SessionEvent[] }>, live: Agent[] = []) {
  const byId = new Map(records.map(record => [record.header.id, record]))
  let resumed: Agent | undefined
  const resolveAgent = vi.fn(async (sessionId: ReturnType<typeof SessionId>) => {
    const record = byId.get(sessionId)
    if (record === undefined) throw new Error('missing')
    resumed = agent(String(sessionId), record.events[0]?.type === 'session/title'
      ? (record.events[0] as never as { data: { title: string } }).data.title
      : 'untitled')
    return { agent: resumed }
  })
  const agents = {
    get: (id: ReturnType<typeof SessionId>) => [...live, ...(resumed === undefined ? [] : [resumed])]
      .find(item => item.session.id === id),
    list: () => [...live, ...(resumed === undefined ? [] : [resumed])],
  } as unknown as Pick<AgentRegistry, 'get' | 'list'>
  const persistence = {
    listSnapshots: vi.fn(async () => records.map((record, index) => ({
      header: record.header,
      revision: `revision-${String(index)}` as never,
    }))),
    inspect: vi.fn(async (id) => {
      const record = byId.get(id)
      if (record === undefined) throw new Error('missing')
      return { meta: record.header, events: record.events }
    }),
  } as Pick<SessionPersistence, 'inspect' | 'listSnapshots'>
  return {
    agents,
    persistence,
    resolveAgent,
    directory: new ConversationWindowDirectory(agents, persistence, { resolveAgent } as never),
  }
}

describe('conversation window directory', () => {
  it('lists every ordinary conversation visible to the Host without connection state', async () => {
    const source = agent('source', '产品窗口')
    const item = fixture([
      { header: header('source'), events: titleAndRoute('产品窗口') },
      { header: header('code'), events: titleAndRoute('开发窗口') },
      { header: header('test'), events: titleAndRoute('测试窗口') },
      { header: header('other', '/other'), events: titleAndRoute('其他项目') },
      { header: header('child', '/workspace', { origin: 'subagent', delegationDepth: 1 }), events: titleAndRoute('子代理') },
    ], [source])

    const windows = await item.directory.listFor(source)
    expect(windows).toHaveLength(3)
    expect(windows).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '开发窗口', running: false }),
      expect.objectContaining({ title: '测试窗口', running: false }),
      expect.objectContaining({ title: '其他项目', running: false }),
    ]))
  })

  it('resolves an exact title through the normal Session Controller activation path', async () => {
    const source = agent('source', '产品窗口')
    const item = fixture([
      { header: header('source'), events: titleAndRoute('产品窗口') },
      { header: header('target'), events: titleAndRoute('测试窗口', 'target-provider', 'target-model') },
    ], [source])

    const resolved = await item.directory.resolve(source, { targetName: '测试窗口' })
    expect(resolved).toMatchObject({ targetLink: 'dsh://session/target', window: { title: '测试窗口' } })
    expect(item.resolveAgent).toHaveBeenCalledWith('target')
  })

  it('rejects duplicate displayed titles instead of guessing', async () => {
    const source = agent('source', '产品窗口')
    const item = fixture([
      { header: header('a'), events: titleAndRoute('重复窗口') },
      { header: header('b'), events: titleAndRoute('重复窗口') },
    ], [source])
    await expect(item.directory.resolve(source, { targetName: '重复窗口' }))
      .resolves.toMatchObject({ code: 'target-name-ambiguous' })
    expect(item.resolveAgent).not.toHaveBeenCalled()
  })

  it('renders running and available conversations as equally addressable', async () => {
    const source = agent('source', '产品窗口')
    const working = { ...agent('working', '开发窗口'), status: 'running' as const } as Agent
    const item = fixture([
      { header: header('available'), events: titleAndRoute('测试窗口') },
    ], [source, working])
    await item.directory.refresh()
    const context = item.directory.renderModelContext(source, 8)
    expect(context).toContain('title "开发窗口"; working')
    expect(context).toContain('title "测试窗口"; available')
    expect(context).toContain('There is no connect or disconnect state')
  })

  it('states the standing rule for answering incoming window messages', async () => {
    const source = agent('source', '产品窗口')
    const item = fixture([
      { header: header('available'), events: titleAndRoute('测试窗口') },
    ], [source])
    await item.directory.refresh()
    const context = item.directory.renderModelContext(source, 8)
    expect(context).toContain('Window message from conversation "title"')
    expect(context).toContain('only the sender\'s displayed name, never a task assigned to this window')
    expect(context).toContain('omit target_name so the sender receives the reply automatically')
  })

  it('skips one unreadable persisted conversation without blocking the directory', async () => {
    const source = agent('source', '产品窗口')
    const item = fixture([
      { header: header('source'), events: titleAndRoute('产品窗口') },
      { header: header('code'), events: titleAndRoute('开发窗口') },
      { header: header('old'), events: titleAndRoute('旧窗口') },
    ], [source])
    vi.mocked(item.persistence.inspect).mockImplementation(async (id) => {
      if (id === 'old') throw new Error('unsupported session format')
      const title = id === 'code' ? '开发窗口' : '产品窗口'
      return { meta: header(String(id)), events: titleAndRoute(title) }
    })

    await expect(item.directory.listFor(source)).resolves.toMatchObject([
      { title: '开发窗口' },
    ])
  })
})
