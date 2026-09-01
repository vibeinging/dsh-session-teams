import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const host = await import(new URL('../lib/index.js', import.meta.url))

assert.equal(packageJson.private, true)
assert.equal(packageJson.exports?.['.']?.default, './lib/index.js')
assert.equal(packageJson.exports?.['./client']?.default, './lib/client.js')
assert.match(client, /window\.__ModuleLoader__\.load\(/u)
assert.match(client, /@deepseek-ai\/dsh-window-link/u)
assert.match(client, /conversation\.session\.header\.actions/u)
assert.match(client, /dsh:\/\/session\//u)
assert.match(client, /require\(["']react["']\)/u)
assert.doesNotMatch(client, /require\(["']@deepseek-ai\//u)
assert.equal(host.linkForSession('session-smoke'), 'dsh://session/session-smoke')
assert.equal(host.name, 'window-link')
for (const file of ['lib/index.js', 'lib/client.js', 'lib/client.js.map', 'lib/types/index.d.ts', 'lib/types/client/index.d.ts']) {
  await access(new URL(`../${file}`, import.meta.url))
}

console.log('package smoke: @deepseek-ai/dsh-window-link passed')
