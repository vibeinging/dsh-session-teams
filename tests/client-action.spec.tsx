// @vitest-environment jsdom

import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WindowLinkAction } from '../src/client/WindowLinkAction.tsx'
import { apply } from '../src/client/index.ts'

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

afterEach(() => {
  if (originalClipboard === undefined) Reflect.deleteProperty(navigator, 'clipboard')
  else Object.defineProperty(navigator, 'clipboard', originalClipboard)
})

describe('window link header action', () => {
  it('registers through the declared conversation header action slot', () => {
    const localeRegister = vi.fn(() => () => {})
    const slotRegister = vi.fn(() => () => {})
    const slotInject = vi.fn((_name: string, register: () => void) => { register() })
    const effect = vi.fn((register: () => unknown) => { register() })
    apply({
      effect,
      locale: { register: localeRegister },
      slots: { inject: slotInject, register: slotRegister },
    } as never)
    expect(localeRegister).toHaveBeenCalledWith('windowLink', expect.any(Object))
    expect(slotInject).toHaveBeenCalledWith('conversation.session.header.actions', expect.any(Function))
    expect(slotRegister).toHaveBeenCalledWith(expect.objectContaining({
      name: 'conversation.session.header.actions',
      id: 'window-link-copy',
    }), WindowLinkAction)
  })

  it('copies the canonical current-session link and reports success accessibly', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const t = (key: string): string => ({
      'copy.label': '复制会话链接',
      'copy.success': '会话链接已复制',
      'copy.failure': '无法复制会话链接',
    })[key] ?? key
    const view = render(<WindowLinkAction {...({ sessionId: 'session-one', t } as never)} />)
    fireEvent.click(view.getByRole('button', { name: '复制会话链接' }))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('dsh://session/session-one')
      expect(view.getByRole('button', { name: '会话链接已复制' })).toBeDefined()
    })
  })
})
