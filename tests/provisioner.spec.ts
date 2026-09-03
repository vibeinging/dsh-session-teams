import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  ConversationWindowProvisioner,
  currentModelSelection,
  windowConversationHost,
} from '../src/provisioner.ts'

function sourceAgent(): Agent {
  return {
    id: SessionId('leader'),
    options: {
      provider: 'fallback-provider',
      model: 'fallback-model',
      reasoningEffort: 'high' as never,
    },
    session: {
      id: SessionId('leader'),
      header: {
        version: 0,
        id: SessionId('leader'),
        createdAt: 1,
        cwd: '/workspace',
        isSeeded: false,
        delegationDepth: 0,
        agentPreset: 'standard',
      },
      requestHeader: () => ({
        config: {
          provider: 'selected-provider',
          model: 'selected-model',
          reasoningEffort: 'max',
          maxTokens: 256_000,
        },
        adapterDefaults: { maxTokens: true },
      }),
    },
  } as Agent
}

function sessionController(agent: Agent) {
  const create = vi.fn(async (request: { sessionId: ReturnType<typeof SessionId> }) => ({
    sessionId: request.sessionId,
    agentPreset: 'standard',
  }))
  const rename = vi.fn(async () => ({ title: 'Development', seq: 1 }))
  const selectModel = vi.fn(async () => ({ selected: {} }))
  const resolveAgent = vi.fn(async () => ({ agent }))
  return { create, rename, selectModel, resolveAgent }
}

describe('conversation window provisioner', () => {
  it('creates a normal Session through the official controller and inherits its complete preset', async () => {
    const source = sourceAgent()
    const child = { ...source, id: SessionId('child') } as Agent
    const sessions = sessionController(child)
    const provisioner = new ConversationWindowProvisioner(sessions as never)
    const signal = new AbortController().signal

    const result = await provisioner.create({
      source,
      title: 'Development',
      cwd: '/workspace',
      workspace: { id: 'workspace-1' as never },
      signal,
    })

    expect(result.agent).toBe(child)
    expect(sessions.create).toHaveBeenCalledWith({
      sessionId: expect.stringMatching(/^session-/u),
      workspaceId: 'workspace-1',
      agentPreset: 'standard',
    })
    const sessionId = sessions.create.mock.calls[0]?.[0].sessionId
    expect(sessions.rename).toHaveBeenCalledWith({ sessionId, title: 'Development' })
    expect(sessions.selectModel).toHaveBeenCalledWith({
      sessionId,
      provider: 'selected-provider',
      model: 'selected-model',
      reasoningEffort: 'max',
    })
    expect(sessions.resolveAgent).toHaveBeenCalledWith(sessionId)
  })

  it('uses the parent product Host when the initiating Session is product-bound', async () => {
    const source = sourceAgent()
    const child = { ...source, id: SessionId('product-child') } as Agent
    const sessions = sessionController(child)
    const conversationCreateScope = vi.fn(async () => ({ mode: 'product' as const }))
    const conversationCreate = vi.fn(async () => ({
      appSessionId: 'app-child',
      dshSessionId: 'product-child',
    }))
    const provisioner = new ConversationWindowProvisioner(sessions as never, {
      conversationCreateScope,
      conversationCreate,
    })
    const signal = new AbortController().signal

    await expect(provisioner.create({
      source,
      title: 'Testing',
      cwd: '/workspace',
      signal,
    })).resolves.toEqual({ sessionId: 'product-child', agent: child })

    expect(conversationCreateScope).toHaveBeenCalledWith({ sessionId: source.session.id, signal })
    expect(conversationCreate).toHaveBeenCalledWith({
      title: 'Testing',
      agentPreset: 'standard',
    }, { sessionId: source.session.id, signal })
    expect(sessions.create).not.toHaveBeenCalled()
    expect(sessions.rename).not.toHaveBeenCalled()
    expect(sessions.selectModel).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'product-child',
      provider: 'selected-provider',
      model: 'selected-model',
    }))
  })

  it('uses the official Session Controller when the parent reports an ordinary DSH Session', async () => {
    const source = sourceAgent()
    const child = { ...source, id: SessionId('dsh-child') } as Agent
    const sessions = sessionController(child)
    const conversationCreateScope = vi.fn(async () => ({ mode: 'dsh' as const }))
    const conversationCreate = vi.fn()
    const provisioner = new ConversationWindowProvisioner(sessions as never, {
      conversationCreateScope,
      conversationCreate,
    })
    const signal = new AbortController().signal

    await expect(provisioner.create({
      source,
      title: 'Testing',
      cwd: '/workspace',
      workspace: { id: 'workspace-1' as never },
      signal,
    })).resolves.toEqual({ sessionId: expect.stringMatching(/^session-/u), agent: child })

    expect(conversationCreateScope).toHaveBeenCalledWith({ sessionId: source.session.id, signal })
    expect(conversationCreate).not.toHaveBeenCalled()
    expect(sessions.create).toHaveBeenCalledWith({
      sessionId: expect.stringMatching(/^session-/u),
      workspaceId: 'workspace-1',
      agentPreset: 'standard',
    })
    expect(sessions.rename).toHaveBeenCalledWith({
      sessionId: sessions.create.mock.calls[0]?.[0].sessionId,
      title: 'Testing',
    })
  })

  it('rejects an unknown parent creation scope without creating either kind of Session', async () => {
    const source = sourceAgent()
    const sessions = sessionController(source)
    const conversationCreate = vi.fn()
    const provisioner = new ConversationWindowProvisioner(sessions as never, {
      conversationCreateScope: vi.fn(async () => ({ mode: 'unknown' as never })),
      conversationCreate,
    })

    await expect(provisioner.create({
      source,
      title: 'Testing',
      cwd: '/workspace',
      signal: new AbortController().signal,
    })).rejects.toThrow(/unknown conversation creation scope/u)
    expect(conversationCreate).not.toHaveBeenCalled()
    expect(sessions.create).not.toHaveBeenCalled()
  })

  it('rejects an incomplete product response instead of creating a raw Session', async () => {
    const source = sourceAgent()
    const sessions = sessionController(source)
    const provisioner = new ConversationWindowProvisioner(sessions as never, {
      conversationCreate: vi.fn(async () => ({ dshSessionId: '' })),
    })

    await expect(provisioner.create({
      source,
      title: 'Testing',
      cwd: '/workspace',
      signal: new AbortController().signal,
    })).rejects.toThrow(/without a DSH Session id/u)
    expect(sessions.create).not.toHaveBeenCalled()
  })

  it('recognizes only the explicit product conversation capability', () => {
    expect(windowConversationHost({ conversationCreate() {} })).toBeDefined()
    expect(windowConversationHost({ projectList() {} })).toBeUndefined()
    expect(windowConversationHost(null)).toBeUndefined()
  })

  it('falls back to Agent options before the first request header exists', () => {
    const source = sourceAgent()
    const withoutHeader = {
      ...source,
      session: { ...source.session, requestHeader: () => undefined },
    } as Agent
    expect(currentModelSelection(withoutHeader)).toEqual({
      provider: 'fallback-provider',
      model: 'fallback-model',
      reasoningEffort: 'high',
    })
  })
})
