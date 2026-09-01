import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import * as WindowLink from '../src/index.ts'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

describe('real Loader composition', () => {
  it('loads the official services and publishes the window-task schema', async () => {
    context = new Context()
    await context.plugin(Loader)
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRegistry],
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['@vibeinging/dsh-window-link', WindowLink],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>

    await context.loader.create({ name: '@deepseek-ai/dsh-system-prompt' })
    await context.loader.create({ name: '@deepseek-ai/dsh-tools' })
    await context.loader.create({ name: '@deepseek-ai/dsh-agent' })
    await context.loader.create({
      name: '@vibeinging/dsh-window-link',
      config: { maxTaskChars: 1_000, maxRememberedMessages: 8, requestTimeoutMs: 30_000 },
    })
    await context.loader.await()

    expect(context.tools.get('send_window_task')).toBeDefined()
    expect(context.tools.schemas().map(tool => tool.name)).toContain('send_window_task')
  })
})
