/** Compact, navigable presentation for a message relayed from another conversation. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { parseVisibleWindowMessage, parseWindowRelayMessage, type WindowMessage } from '../protocol.ts'
import css from './WindowRelayMessage.module.css'

type RelayNode = ChatNodeViewProps<'user' | 'steering' | 'context'>['node']
type UseSessions = ChatNodeViewProps<'user'>['useSessions']

/** Props kept explicit so the relay presentation can be tested without a Slot registry. */
export interface WindowRelayMessageProps extends PropsLocale<'sessionTeams'> {
  /** Final Chat node currently being rendered. */
  readonly node: RelayNode
  /** Session-directory selector supplied by the standard Chat Slot props. */
  readonly useSessions: UseSessions
  /** Original Chat renderer used when the message is not owned by this plugin. */
  readonly fallback: ReactNode
  /** Open a listed conversation through the Session Controller. */
  readonly openSession: (sessionId: SessionId) => void
}

/** Preserve the original renderer unless durable relay metadata and visible text agree. */
export function WindowRelayMessage({ node, useSessions, fallback, openSession, t }: WindowRelayMessageProps) {
  const relay = readRelay(node)
  if (relay === undefined) return fallback
  return <RelayCard relay={relay} time={node.data.time} useSessions={useSessions} openSession={openSession} t={t} />
}

interface RelayCardProps extends PropsLocale<'sessionTeams'> {
  readonly relay: WindowMessage
  readonly time: number
  readonly useSessions: UseSessions
  readonly openSession: (sessionId: SessionId) => void
}

function RelayCard({ relay, time, useSessions, openSession, t }: RelayCardProps) {
  const copiedTimer = useRef<number | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  const liveTitle = useSessions((snapshot: SessionListState) => snapshot.byId[relay.sourceSessionId]?.displayTitle)
  const sourceTitle = liveTitle ?? relay.sourceName ?? String(relay.sourceSessionId)
  const available = liveTitle !== undefined

  useEffect(() => () => {
    if (copiedTimer.current !== undefined) window.clearTimeout(copiedTimer.current)
  }, [])

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(relay.message)
      setCopied(true)
      if (copiedTimer.current !== undefined) window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => { setCopied(false) }, 1600)
    } catch {
      // Clipboard denial leaves the message unchanged and available for manual selection.
    }
  }

  return (
    <div
      className={css.row}
      data-session-teams-message="true"
      data-source-session-id={String(relay.sourceSessionId)}
    >
      <div className={css.stack}>
        <article className={css.card}>
          {available ? (
            <button
              type="button"
              className={css.sourceButton}
              aria-label={t('message.open', { name: sourceTitle })}
              title={t('message.open', { name: sourceTitle })}
              onClick={() => { openSession(relay.sourceSessionId) }}
            >
              <RelayIcon className={css.sourceIcon} />
              <span className={css.sourceText}>
                <span className={css.sourceContext}>{t('message.from')}</span>
                <span className={css.sourceName}>{sourceTitle}</span>
              </span>
              <ChevronIcon className={css.chevron} />
            </button>
          ) : (
            <div className={css.sourceStatic} title={t('message.unavailable', { name: sourceTitle })}>
              <RelayIcon className={css.sourceIcon} />
              <span className={css.sourceText}>
                <span className={css.sourceContext}>{t('message.from')}</span>
                <span className={css.sourceName}>{sourceTitle}</span>
              </span>
            </div>
          )}
          <div className={css.body}>{relay.message}</div>
        </article>
        <div className={css.actions}>
          <time dateTime={new Date(time).toISOString()}>{formatTime(time)}</time>
          <button
            type="button"
            className={css.copyButton}
            aria-label={t(copied ? 'message.copied' : 'message.copy')}
            title={t(copied ? 'message.copied' : 'message.copy')}
            onClick={() => { void copyMessage() }}
          >
            {copied ? <CheckIcon className={css.actionIcon} /> : <CopyIcon className={css.actionIcon} />}
          </button>
        </div>
      </div>
    </div>
  )
}

function readRelay(node: RelayNode): WindowMessage | undefined {
  if (node.data.content.length === 0 || node.data.content.some(block => block.type !== 'text')) return undefined
  const text = node.data.content.map(block => block.type === 'text' ? block.text : '').join('')
  return parseWindowRelayMessage(node.data.source, text)
    ?? parseVisibleWindowMessage(node.data.source, text)
}

function formatTime(time: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(time)
}

interface IconProps {
  readonly className?: string | undefined
}

function RelayIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2.75" y="4.25" width="8.5" height="7" rx="1.6" />
      <path d="M8.75 13.5v.25A1.5 1.5 0 0 0 10.25 15.25h5.5a1.5 1.5 0 0 0 1.5-1.5v-4.5a1.5 1.5 0 0 0-1.5-1.5h-2" />
      <path d="m12.5 5.8 1.7 1.7-1.7 1.7" />
    </svg>
  )
}

function ChevronIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="m6 3.5 4.25 4.5L6 12.5" />
    </svg>
  )
}

function CopyIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5.25" y="5.25" width="7" height="7" rx="1.5" />
      <path d="M10.75 3.75v-.5a1.5 1.5 0 0 0-1.5-1.5h-6a1.5 1.5 0 0 0-1.5 1.5v6a1.5 1.5 0 0 0 1.5 1.5h.5" />
    </svg>
  )
}

function CheckIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="m3.25 8.25 3 3 6.5-6.5" />
    </svg>
  )
}
