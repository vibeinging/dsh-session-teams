import { describe, expect, it, vi } from 'vitest'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { createWindowTaskTool } from '../src/index.ts'
import { DeliveryLedger } from '../src/delivery.ts'
import { FORWARDED_TASK_PREFIX } from '../src/protocol.ts'

function directEvents(text: string): SessionEvent[] {
  return [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } },
    {
      type: 'user/message', seq: 2, time: 3, surfaceOp: 'append',
      data: createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
    },
  ]
}

function execFor(source: string, prompt: string, origin?: 'subagent'): ToolRunContext {
  return {
    signal: new AbortController().signal,
    agent: {
      session: {
        id: SessionId(source),
        events: directEvents(prompt),
        header: origin === undefined ? {} : { origin },
      },
    },
  } as never
}

function fixture() {
  const followup = vi.fn()
  const agents = {
    get: () => ({ followup, session: { header: {} } } as never),
  } as Pick<AgentRegistry, 'get'>
  const tool = createWindowTaskTool({
    maxTaskChars: 1_000,
    maxRememberedMessages: 8,
    requestTimeoutMs: 30_000,
  }, agents, new DeliveryLedger(8))
  return { tool, followup }
}

describe('send_window_task tool', () => {
  it('delivers when this direct prompt contains the target link', async () => {
    const { tool, followup } = fixture()
    const result = await tool.execute({
      target_link: 'dsh://session/target',
      task: 'review the plan',
      message_id: 'message-123',
    }, execFor('source', '把计划发给 dsh://session/target'))
    expect(result).toMatchObject({ status: 'accepted', code: 'queued' })
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('refuses a model-supplied target that the user did not paste', async () => {
    const { tool, followup } = fixture()
    const result = await tool.execute({
      target_link: 'dsh://session/target',
      task: 'review the plan',
      message_id: 'message-123',
    }, execFor('source', '把计划发到另一个窗口'))
    expect(result).toMatchObject({ status: 'rejected', code: 'link-not-authorized' })
    expect(followup).not.toHaveBeenCalled()
  })

  it('refuses self-target and forwarded relay attempts', async () => {
    const self = fixture()
    await expect(self.tool.execute({
      target_link: 'dsh://session/source', task: 'x', message_id: 'message-123',
    }, execFor('source', 'dsh://session/source'))).resolves.toMatchObject({ code: 'self-target' })
    expect(self.followup).not.toHaveBeenCalled()

    const relay = fixture()
    await expect(relay.tool.execute({
      target_link: 'dsh://session/target', task: 'x', message_id: 'message-123',
    }, execFor('source', `${FORWARDED_TASK_PREFIX}\ndsh://session/target`)))
      .resolves.toMatchObject({ code: 'relay-denied' })
    expect(relay.followup).not.toHaveBeenCalled()
  })

  it('refuses a subagent source and an oversized task', async () => {
    const subagent = fixture()
    await expect(subagent.tool.execute({
      target_link: 'dsh://session/target', task: 'x', message_id: 'message-123',
    }, execFor('source', 'dsh://session/target', 'subagent')))
      .resolves.toMatchObject({ code: 'source-not-window' })

    const oversized = fixture()
    await expect(oversized.tool.execute({
      target_link: 'dsh://session/target', task: 'x'.repeat(1_001), message_id: 'message-123',
    }, execFor('source', 'dsh://session/target')))
      .resolves.toMatchObject({ code: 'task-too-large' })
  })
})
