import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const host = await import(new URL('../lib/index.js', import.meta.url))

assert.equal(packageJson.name, '@vibeinging/dsh-window-link')
assert.equal(packageJson.private, undefined)
assert.deepEqual(packageJson.publishConfig, {
  access: 'public',
  registry: 'https://registry.npmjs.org/',
})
assert.equal(packageJson.exports?.['.']?.default, './lib/index.js')
assert.equal(packageJson.exports?.['./client']?.default, './lib/client.js')
assert.equal(packageJson.dsh?.client?.platform, 'web')
assert.match(client, /window\.__ModuleLoader__\.load\(/u)
assert.match(client, /@vibeinging\/dsh-window-link/u)
assert.match(client, /conversation\.session\.header\.actions/u)
assert.match(client, /dsh:\/\/session\//u)
assert.match(client, /require\(["']react["']\)/u)
assert.doesNotMatch(client, /require\(["']@deepseek-ai\//u)
assert.equal(host.linkForSession('session-smoke'), 'dsh://session/session-smoke')
assert.equal(host.name, 'window-link')
for (const file of ['lib/index.js', 'lib/client.js', 'lib/client.js.map', 'lib/types/index.d.ts', 'lib/types/client/index.d.ts']) {
  await access(new URL(`../${file}`, import.meta.url))
}

const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: root,
  encoding: 'utf8',
})
const packed = JSON.parse(stdout)
assert.equal(Array.isArray(packed), true)
assert.equal(packed.length, 1)
const packedPaths = packed[0].files.map(file => file.path).sort()
for (const file of packedPaths) {
  assert.match(file, /^(?:LICENSE|README\.md|README\.zh\.md|cordis\.patch\.yml|package\.json|lib\/(?:index\.js|client\.js|client\.js\.map|types\/.+\.d\.ts))$/u)
}
for (const file of [
  'LICENSE',
  'README.md',
  'README.zh.md',
  'cordis.patch.yml',
  'package.json',
  'lib/index.js',
  'lib/client.js',
  'lib/client.js.map',
  'lib/types/index.d.ts',
  'lib/types/client/index.d.ts',
]) {
  assert.ok(packedPaths.includes(file), `npm pack is missing ${file}`)
}

console.log('package smoke: @vibeinging/dsh-window-link passed')
