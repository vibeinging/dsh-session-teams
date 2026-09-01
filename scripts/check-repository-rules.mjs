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

assert.equal(packageJson.name, '@vibeinging/dsh-window-link')
assert.equal(packageJson.private, undefined, 'public package must not set private')
assert.deepEqual(packageJson.publishConfig, {
  access: 'public',
  registry: 'https://registry.npmjs.org/',
})
assert.equal(packageJson.packageManager, 'pnpm@11.7.0')
assert.equal(packageJson.engines?.node, '^22.19.0 || >=24.0.0')
assert.equal(packageJson.dsh?.bundle?.patch, './cordis.patch.yml')
assert.equal(packageJson.dsh?.client?.platform, 'web')
assert.deepEqual(packageJson.dsh?.client?.inject, [
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-conversation',
])
assert.equal(packageJson.dshClient, undefined, 'legacy dshClient metadata is not accepted')
assert.equal(packageJson.scripts?.prepublishOnly, 'pnpm run check')
assert.deepEqual(packageJson.files, [
  'lib/index.js',
  'lib/client.js',
  'lib/client.js.map',
  'lib/types/**/*.d.ts',
  'cordis.patch.yml',
  'README.md',
  'README.zh.md',
  'LICENSE',
])

for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
  if (name === 'prepublishOnly') continue
  assert.equal(['prepare', 'prepack', 'postpack', 'publish', 'postpublish'].includes(name), false, `forbidden script ${name}`)
  assert.equal(name.includes('publish'), false, `forbidden script ${name}`)
  assert.equal(/(?:npm|pnpm)\s+publish\b/u.test(String(command)), false, `${name} publishes a package`)
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
assert.deepEqual({
  cordis: packageJson.devDependencies?.['@deepseek-ai/cordis'],
  loader: packageJson.devDependencies?.['@deepseek-ai/cordis-plugin-loader'],
  schemastery: packageJson.dependencies?.['@deepseek-ai/schemastery'],
}, {
  cordis: '4.0.2',
  loader: '1.0.3',
  schemastery: '3.18.2',
})
for (const name of [
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-session',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tools',
]) {
  assert.equal(packageJson.devDependencies?.[name], '0.1.2-alpha.3', `${name} must match DSH Desktop alpha.3`)
}
assert.equal(packageJson.peerDependencies?.['@deepseek-ai/dsh-client-runtime'], undefined)

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
  ...(await filesBelow('.i18n')),
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
