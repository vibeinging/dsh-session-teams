import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import * as SessionTeams from '../src/index.ts'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

describe('real Loader composition', () => {
  it('loads the official services and publishes directory and team tool schemas', async () => {
    context = new Context()
    context.provide('sessionPersistence', {
      listSnapshots: async () => [],
      inspect: async () => { throw new Error('unexpected inspect') },
    } as never)
    context.provide('sessionController', {
      create: async () => { throw new Error('unexpected create') },
      rename: async () => { throw new Error('unexpected rename') },
      resolveAgent: async () => { throw new Error('unexpected resolve') },
      selectModel: async () => { throw new Error('unexpected select') },
    } as never)
    context.provide('workspaceRegistry', { resolveByPath: async () => undefined } as never)
    await context.plugin(Loader)
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRegistry],
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
      ['@vibeinging/dsh-session-teams', SessionTeams],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>

    await context.loader.create({ name: '@deepseek-ai/dsh-system-prompt' })
    await context.loader.create({ name: '@deepseek-ai/dsh-tools' })
    await context.loader.create({ name: '@deepseek-ai/dsh-agent' })
    await context.loader.create({ name: '@deepseek-ai/dsh-session-projection' })
    await context.loader.create({
      name: '@vibeinging/dsh-session-teams',
      config: {
        maxTaskChars: 1_000,
        maxRememberedMessages: 8,
        requestTimeoutMs: 30_000,
        maxTeamMembers: 4,
        maxTeamTasks: 16,
        maxTaskAttempts: 2,
        taskRetryDelayMs: 1,
        maxDirectoryEntries: 8,
      },
    })
    await context.loader.await()

    expect(context.tools.get('list_conversation_windows')).toBeDefined()
    expect(context.tools.get('send_window_message')).toBeDefined()
    expect(context.tools.get('create_window_team')).toBeDefined()
    expect(context.tools.get('list_window_team')).toBeDefined()
    expect(context.tools.get('add_window_task')).toBeDefined()
    expect(context.tools.get('update_window_task')).toBeUndefined()
    expect(context.tools.get('reassign_window_task')).toBeDefined()
    expect(context.tools.get('connect_window')).toBeUndefined()
    expect(context.tools.get('disconnect_window')).toBeUndefined()
    expect(context.tools.schemas().map(tool => tool.name)).toEqual(expect.arrayContaining([
      'list_conversation_windows',
      'send_window_message',
      'create_window_team',
      'list_window_team',
      'add_window_task',
      'reassign_window_task',
    ]))
  })

  it('restores persisted team members to the leader Workspace when the leader resumes', async () => {
    context = new Context()
    const attachSession = vi.fn(async () => {})
    const resolveByPath = vi.fn(async () => ({ attachSession }))
    context.provide('sessionPersistence', {
      listSnapshots: async () => [],
      inspect: async () => { throw new Error('unexpected inspect') },
    } as never)
    context.provide('sessionController', {
      create: async () => { throw new Error('unexpected create') },
      rename: async () => { throw new Error('unexpected rename') },
      resolveAgent: async () => { throw new Error('unexpected resolve') },
      selectModel: async () => { throw new Error('unexpected select') },
    } as never)
    context.provide('workspaceRegistry', { resolveByPath } as never)
    await context.plugin(SystemPrompt).await()
    await context.plugin(ToolRegistry).await()
    await context.plugin(AgentRegistry).await()
    await context.plugin(SessionProjectionRegistry).await()
    await SessionTeams.apply(context, {
      maxTaskChars: 1_000,
      maxRememberedMessages: 8,
      requestTimeoutMs: 30_000,
      maxTeamMembers: 4,
      maxTeamTasks: 16,
      maxTaskAttempts: 2,
      taskRetryDelayMs: 1,
      maxDirectoryEntries: 8,
    })

    const memberId = SessionId('restored-member')
    const leaderId = SessionId('restored-leader')
    const memberSession = Session.create(memberId, [], {
      version: 0, id: memberId, createdAt: 1, cwd: '/workspace', isSeeded: false, delegationDepth: 0,
    })
    const leaderSession = Session.create(leaderId, [], {
      version: 0, id: leaderId, createdAt: 1, cwd: '/workspace', isSeeded: false, delegationDepth: 0,
    })
    SessionTeams.appendWindowTeamState(leaderSession, {
      teamId: 'team-restored',
      revision: 1,
      goal: 'restore team membership',
      leaderSessionId: String(leaderId),
      leaderName: 'Leader',
      leaderRole: 'lead',
      members: [{ sessionId: String(memberId), name: 'Member', role: 'worker', created: true }],
      tasks: [],
    })
    const toAgent = (session: Session): Agent => ({
      id: session.id,
      session,
      ctx: context!,
      options: {},
      status: 'idle',
      followup() {},
      steer() {},
    }) as Agent
    context.agents.register(toAgent(memberSession))
    context.agents.register(toAgent(leaderSession))

    await vi.waitFor(() => {
      expect(resolveByPath).toHaveBeenCalledWith('/workspace')
      expect(attachSession).toHaveBeenCalledWith(memberId)
    })
  })
})
