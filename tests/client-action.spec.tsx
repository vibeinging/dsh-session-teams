// @vitest-environment jsdom

import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WindowLinkAction } from '../src/client/WindowLinkAction.tsx'
import { apply } from '../src/client/index.ts'

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand')
const t = (key: string): string => ({
  'copy.label': '跟另一个窗口对话',
  'copy.success': '已复制，粘贴到另一个窗口',
  'copy.failure': '复制失败，请重试',
})[key] ?? key

afterEach(() => {
  if (originalClipboard === undefined) Reflect.deleteProperty(navigator, 'clipboard')
  else Object.defineProperty(navigator, 'clipboard', originalClipboard)
  if (originalExecCommand === undefined) Reflect.deleteProperty(document, 'execCommand')
  else Object.defineProperty(document, 'execCommand', originalExecCommand)
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
    const view = render(<WindowLinkAction {...({ sessionId: 'session-one', t } as never)} />)
    fireEvent.click(view.getByRole('button', { name: '跟另一个窗口对话' }))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('dsh://session/session-one')
      expect(view.getByRole('button', { name: '已复制，粘贴到另一个窗口' })).toBeDefined()
    })
  })

  it('falls back to document copy when the Clipboard API rejects', async () => {
    const writeText = vi.fn(async () => { throw new Error('clipboard denied') })
    const execCommand = vi.fn(() => true)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    })
    const view = render(<WindowLinkAction {...({ sessionId: 'session-two', t } as never)} />)
    fireEvent.click(view.getByRole('button', { name: '跟另一个窗口对话' }))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('dsh://session/session-two')
      expect(execCommand).toHaveBeenCalledWith('copy')
      expect(view.getByRole('button', { name: '已复制，粘贴到另一个窗口' })).toBeDefined()
    })
  })

  it('reports failure only when the Clipboard API and document copy both fail', async () => {
    const writeText = vi.fn(async () => { throw new Error('clipboard denied') })
    const execCommand = vi.fn(() => false)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    })
    const view = render(<WindowLinkAction {...({ sessionId: 'session-three', t } as never)} />)
    fireEvent.click(view.getByRole('button', { name: '跟另一个窗口对话' }))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('dsh://session/session-three')
      expect(execCommand).toHaveBeenCalledWith('copy')
      expect(view.getByRole('button', { name: '复制失败，请重试' })).toBeDefined()
    })
  })
})
