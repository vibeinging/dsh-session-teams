import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { createWindowTaskTool, DeliveryLedger } from '../src/index.ts'
import { FORWARDED_TASK_PREFIX } from '../src/protocol.ts'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

function activeAgent(ctx: Context, session: Session, followup: (message: UserMessage) => void): Agent {
  return {
    id: session.id,
    session,
    ctx,
    options: {},
    inbox: {} as never,
    status: 'idle',
    followup,
  } as Agent
}

describe('alpha.3 Host integration', () => {
  it('uses the live AgentRegistry and Inbox for accepted and refused delivery', async () => {
    context = new Context()
    await context.plugin(AgentRegistry)

    const sourceSession = Session.create(SessionId('host-source'))
    const targetSession = Session.create(SessionId('host-target'))
    const targetInbox = new Inbox(targetSession, {
      inserted() {},
      discarded() {},
      claimed() {},
    })
    const sourceAgent = activeAgent(context, sourceSession, () => undefined)
    const targetAgent = activeAgent(context, targetSession, message => {
      targetInbox.append('next-turn', message)
    })
    context.agents.register(sourceAgent)
    context.agents.register(targetAgent)

    sourceSession.append('turn/start', { turn: 1 })
    sourceSession.append('step/start', { turn: 1, step: 1 })
    sourceSession.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '请让 dsh://session/host-target 检查发布包' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const tool = createWindowTaskTool({
      maxTaskChars: 1_000,
      maxRememberedMessages: 8,
      requestTimeoutMs: 30_000,
    }, context.agents, new DeliveryLedger(8))
    const exec = {
      signal: new AbortController().signal,
      agent: sourceAgent,
    } as ToolRunContext

    await expect(tool.execute({
      target_link: 'dsh://session/host-target',
      task: '检查发布包',
      message_id: 'host-message-1',
    }, exec)).resolves.toMatchObject({ status: 'accepted', code: 'queued' })
    expect(targetInbox.nextTurn).toHaveLength(1)
    expect(targetInbox.nextTurn[0]?.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining(FORWARDED_TASK_PREFIX),
    })

    await expect(tool.execute({
      target_link: 'dsh://session/not-authorized',
      task: '不应投递',
      message_id: 'host-message-2',
    }, exec)).resolves.toMatchObject({ status: 'rejected', code: 'link-not-authorized' })
    expect(targetInbox.nextTurn).toHaveLength(1)
  })
})
