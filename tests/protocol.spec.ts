import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  extractWindowLinks,
  FORWARDED_TASK_PREFIX,
  parseWindowLink,
  renderForwardedTask,
  serializeWindowLink,
  WindowLinkParseError,
} from '../src/protocol.ts'

describe('window-link protocol', () => {
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

  it('renders a versioned envelope with source, target, id, and non-completion wording', () => {
    const rendered = renderForwardedTask({
      messageId: 'message-123',
      sourceSessionId: SessionId('source'),
      targetSessionId: SessionId('target'),
      task: '检查构建结果',
    })
    expect(rendered).toContain(FORWARDED_TASK_PREFIX)
    expect(rendered).toContain('message-id: message-123')
    expect(rendered).toContain('source-link: dsh://session/source')
    expect(rendered).toContain('target-link: dsh://session/target')
    expect(rendered).toContain('completion is not implied')
    expect(rendered.endsWith('检查构建结果')).toBe(true)
  })
})
