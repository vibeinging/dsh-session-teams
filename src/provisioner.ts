/** Normal conversation creation through the official Session Controller and an optional product Host. */
import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  ModelSelection,
  SessionController,
} from '@deepseek-ai/dsh-api-session-controller'
import { SessionId, type SessionId as SessionIdValue } from '@deepseek-ai/dsh-session'
import type { Workspace } from '@deepseek-ai/dsh-workspace'

/** Session Controller operations used to create fully composed ordinary conversations. */
export type WindowSessionController = Pick<
  SessionController,
  'create' | 'rename' | 'resolveAgent' | 'selectModel'
>

/** Optional parent-owned product boundary that creates a fully bound product conversation. */
export interface WindowConversationHost {
  /** Resolve whether the initiating Session belongs to the product parent or ordinary DSH. */
  conversationCreateScope?(
    context: {
      readonly sessionId: SessionIdValue
      readonly signal: AbortSignal
    },
  ): Promise<{
    readonly mode: 'product' | 'dsh'
  }>
  /** Create one product conversation in the project authorized for the initiating Session. */
  conversationCreate(
    request: {
      readonly title: string
      readonly agentPreset?: string
    },
    context: {
      readonly sessionId: SessionIdValue
      readonly signal: AbortSignal
    },
  ): Promise<{
    readonly dshSessionId: string
    readonly appSessionId?: string
  }>
}

/** Input for creating one missing role window. */
export interface ProvisionConversationWindowRequest {
  readonly source: Agent
  readonly title: string
  readonly cwd: string
  readonly workspace?: Pick<Workspace, 'id'>
  readonly signal: AbortSignal
}

/** Fully composed, live ordinary conversation returned after provisioning. */
export interface ProvisionedConversationWindow {
  readonly sessionId: SessionIdValue
  readonly agent: Agent
}

/** Create normal conversations without copying or naming individual tool capabilities. */
export class ConversationWindowProvisioner {
  /** @param sessions - Official owner of ordinary Session composition. @param productHost - Optional parent product creator. */
  constructor(
    private readonly sessions: WindowSessionController,
    private readonly productHost?: WindowConversationHost,
  ) {}

  /** Create, name, select the source model, and resolve one fully composed role window. */
  async create(request: ProvisionConversationWindowRequest): Promise<ProvisionedConversationWindow> {
    request.signal.throwIfAborted()
    const agentPreset = request.source.session.header.agentPreset
    let sessionId: SessionIdValue
    const creationMode = await this.#creationMode(request)
    if (creationMode === 'dsh') {
      const proposedId = SessionId(`session-${randomUUID()}`)
      const created = await this.sessions.create({
        sessionId: proposedId,
        ...(request.workspace === undefined
          ? { cwd: request.cwd }
          : { workspaceId: request.workspace.id }),
        ...(agentPreset === undefined ? {} : { agentPreset }),
      })
      sessionId = created.sessionId
      await this.sessions.rename({ sessionId, title: request.title })
    } else {
      const productHost = this.productHost
      if (productHost === undefined) throw new Error('product conversation creation requires a product Host')
      const created = await productHost.conversationCreate({
        title: request.title,
        ...(agentPreset === undefined ? {} : { agentPreset }),
      }, {
        sessionId: request.source.session.id,
        signal: request.signal,
      })
      if (typeof created.dshSessionId !== 'string' || created.dshSessionId.trim().length === 0) {
        throw new Error('the product Host created a conversation without a DSH Session id')
      }
      sessionId = SessionId(created.dshSessionId)
    }

    const selection = currentModelSelection(request.source)
    if (selection !== undefined) {
      await this.sessions.selectModel({ sessionId, ...selection })
    }
    request.signal.throwIfAborted()
    const resolved = await this.sessions.resolveAgent(sessionId)
    if ('error' in resolved) throw resolved.error
    return { sessionId, agent: resolved.agent }
  }

  /** Resolve the owner before creating; older product providers remain product-authoritative. */
  async #creationMode(request: ProvisionConversationWindowRequest): Promise<'product' | 'dsh'> {
    if (this.productHost === undefined) return 'dsh'
    if (this.productHost.conversationCreateScope === undefined) return 'product'
    const scope = await this.productHost.conversationCreateScope({
      sessionId: request.source.session.id,
      signal: request.signal,
    })
    if (scope?.mode !== 'product' && scope?.mode !== 'dsh') {
      throw new Error('the product Host returned an unknown conversation creation scope')
    }
    return scope.mode
  }
}

/** Narrow an optional Host service without treating its presence as authorization. */
export function windowConversationHost(value: unknown): WindowConversationHost | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<WindowConversationHost>
  return typeof candidate.conversationCreate === 'function'
    ? candidate as WindowConversationHost
    : undefined
}

/** Read the exact route already assembled for the initiating turn. */
export function currentModelSelection(agent: Agent): ModelSelection | undefined {
  const header = agent.session.requestHeader()
  if (header !== undefined) {
    return {
      provider: header.config.provider,
      model: header.config.model,
      ...(header.config.reasoningEffort === undefined || header.adapterDefaults?.reasoningEffort === true
        ? {}
        : { reasoningEffort: header.config.reasoningEffort }),
    }
  }
  if (agent.options.provider === undefined || agent.options.model === undefined) return undefined
  return {
    provider: agent.options.provider,
    model: agent.options.model,
    ...(agent.options.reasoningEffort === undefined ? {} : { reasoningEffort: agent.options.reasoningEffort }),
  }
}
