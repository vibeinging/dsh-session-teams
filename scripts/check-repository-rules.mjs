import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
const localSpecifier = /^(?:file|link|workspace):/u
const forbiddenCheckout = new RegExp([
  'test-vibe',
  'inging|deepseek-harness',
  '\\/packages|\\.dsh\\/source\\/current',
].join(''), 'u')
const emoji = /[\p{Emoji_Presentation}\uFE0F\u200D\p{Regional_Indicator}\u2600-\u27BF]/u

assert.equal(packageJson.name, '@deepseek-ai/dsh-window-link')
assert.equal(packageJson.private, true, 'private plugin must reject publication')
assert.equal(packageJson.publishConfig, undefined, 'private plugin must not declare publishConfig')
assert.equal(packageJson.packageManager, 'pnpm@11.7.0')
assert.equal(packageJson.engines?.node, '^22.19.0 || >=24.0.0')
assert.equal(packageJson.dsh?.bundle?.patch, './cordis.patch.yml')
assert.equal(packageJson.dshClient?.platform, 'web')
assert.deepEqual(packageJson.dshClient?.inject, [
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-conversation',
])

for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
  assert.equal(name === 'prepack' || name === 'prepare' || name.includes('publish'), false, `forbidden script ${name}`)
  assert.equal(/(?:npm|pnpm)\s+(?:publish|pack)\b/u.test(String(command)), false, `${name} creates or publishes a package`)
}
for (const field of dependencyFields) {
  for (const [name, specifier] of Object.entries(packageJson[field] ?? {})) {
    assert.equal(localSpecifier.test(String(specifier)), false, `${field}.${name} must resolve from a registry`)
    assert.equal(['cordis', 'schemastery', '@cordisjs/plugin-include', '@cordisjs/plugin-loader'].includes(name), false, `${field}.${name} must use the official private SDK name`)
  }
}
for (const [name, specifier] of Object.entries(packageJson.peerDependencies ?? {})) {
  if (!name.startsWith('@deepseek-ai/')) continue
  assert.equal(packageJson.devDependencies?.[name], specifier, `${name} must use the same peer and development version`)
}

assert.equal(await readFile(join(root, '.npmrc'), 'utf8'), '@deepseek-ai:registry=https://registry.npmjs.org/\n')
assert.equal(Object.keys(packageJson.exports ?? {}).some(key => key.startsWith('./src')), false)
assert.equal((packageJson.files ?? []).some(file => file === 'src' || file.startsWith('src/')), false)
await access(join(root, 'cordis.patch.yml'))
await access(join(root, 'shared', 'tsdown.client.ts'))
assert.match(await readFile(join(root, 'tsdown.config.ts'), 'utf8'), /from ['"]\.\/shared\/tsdown\.client\.ts['"]/u)

async function filesBelow(directory) {
  const base = join(root, directory)
  let entries
  try {
    entries = await readdir(base, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const files = []
  for (const entry of entries) {
    const path = join(base, entry.name)
    if (entry.isDirectory()) files.push(...await filesBelow(relative(root, path)))
    else files.push(path)
  }
  return files
}

const declaredRuntime = new Set([
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.optionalDependencies ?? {}),
  ...Object.keys(packageJson.peerDependencies ?? {}),
])
const declaredDevelopment = new Set([...declaredRuntime, ...Object.keys(packageJson.devDependencies ?? {})])
const importPattern = /(?:from\s+|import\s*(?:\(\s*)?)['"](@deepseek-ai\/[A-Za-z0-9_-]+)/gu
const scanned = [
  ...(await filesBelow('src')),
  ...(await filesBelow('tests')),
  ...(await filesBelow('scripts')),
  ...(await filesBelow('shared')),
  ...(await filesBelow('docs')),
  ...(await filesBelow('.agents')),
  join(root, 'README.md'),
  join(root, 'README.zh.md'),
  join(root, 'package.json'),
  join(root, 'tsconfig.json'),
  join(root, 'cordis.patch.yml'),
]

for (const file of scanned) {
  const source = await readFile(file, 'utf8')
  const path = relative(root, file)
  assert.equal(forbiddenCheckout.test(source), false, `${path} references a DSH source checkout`)
  assert.equal(emoji.test(source), false, `${path} contains emoji`)
  assert.equal(source.endsWith('\n'), true, `${path} must end with one newline`)
  assert.equal(source.endsWith('\n\n'), false, `${path} must end with exactly one newline`)
  if (!['.ts', '.tsx', '.js', '.mjs'].includes(extname(file))) continue
  assert.equal(/(?:from\s+|import\s*(?:\(\s*)?)['"](?:cordis|schemastery|@cordisjs\/plugin-(?:include|loader))['"]/u.test(source), false, `${path} imports a public SDK twin`)
  for (const match of source.matchAll(importPattern)) {
    const dependency = match[1]
    if (dependency === packageJson.name) continue
    const declared = path.startsWith('src/') ? declaredRuntime : declaredDevelopment
    assert.ok(declared.has(dependency), `${path} imports undeclared ${dependency}`)
  }
}

for (const file of ['package.json', 'tsconfig.json']) {
  const source = await readFile(join(root, file), 'utf8')
  assert.equal(/(?:^|[\s"'=])(?:file|link|workspace):/mu.test(source), false, `${file} contains a local dependency protocol`)
}

console.log(`repository rules: ${packageJson.name} passed`)
