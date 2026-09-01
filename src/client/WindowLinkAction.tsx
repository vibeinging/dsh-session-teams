/** Session-header action that copies the current conversation deep link. */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { serializeWindowLink } from '../protocol.ts'
import type { WindowLinkKey } from './locales.ts'
import css from './WindowLinkAction.module.css'

/** Full props supplied by the session header action seat. */
export type WindowLinkActionProps =
  PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'windowLink'>

/**
 * Write the session link through the browser clipboard surface.
 * @param text - Exact canonical deep link.
 * @returns Whether either browser clipboard path accepted the copy.
 */
export async function writeWindowLinkClipboard(text: string): Promise<boolean> {
  /* oxlint-disable-next-line typescript/no-unnecessary-condition */
  if (navigator.clipboard?.writeText !== undefined) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Electron may deny the Clipboard API while permitting the DOM fallback.
    }
  }
  /* oxlint-disable typescript/no-deprecated */
  if (typeof document.execCommand !== 'function') return false
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
  /* oxlint-enable typescript/no-deprecated */
}

/** Copy the current session link and expose success or failure to assistive text. */
export function WindowLinkAction({ sessionId, t }: WindowLinkActionProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (state === 'idle') return
    const timer = window.setTimeout(() => { setState('idle') }, 1_500)
    return () => { window.clearTimeout(timer) }
  }, [state])

  const label: WindowLinkKey = state === 'copied'
    ? 'copy.success'
    : state === 'failed' ? 'copy.failure' : 'copy.label'

  const copy = async (): Promise<void> => {
    const copied = await writeWindowLinkClipboard(serializeWindowLink(sessionId))
    setState(copied ? 'copied' : 'failed')
  }

  return (
    <button
      type="button"
      className={css.action}
      aria-label={t(label)}
      title={t(label)}
      data-copy-state={state}
      onClick={() => { void copy() }}
    >
      <svg className={css.icon} viewBox="0 0 16 16" aria-hidden="true">
        <path d="M6.4 10.7 5.2 12a2.5 2.5 0 0 1-3.6-3.6l2.2-2.2a2.5 2.5 0 0 1 3.6 0" />
        <path d="m9.6 5.3 1.2-1.2a2.5 2.5 0 0 1 3.6 3.6l-2.2 2.2a2.5 2.5 0 0 1-3.6 0" />
        <path d="m5.8 10.2 4.4-4.4" />
      </svg>
    </button>
  )
}
