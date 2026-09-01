import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const pairs = [
  { english: 'README.md', record: '.i18n/README.i18n.yaml' },
  { english: 'docs/design/2026-09-01_window-link-design.md' },
  { english: 'docs/reports/2026-09-01_public-npm-readiness.md' },
  { english: '.agents/notes/implemented/feature/2026-09-01-window-link.md' },
]

function blobHash(content) {
  const body = Buffer.from(content)
  return createHash('sha1').update(`blob ${String(body.length)}\0`).update(body).digest('hex')
}

function codeBlocks(source) {
  return [...source.matchAll(/^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^\1\s*$/gmu)]
    .map(match => `${match[1]}${match[2]}\n${match[3]}${match[1]}`)
}

function structure(source) {
  return {
    headings: [...source.matchAll(/^(#{1,6})\s+/gmu)].map(match => match[1].length),
    unordered: [...source.matchAll(/^\s*[-*+]\s+/gmu)].length,
    ordered: [...source.matchAll(/^\s*(\d+)\.\s+/gmu)].map(match => Number(match[1])),
    tableRows: [...source.matchAll(/^\|.*\|\s*$/gmu)].length,
    code: codeBlocks(source),
    links: [...source.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)].map(match => match[1]).slice(1),
  }
}

for (const pair of pairs) {
  const englishRelative = pair.english
  const directory = dirname(englishRelative)
  const stem = basename(englishRelative, '.md')
  const chineseRelative = join(directory, `${stem}.zh.md`)
  const recordRelative = pair.record ?? join(directory, `${stem}.i18n.yaml`)
  const english = await readFile(join(root, englishRelative), 'utf8')
  const chinese = await readFile(join(root, chineseRelative), 'utf8')
  const record = await readFile(join(root, recordRelative), 'utf8')
  const switcherLine = english.startsWith('# Agent Note: ') ? 4 : 2
  assert.equal(english.split('\n')[switcherLine], `English | [中文](${stem}.zh.md)`, `${englishRelative} switcher`)
  assert.equal(chinese.split('\n')[switcherLine], `[English](${stem}.md) | 中文`, `${chineseRelative} switcher`)
  assert.deepEqual(structure(chinese), structure(english), `${englishRelative} structural signature`)
  const expected = [
    `${basename(englishRelative)}: ${blobHash(english)}`,
    `${basename(chineseRelative)}: ${blobHash(chinese)}`,
    '',
  ].join('\n')
  assert.equal(record, expected, `${recordRelative} hashes`)
}

console.log(`document pairs: ${pairs.map(pair => relative(root, join(root, pair.english))).join(', ')} passed`)
