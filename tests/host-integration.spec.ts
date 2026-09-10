import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import {
  createWindowMessageTool,
  DeliveryLedger,
  type ResolvedConfig,
  WindowTeamCoordinator,
  WindowTeamScheduler,
} from '../src/index.ts'
import type { ConversationWindowDirectory } from '../src/directory.ts'
import { parseVisibleWindowMessage } from '../src/protocol.ts'

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

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

function activeAgent(ctx: Context, session: Session, inbox: Inbox): Agent {
  return {
    id: session.id,
    session,
    ctx,
    options: {},
    inbox,
    status: 'idle',
    followup: message => { inbox.append('next-turn', message) },
    steer: message => { inbox.append('next-step', message) },
  } as Agent
}

/** Recording stand-in for the durable Inbox the 0.1.5 runtime now owns internally. */
class FakeInbox {
  readonly nextStep: unknown[] = []
  readonly nextTurn: unknown[] = []
  append(mode: 'next-step' | 'next-turn', message: unknown): void {
    ;(mode === 'next-step' ? this.nextStep : this.nextTurn).push(message)
  }
}

function inboxFor(_session: Session): FakeInbox {
  return new FakeInbox()
}

describe('alpha.4 Host integration', () => {
  it('routes by title through the real Agent registry and durable Inbox without connecting first', async () => {
    context = new Context()
    await context.plugin(AgentRegistry)

    const sourceId = SessionId('host-source')
    const targetId = SessionId('host-target')
    const sourceSession = Session.create(sourceId, [], {
      version: 3, id: sourceId, createdAt: 1, cwd: '/workspace', isSeeded: false, delegationDepth: 0,
    })
    const targetSession = Session.create(targetId, [], {
      version: 3, id: targetId, createdAt: 1, cwd: '/workspace', isSeeded: false, delegationDepth: 0,
    })
    const sourceAgent = activeAgent(context, sourceSession, inboxFor(sourceSession))
    const targetInbox = inboxFor(targetSession)
    const targetAgent = activeAgent(context, targetSession, targetInbox)
    context.agents.register(sourceAgent)
    context.agents.register(targetAgent)

    sourceSession.append('turn/start', { turn: 1 })
    sourceSession.append('step/start', { turn: 1, step: 1 })
    sourceSession.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '让测试窗口检查发布包' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const directory = {
      resolve: async () => ({
        agent: targetAgent,
        window: {
          sessionId: targetSession.id,
          title: '测试窗口',
          running: true,
          createdAt: targetSession.header.createdAt,
          cwd: '/workspace',
          agentOptions: {},
        },
        targetLink: 'dsh://session/host-target',
      }),
    } as unknown as ConversationWindowDirectory
    const coordinator = new WindowTeamCoordinator()
    const scheduler = new WindowTeamScheduler({ taskRetryDelayMs: 1 }, directory, coordinator)
    const message = createWindowMessageTool(config, directory, new DeliveryLedger(8), coordinator, scheduler)

    await expect(message.execute({
      target_name: '测试窗口',
      message: '检查发布包',
      message_id: 'host-message-1',
    }, { signal: new AbortController().signal, agent: sourceAgent } as ToolRunContext))
      .resolves.toMatchObject({ status: 'accepted', code: 'queued' })
    expect(targetInbox.nextStep).toHaveLength(1)
    const delivered = targetInbox.nextStep[0]
    const relay = delivered?.content[0]
    expect(relay?.type).toBe('text')
    if (relay?.type === 'text') {
      expect(parseVisibleWindowMessage(delivered?.source, relay.text)).toMatchObject({
        message: '检查发布包',
        sourceSessionId: 'host-source',
        targetSessionId: 'host-target',
      })
    }
  })
})
