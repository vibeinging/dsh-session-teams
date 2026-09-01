/**
 * DSH window-link host plugin: register one consent-gated tool that queues a
 * task to another ordinary DSH session through the official API gateway.
 * @module @vibeinging/dsh-window-link
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { authorizeWindowLink } from './authority.ts'
import { DeliveryLedger, deliverWindowTask, type WindowTaskResult } from './delivery.ts'
import { parseWindowLink, serializeWindowLink, WindowLinkParseError } from './protocol.ts'

export {
  authorizeWindowLink,
  currentDirectMessages,
  type WindowLinkAuthority,
} from './authority.ts'
export {
  DeliveryLedger,
  deliverWindowTask,
  type DeliverWindowTaskOptions,
  type WindowTaskResult,
} from './delivery.ts'
export {
  extractWindowLinks,
  FORWARDED_TASK_PREFIX,
  MAX_SESSION_ID_CHARS,
  parseWindowLink,
  renderForwardedTask,
  serializeWindowLink,
  WINDOW_LINK_PROTOCOL_VERSION,
  WindowLinkParseError,
  type ForwardedTask,
  type WindowLink,
} from './protocol.ts'

/** Cordis plugin name used in loader diagnostics. */
export const name = 'window-link'

/** Host services required by the plugin. */
export const inject = ['tools', 'agents']

/** Default largest task payload accepted from the model-facing tool. */
export const DEFAULT_MAX_TASK_CHARS = 20_000

/** Default number of process-local message receipts retained for duplicate suppression. */
export const DEFAULT_MAX_REMEMBERED_MESSAGES = 1_024

/** Default in-process API request deadline. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/** Host plugin configuration. */
export interface Config {
  /** Largest forwarded task in UTF-16 characters (default 20000). */
  maxTaskChars?: number
  /** Maximum process-local message ids retained (default 1024). */
  maxRememberedMessages?: number
  /** API request deadline in milliseconds (default 30000). */
  requestTimeoutMs?: number
}

/** Validated deployment settings with usable defaults. */
export const Config: z<Config> = z.object({
  maxTaskChars: z.number().min(1).default(DEFAULT_MAX_TASK_CHARS),
  maxRememberedMessages: z.number().min(1).default(DEFAULT_MAX_REMEMBERED_MESSAGES),
  requestTimeoutMs: z.number().min(1).max(2_147_483_647).default(DEFAULT_REQUEST_TIMEOUT_MS),
})

interface ResolvedConfig {
  readonly maxTaskChars: number
  readonly maxRememberedMessages: number
  readonly requestTimeoutMs: number
}

const MESSAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u

/** Render one canonical receipt into a compact model-facing text block. */
function renderResult(value: WindowTaskResult): string {
  return [
    `status: ${value.status}`,
    `message_id: ${value.messageId}`,
    `target_link: ${value.targetLink}`,
    `code: ${value.code}`,
    `message: ${value.message}`,
  ].join('\n')
}

/** Return one definite refusal without touching the target gateway. */
function rejected(
  messageId: string,
  targetLink: string,
  code: string,
  message: string,
): WindowTaskResult {
  return { status: 'rejected', messageId, targetLink, code, message }
}

/** Validate integer-only configuration that Schemastery's number bounds cannot express. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`window-link config ${name} must be a positive safe integer`)
  }
}

/**
 * Build the tool definition around an API client and one receipt ledger.
 * Exported for focused composition tests; normal callers use {@link apply}.
 * @param config - Fully resolved limits.
 * @param agents - Official live-agent directory.
 * @param ledger - Process-local duplicate ledger.
 * @returns Typed DSH tool definition.
 */
export function createWindowTaskTool(
  config: ResolvedConfig,
  agents: Pick<AgentRegistry, 'get'>,
  ledger: DeliveryLedger,
) {
  return defineTool({
    name: 'send_window_task',
    description:
      'Queue a task in another ordinary DSH session. target_link must be the complete dsh://session/... link that the user pasted into the current message. A forwarded task cannot relay another task. Success means accepted by the target queue, not completed. Reuse message_id only for the exact same target and task.',
    parameters: {
      target_link: {
        type: 'string',
        required: true,
        description: 'Complete dsh://session/... deep link pasted by the user in this message.',
      },
      task: {
        type: 'string',
        required: true,
        description: 'Task text to queue in the target session.',
      },
      message_id: {
        type: 'string',
        description: 'Optional 8-128 character id for exact duplicate suppression; omit to generate one.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: ['accepted', 'rejected'] },
          messageId: { type: 'string', required: true },
          targetLink: { type: 'string', required: true },
          code: { type: 'string', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderResult(value) }],
    },
    timeoutMs: config.requestTimeoutMs,
    async execute(args, exec) {
      const messageId = args.message_id ?? `wl-${randomUUID()}`
      if (!MESSAGE_ID_PATTERN.test(messageId)) {
        return rejected(
          messageId,
          args.target_link,
          'invalid-message-id',
          'message_id must be 8-128 characters using letters, numbers, dot, underscore, colon, or hyphen',
        )
      }
      if (args.task.trim().length === 0) {
        return rejected(messageId, args.target_link, 'empty-task', 'task must contain non-whitespace text')
      }
      if (args.task.length > config.maxTaskChars) {
        return rejected(
          messageId,
          args.target_link,
          'task-too-large',
          `task exceeds the configured ${String(config.maxTaskChars)} character limit`,
        )
      }

      let parsed
      try {
        parsed = parseWindowLink(args.target_link)
      } catch (error: unknown) {
        const message = error instanceof WindowLinkParseError ? error.message : 'target link could not be parsed'
        return rejected(messageId, args.target_link, 'invalid-link', message)
      }

      const sourceSessionId = exec.agent?.session.id
      const authority = authorizeWindowLink(exec.agent?.session.events, parsed.sessionId)
      if (!authority.ok) {
        return rejected(messageId, parsed.canonical, authority.code, authority.message)
      }
      if (sourceSessionId === undefined) {
        return rejected(messageId, parsed.canonical, 'missing-agent', 'window task delivery requires an agent-owned tool call')
      }
      if (exec.agent?.session.header.origin === 'subagent') {
        return rejected(messageId, parsed.canonical, 'source-not-window', 'subagent sessions cannot send window-link tasks')
      }
      if (sourceSessionId === parsed.sessionId) {
        return rejected(messageId, parsed.canonical, 'self-target', 'the source and target sessions must be different')
      }

      const fingerprint = `${parsed.sessionId}\u0000${args.task}`
      return ledger.run(messageId, fingerprint, parsed.canonical, () => deliverWindowTask({
        agents,
        sourceSessionId,
        targetSessionId: parsed.sessionId,
        messageId,
        task: args.task,
        signal: exec.signal,
      }))
    },
  })
}

/**
 * Register the window-task tool over the Host's official live-agent directory.
 * @param ctx - Cordis context providing tools and agents.
 * @param config - Loader-resolved limits.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveInteger('maxTaskChars', resolved.maxTaskChars)
  assertPositiveInteger('maxRememberedMessages', resolved.maxRememberedMessages)
  assertPositiveInteger('requestTimeoutMs', resolved.requestTimeoutMs)

  const ledger = new DeliveryLedger(resolved.maxRememberedMessages)
  ctx.effect(() => {
    const dispose = ctx.tools.register(createWindowTaskTool(resolved, ctx.agents, ledger))
    return () => {
      dispose()
      ledger.clear()
    }
  }, 'window-link: tool and duplicate ledger')
}

/** Canonical source-session link helper for integrations without the browser entry. */
export { serializeWindowLink as linkForSession }
