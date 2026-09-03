import { describe, expect, it, vi } from 'vitest'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { DeliveryLedger, deliverWindowTask } from '../src/delivery.ts'
import { FORWARDED_TASK_PREFIX, WINDOW_RELAY_SOURCE_FRAMING } from '../src/protocol.ts'

function agentDirectory(followup: (message: unknown) => void, origin?: 'subagent'):
Pick<AgentRegistry, 'get'> {
  return {
    get: (sessionId) => ({
      followup,
      session: {
        id: sessionId,
        header: origin === undefined ? { delegationDepth: 0 } : { origin, delegationDepth: 1 },
      },
    } as never),
  }
}

describe('active-window delivery', () => {
  it('queues one versioned user message and reports acceptance, not completion', async () => {
    const followup = vi.fn()
    const result = await deliverWindowTask({
      agents: agentDirectory(followup),
      sourceSessionId: SessionId('source'),
      targetSessionId: SessionId('target'),
      messageId: 'message-123',
      task: 'run focused tests',
      signal: new AbortController().signal,
    })
    expect(result).toMatchObject({ status: 'accepted', code: 'queued' })
    expect(followup).toHaveBeenCalledTimes(1)
    const message = followup.mock.calls[0]?.[0] as {
      content: Array<{ type: string; text: string }>
      source: { kind: string; sessionTeams?: { sourceSessionId?: string; targetSessionId?: string } }
    }
    expect(message.source).toMatchObject({
      kind: 'user',
      sessionTeams: { sourceSessionId: 'source', targetSessionId: 'target' },
    })
    expect(message.content[0]?.text)
      .toBe(`Window message from conversation "source":\n${WINDOW_RELAY_SOURCE_FRAMING}\n\nmessage:\nrun focused tests`)
    expect(message.content[0]?.text).not.toContain(FORWARDED_TASK_PREFIX)
  })

  it('definitely rejects an inactive target', async () => {
    const agents = { get: () => undefined } as Pick<AgentRegistry, 'get'>
    await expect(deliverWindowTask({
      agents,
      sourceSessionId: SessionId('source'),
      targetSessionId: SessionId('missing'),
      messageId: 'message-123',
      task: 'x',
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ status: 'rejected', code: 'target-not-active' })
  })

  it('does not expose subagent sessions as windows', async () => {
    await expect(deliverWindowTask({
      agents: agentDirectory(vi.fn(), 'subagent'),
      sourceSessionId: SessionId('source'),
      targetSessionId: SessionId('child'),
      messageId: 'message-123',
      task: 'x',
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ status: 'rejected', code: 'target-not-window' })
  })
})

describe('delivery ledger', () => {
  it('shares the first result for an exact duplicate message id', async () => {
    const ledger = new DeliveryLedger(2)
    const deliver = vi.fn(async () => ({
      status: 'accepted' as const,
      messageId: 'message-123',
      targetLink: 'dsh://session/target',
      code: 'queued',
      message: 'accepted',
    }))
    const [first, second] = await Promise.all([
      ledger.run('message-123', 'target\u0000task', 'dsh://session/target', deliver),
      ledger.run('message-123', 'target\u0000task', 'dsh://session/target', deliver),
    ])
    expect(first).toEqual(second)
    expect(deliver).toHaveBeenCalledTimes(1)
  })

  it('rejects reuse of one id for a changed payload', async () => {
    const ledger = new DeliveryLedger(2)
    await ledger.run('message-123', 'first', 'dsh://session/a', async () => ({
      status: 'accepted', messageId: 'message-123', targetLink: 'dsh://session/a', code: 'queued', message: 'ok',
    }))
    await expect(ledger.run('message-123', 'second', 'dsh://session/b', async () => ({
      status: 'accepted', messageId: 'message-123', targetLink: 'dsh://session/b', code: 'queued', message: 'ok',
    }))).resolves.toMatchObject({ status: 'rejected', code: 'message-id-conflict' })
  })
})
