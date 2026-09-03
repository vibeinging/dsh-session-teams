import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import {
  currentDirectMessages,
  currentTurnDirectMessages,
  currentWindowRelay,
  latestTeamTaskAssignment,
} from '../src/authority.ts'
import {
  LEGACY_WINDOW_LINK_PLUGIN,
  LEGACY_WINDOW_MESSAGE_PREFIX,
  renderWindowMessage,
  SESSION_TEAMS_MESSAGE_PREFIX,
  SESSION_TEAMS_PLUGIN,
} from '../src/protocol.ts'

function stepEvents(text: string, source: MessageSource = { kind: 'user' }): SessionEvent[] {
  return [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } },
    {
      type: 'user/message', seq: 2, time: 3, surfaceOp: 'append',
      data: createUserMessage({ content: [{ type: 'text', text }], source }),
    },
  ]
}

describe('window-message turn facts', () => {
  it('keeps a direct user request visible across later tool steps', () => {
    const events: SessionEvent[] = [
      ...stepEvents('发送到 dsh://session/target-now'),
      { type: 'step/end', seq: 3, time: 4, data: { turn: 1, step: 1 } },
      { type: 'step/start', seq: 4, time: 5, data: { turn: 1, step: 2 } },
    ]
    expect(currentDirectMessages(events)).toEqual([])
    expect(currentTurnDirectMessages(events)).toHaveLength(1)
  })

  it('does not reuse a direct request from a completed turn', () => {
    const events: SessionEvent[] = [
      ...stepEvents('dsh://session/target'),
      { type: 'step/end', seq: 3, time: 4, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 4, time: 5, data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'turn/start', seq: 5, time: 6, data: { turn: 2 } },
      { type: 'step/start', seq: 6, time: 7, data: { turn: 2, step: 1 } },
    ]
    expect(currentTurnDirectMessages(events)).toEqual([])
  })

  it('does not treat plugin context as a direct user request', () => {
    const events = stepEvents('dsh://session/target', { kind: 'plugin', plugin: 'fixture' })
    expect(currentTurnDirectMessages(events)).toEqual([])
  })

  it('renders a trusted window relay as a user message without granting human authority', () => {
    const events = stepEvents('Source window:\n检查发布包', {
      kind: 'user',
      sessionTeams: {
        version: 1,
        plugin: SESSION_TEAMS_PLUGIN,
        messageId: 'message-visible-1',
        conversationId: 'conversation-visible-1',
        sourceSessionId: 'source',
        targetSessionId: 'target',
        sourceName: 'Source window',
      },
    } as unknown as MessageSource)

    expect(currentTurnDirectMessages(events)).toEqual([])
    expect(currentWindowRelay(events)).toMatchObject({
      messageId: 'message-visible-1',
      conversationId: 'conversation-visible-1',
      sourceSessionId: 'source',
      targetSessionId: 'target',
      message: '检查发布包',
    })
  })

  it('reads the registered window-relay kind without granting human authority', () => {
    const events = stepEvents('产品窗口:\n执行测试任务', {
      kind: 'window-relay',
      form: 'relay',
      plugin: SESSION_TEAMS_PLUGIN,
      messageId: 'relay-message-1',
      conversationId: 'relay-conversation-1',
      teamId: 'team-12345678',
      taskId: 'test-task',
      sourceSessionId: 'leader',
      targetSessionId: 'member',
      sourceName: '产品窗口',
    } as unknown as MessageSource)

    expect(currentTurnDirectMessages(events)).toEqual([])
    expect(currentWindowRelay(events)).toMatchObject({
      teamId: 'team-12345678',
      taskId: 'test-task',
      sourceSessionId: 'leader',
      targetSessionId: 'member',
      message: '执行测试任务',
    })
  })

  it('excludes any user-shaped source carrying foreign producer metadata', () => {
    const events = stepEvents('自动化注入', {
      kind: 'user',
      foreignAutomation: { scheduled: true },
    } as unknown as MessageSource)
    expect(currentTurnDirectMessages(events)).toEqual([])
  })

  it('accepts the browser prompt source as a direct human request', () => {
    const events = stepEvents('跟“数12345的窗口”说：你好啊', {
      kind: 'user',
      rpcId: '75da81e6-b847-471c-8c44-8800ede5ac3d',
      clientTimeZone: 'Asia/Shanghai',
    } as unknown as MessageSource)
    expect(currentTurnDirectMessages(events)).toHaveLength(1)
    expect(currentDirectMessages(events)).toHaveLength(1)
  })

  it('fails closed when a user-shaped window relay has invalid routing metadata', () => {
    const events = stepEvents('Source window:\n检查发布包', {
      kind: 'user',
      sessionTeams: { version: 1, plugin: SESSION_TEAMS_PLUGIN },
    } as unknown as MessageSource)

    expect(currentDirectMessages(events)).toEqual([])
    expect(currentTurnDirectMessages(events)).toEqual([])
    expect(currentWindowRelay(events)).toBeUndefined()
  })

  it('reads only a trusted plugin relay from the current turn', () => {
    const relayText = renderWindowMessage({
      conversationId: 'conversation-123',
      message: '检查发布包',
      messageId: 'message-123',
      sourceSessionId: SessionId('source'),
      targetSessionId: SessionId('target'),
    })
    const trusted = stepEvents(relayText, {
      kind: 'plugin', plugin: SESSION_TEAMS_PLUGIN, form: 'relay',
    })
    expect(currentWindowRelay(trusted)).toMatchObject({
      sourceSessionId: 'source',
      targetSessionId: 'target',
    })
    expect(currentWindowRelay(stepEvents(relayText, { kind: 'user' }))).toBeUndefined()
  })

  it('keeps the latest task assignment after ordinary relays and later turns', () => {
    const events: SessionEvent[] = [
      ...stepEvents('产品窗口:\n执行测试任务', {
        kind: 'user',
        sessionTeams: {
          version: 1,
          plugin: SESSION_TEAMS_PLUGIN,
          messageId: 'assignment-message-1',
          conversationId: 'assignment-conversation-1',
          teamId: 'team-12345678',
          taskId: 'test-task',
          sourceSessionId: 'leader',
          targetSessionId: 'member',
          sourceName: '产品窗口',
        },
      } as unknown as MessageSource),
      { type: 'step/end', seq: 3, time: 4, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 4, time: 5, data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'turn/start', seq: 5, time: 6, data: { turn: 2 } },
      { type: 'step/start', seq: 6, time: 7, data: { turn: 2, step: 1 } },
      {
        type: 'user/message', seq: 7, time: 8, surfaceOp: 'append',
        data: createUserMessage({
          content: [{ type: 'text', text: '产品窗口:\n完成后汇报结果' }],
          source: {
            kind: 'user',
            sessionTeams: {
              version: 1,
              plugin: SESSION_TEAMS_PLUGIN,
              messageId: 'reminder-message-1',
              conversationId: 'reminder-conversation-1',
              sourceSessionId: 'leader',
              targetSessionId: 'member',
              sourceName: '产品窗口',
            },
          } as unknown as MessageSource,
        }),
      },
    ]

    const current = currentWindowRelay(events)
    expect(current).toMatchObject({ message: '完成后汇报结果' })
    expect(current?.teamId).toBeUndefined()
    expect(current?.taskId).toBeUndefined()
    expect(latestTeamTaskAssignment(events)).toMatchObject({
      teamId: 'team-12345678',
      taskId: 'test-task',
      message: '执行测试任务',
    })
  })

  it('reads trusted relays written before the package rename', () => {
    const relayText = renderWindowMessage({
      conversationId: 'conversation-legacy',
      message: '检查旧任务',
      messageId: 'message-legacy',
      sourceSessionId: SessionId('source'),
      targetSessionId: SessionId('target'),
    })
      .replace(SESSION_TEAMS_MESSAGE_PREFIX, LEGACY_WINDOW_MESSAGE_PREFIX)
      .replace('Reply rule:', 'hop: 0\nmax-hops: 1\nreply-expected: no\nReply rule:')
    expect(currentWindowRelay(stepEvents(relayText, {
      kind: 'plugin', plugin: LEGACY_WINDOW_LINK_PLUGIN, form: 'relay',
    }))?.message).toBe('检查旧任务')
  })
})
