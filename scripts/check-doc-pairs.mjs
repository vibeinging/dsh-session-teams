import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
/**
 * Each entry lists the two language files of one document and which page
 * GitHub renders by default (`primary`). README.md is the repository front
 * page and is now Chinese; every other document keeps English as its
 * primary file and stores Chinese beside it as `*.zh.md`.
 */
const pairs = [
  { primary: 'zh', english: 'README.en.md', chinese: 'README.md', record: '.i18n/README.i18n.yaml' },
  { primary: 'en', english: 'docs/design/2026-09-01_session-teams-design.md', chinese: 'docs/design/2026-09-01_session-teams-design.zh.md' },
  { primary: 'en', english: 'docs/research/2026-09-02_alpha-4-agent-messaging.md', chinese: 'docs/research/2026-09-02_alpha-4-agent-messaging.zh.md' },
  { primary: 'en', english: 'docs/reports/2026-09-01_public-npm-readiness.md', chinese: 'docs/reports/2026-09-01_public-npm-readiness.zh.md' },
  { primary: 'en', english: '.agents/notes/implemented/feature/2026-09-01-session-teams.md', chinese: '.agents/notes/implemented/feature/2026-09-01-session-teams.zh.md' },
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
  const { english: englishRelative, chinese: chineseRelative } = pair
  const directory = dirname(englishRelative)
  const englishBasename = basename(englishRelative)
  const chineseBasename = basename(chineseRelative)
  const recordRelative = pair.record ?? join(directory, `${basename(englishRelative, '.md')}.i18n.yaml`)
  const english = await readFile(join(root, englishRelative), 'utf8')
  const chinese = await readFile(join(root, chineseRelative), 'utf8')
  const record = await readFile(join(root, recordRelative), 'utf8')
  const switcherLine = english.startsWith('# Agent Note: ') ? 4 : 2
  if (pair.primary === 'zh') {
    // The Chinese page is the front page; its switcher still links the English copy.
    assert.equal(chinese.split('\n')[switcherLine], `[English](${englishBasename}) | 中文`, `${chineseRelative} switcher`)
    assert.equal(english.split('\n')[switcherLine], `English | [中文](${chineseBasename})`, `${englishRelative} switcher`)
  } else {
    assert.equal(english.split('\n')[switcherLine], `English | [中文](${chineseBasename})`, `${englishRelative} switcher`)
    assert.equal(chinese.split('\n')[switcherLine], `[English](${englishBasename}) | 中文`, `${chineseRelative} switcher`)
  }
  assert.deepEqual(structure(chinese), structure(english), `${englishRelative} structural signature`)
  const expected = [
    `${englishBasename}: ${blobHash(english)}`,
    `${chineseBasename}: ${blobHash(chinese)}`,
    '',
  ].join('\n')
  assert.equal(record, expected, `${recordRelative} hashes`)
}

console.log(`document pairs: ${pairs.map(pair => relative(root, join(root, pair.primary === 'zh' ? pair.chinese : pair.english))).join(', ')} passed`)
