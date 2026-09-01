import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { authorizeWindowLink, currentDirectMessages } from '../src/authority.ts'
import { FORWARDED_TASK_PREFIX } from '../src/protocol.ts'

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

describe('current-turn window-link authority', () => {
  it('grants only a complete link from the current direct user message', () => {
    const events = stepEvents('发送到 dsh://session/target-now')
    expect(currentDirectMessages(events)).toHaveLength(1)
    expect(authorizeWindowLink(events, SessionId('target-now'))).toEqual({ ok: true })
    expect(authorizeWindowLink(events, SessionId('other'))).toMatchObject({
      ok: false,
      code: 'link-not-authorized',
    })
  })

  it('ignores links from plugin-generated context', () => {
    const events = stepEvents('dsh://session/target', { kind: 'plugin', plugin: 'fixture' })
    expect(currentDirectMessages(events)).toEqual([])
    expect(authorizeWindowLink(events, SessionId('target'))).toMatchObject({
      ok: false,
      code: 'missing-direct-message',
    })
  })

  it('does not reuse authority from an earlier completed step', () => {
    const events: SessionEvent[] = [
      ...stepEvents('dsh://session/target'),
      { type: 'step/end', seq: 3, time: 4, data: { turn: 1, step: 1 } },
      { type: 'step/start', seq: 4, time: 5, data: { turn: 1, step: 2 } },
    ]
    expect(authorizeWindowLink(events, SessionId('target'))).toMatchObject({
      ok: false,
      code: 'missing-direct-message',
    })
  })

  it('denies relay even when the forwarded envelope names another complete link', () => {
    const events = stepEvents(`${FORWARDED_TASK_PREFIX}\ntask: dsh://session/next`)
    expect(authorizeWindowLink(events, SessionId('next'))).toMatchObject({
      ok: false,
      code: 'relay-denied',
    })
  })
})
