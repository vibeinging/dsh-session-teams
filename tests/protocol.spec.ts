import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  extractWindowLinks,
  isHumanUserSource,
  isWindowRelaySource,
  parseVisibleWindowMessage,
  parseWindowLink,
  parseWindowMessage,
  parseWindowRelayMessage,
  renderVisibleWindowMessage,
  renderWindowMessage,
  visibleWindowMessageSource,
  windowRelaySource,
  LEGACY_SESSION_TEAMS_MESSAGE_PREFIX,
  LEGACY_WINDOW_MESSAGE_PREFIX,
  SESSION_TEAMS_MESSAGE_PREFIX,
  SESSION_TEAMS_PLUGIN,
  serializeWindowLink,
  WINDOW_RELAY_REPLY_CONTRACT,
  WINDOW_RELAY_SOURCE_FRAMING,
  WindowLinkParseError,
} from '../src/protocol.ts'

describe('session-teams protocol', () => {
  it('round-trips opaque ids through one canonical path segment', () => {
    const link = serializeWindowLink(SessionId('session-alpha:1'))
    expect(link).toBe('dsh://session/session-alpha%3A1')
    expect(parseWindowLink(link)).toEqual({
      sessionId: 'session-alpha:1',
      canonical: link,
    })
  })

  it('reads the compatible v1 query but serializes without it', () => {
    expect(parseWindowLink('dsh://session/session-one?v=1')).toEqual({
      sessionId: 'session-one',
      canonical: 'dsh://session/session-one',
    })
  })

  it.each([
    'https://session/session-one',
    'dsh://other/session-one',
    'dsh://session/a/b',
    'dsh://session/session-one?v=2',
    'dsh://session/session-one#part',
    'dsh://session/%ZZ',
    'dsh://session/%2F',
  ])('rejects malformed or widened links: %s', (candidate) => {
    expect(() => parseWindowLink(candidate)).toThrow(WindowLinkParseError)
  })

  it('extracts links next to normal Chinese punctuation without granting malformed text', () => {
    expect(extractWindowLinks('请发给 dsh://session/session-a，并忽略 dsh://session/%ZZ、dsh://session/short/path 和 dsh://session/query?v=2。'))
      .toEqual([{ sessionId: 'session-a', canonical: 'dsh://session/session-a' }])
  })

  it('round-trips a model-directed message envelope without a reply counter', () => {
    const rendered = renderWindowMessage({
      conversationId: 'conversation-123',
      teamId: 'team-12345678',
      message: '检查构建结果',
      messageId: 'message-123',
      sourceSessionId: SessionId('source'),
      targetSessionId: SessionId('target'),
    })
    expect(rendered).toContain(SESSION_TEAMS_MESSAGE_PREFIX)
    expect(rendered).toContain('message-id: message-123')
    expect(rendered).toContain('source-link: dsh://session/source')
    expect(rendered).toContain('target-link: dsh://session/target')
    expect(rendered).not.toContain('max-hops:')
    expect(rendered).toContain('Sending a message does not end your turn.')
    expect(rendered.endsWith('检查构建结果')).toBe(true)
    expect(parseWindowMessage(rendered)).toMatchObject({
      conversationId: 'conversation-123',
      teamId: 'team-12345678',
      message: '检查构建结果',
    })
  })

  it.each([LEGACY_SESSION_TEAMS_MESSAGE_PREFIX, LEGACY_WINDOW_MESSAGE_PREFIX])(
    'reads durable v3 relays written with prefix %s',
    (prefix) => {
      const rendered = renderWindowMessage({
        conversationId: 'conversation-legacy',
        message: '继续旧任务',
        messageId: 'message-legacy',
        sourceSessionId: SessionId('source'),
        targetSessionId: SessionId('target'),
      })
        .replace(SESSION_TEAMS_MESSAGE_PREFIX, prefix)
        .replace('Reply rule:', 'hop: 0\nmax-hops: 1\nreply-expected: no\nReply rule:')
      expect(parseWindowMessage(rendered)?.message).toBe('继续旧任务')
    },
  )
})

describe('registered window-relay source', () => {
  const relay = {
    conversationId: 'conversation-12345678',
    teamId: 'team-12345678',
    taskId: 'report-task',
    message: '检查构建结果',
    messageId: 'message-12345678',
    sourceSessionId: SessionId('source'),
    sourceName: '产品窗口',
    targetSessionId: SessionId('target'),
  }

  it('round-trips routing facts through a non-human registered kind', () => {
    const source = windowRelaySource(relay)
    expect(source).toMatchObject({
      kind: 'window-relay',
      form: 'relay',
      plugin: SESSION_TEAMS_PLUGIN,
      sourceSessionId: 'source',
      targetSessionId: 'target',
    })
    expect(isWindowRelaySource(source)).toBe(true)
    expect(parseWindowRelayMessage(source, renderVisibleWindowMessage(relay))).toMatchObject({
      conversationId: 'conversation-12345678',
      teamId: 'team-12345678',
      taskId: 'report-task',
      message: '检查构建结果',
      sourceSessionId: 'source',
      targetSessionId: 'target',
    })
  })

  it('never matches a bare direct-human kind check', () => {
    expect(windowRelaySource(relay).kind === 'user').toBe(false)
    expect(isWindowRelaySource({ kind: 'user' })).toBe(false)
  })

  it('recognizes the official human user sources and rejects producer metadata', () => {
    expect(isHumanUserSource({ kind: 'user' })).toBe(true)
    expect(isHumanUserSource({ kind: 'user', rpcId: '75da81e6-b847-471c-8c44-8800ede5ac3d' })).toBe(true)
    expect(isHumanUserSource({
      kind: 'user',
      rpcId: '75da81e6-b847-471c-8c44-8800ede5ac3d',
      clientTimeZone: 'Asia/Shanghai',
    })).toBe(true)
    expect(isHumanUserSource({ kind: 'user', sessionTeams: {} })).toBe(false)
    expect(isHumanUserSource({ kind: 'user', windowRelay: {} })).toBe(false)
    expect(isHumanUserSource({ kind: 'user', foreignAutomation: true })).toBe(false)
    expect(isHumanUserSource({ kind: 'plugin', plugin: 'fixture' })).toBe(false)
    expect(isHumanUserSource(undefined)).toBe(false)
  })

  it.each([
    ['a foreign plugin identity', { plugin: 'another-plugin' }],
    ['a wrong semantic form', { form: 'notice' }],
    ['missing routing ids', { messageId: undefined, conversationId: undefined }],
    ['an invalid session id', { targetSessionId: 'bad/session/id' }],
  ])('fails closed on %s', (_name, override) => {
    expect(isWindowRelaySource({ ...windowRelaySource(relay), ...override })).toBe(false)
    expect(parseWindowRelayMessage({ ...windowRelaySource(relay), ...override }, renderVisibleWindowMessage(relay))).toBeUndefined()
  })

  it('requires the visible attribution to match the durable source', () => {
    const source = windowRelaySource(relay)
    expect(parseWindowRelayMessage(source, renderVisibleWindowMessage({ ...relay, sourceName: '其他窗口' }))).toBeUndefined()
    expect(parseWindowRelayMessage(source, '')).toBeUndefined()
  })
})

describe('relay source framing', () => {
  const relay = {
    conversationId: 'conversation-12345678',
    message: '你好啊',
    messageId: 'message-12345678',
    sourceSessionId: SessionId('source'),
    sourceName: '主窗口',
    targetSessionId: SessionId('target'),
  }

  it('places the source framing before the body only on task-less relay text', () => {
    expect(renderVisibleWindowMessage(relay))
      .toBe(`Window message from conversation "主窗口":\n${WINDOW_RELAY_SOURCE_FRAMING}\n\nmessage:\n你好啊`)
    expect(renderVisibleWindowMessage({ ...relay, taskId: 'count-1' }))
      .toBe('Window message from conversation "主窗口":\n你好啊')
  })

  it('parses the delivered text back to exactly what the sender wrote', () => {
    expect(parseVisibleWindowMessage(visibleWindowMessageSource(relay), renderVisibleWindowMessage(relay)))
      .toMatchObject({ message: '你好啊' })
    expect(parseWindowRelayMessage(windowRelaySource(relay), renderVisibleWindowMessage(relay)))
      .toMatchObject({ message: '你好啊' })
  })

  it('still reads task assignment text that carries no framing', () => {
    const withTask = { ...relay, taskId: 'count-1' }
    expect(parseVisibleWindowMessage(visibleWindowMessageSource(withTask), renderVisibleWindowMessage(withTask)))
      .toMatchObject({ message: '你好啊', taskId: 'count-1' })
  })

  it('keeps a sender message that genuinely ends with legacy contract wording unchanged', () => {
    const echo = { ...relay, message: `请复述契约\n\n${WINDOW_RELAY_REPLY_CONTRACT}` }
    expect(parseVisibleWindowMessage(visibleWindowMessageSource(echo), renderVisibleWindowMessage(echo)))
      .toMatchObject({ message: `请复述契约\n\n${WINDOW_RELAY_REPLY_CONTRACT}` })
  })

  it('still reads durable relays written with the legacy bare-title attribution', () => {
    expect(parseVisibleWindowMessage(visibleWindowMessageSource(relay), '主窗口:\n你好啊'))
      .toMatchObject({ message: '你好啊' })
    expect(parseWindowRelayMessage(windowRelaySource(relay), '主窗口:\n你好啊'))
      .toMatchObject({ message: '你好啊' })
  })

  it('still reads durable relays written with the legacy appended reply contract', () => {
    const legacy = `Window message from conversation "主窗口":\n你好啊\n\n${WINDOW_RELAY_REPLY_CONTRACT}`
    expect(parseVisibleWindowMessage(visibleWindowMessageSource(relay), legacy))
      .toMatchObject({ message: '你好啊' })
    expect(parseWindowRelayMessage(windowRelaySource(relay), legacy))
      .toMatchObject({ message: '你好啊' })
  })
})
