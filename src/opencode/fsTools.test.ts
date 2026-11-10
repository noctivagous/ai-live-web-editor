/**
 * Parity for the OpenCode fs tool ports (slice 5, wave 4 group B):
 * the ported host functions in ./fsTools.ts must BE the Mastra fs
 * tools' execute results — same inputs over twin seeded roots,
 * same outputs, same bytes on disk afterwards. This family is the
 * migration's sharpest parity surface: str-replace miss windows,
 * placeholder refusal, grep's null-path rule and the
 * run-project-check tails are all tuned product behavior.
 *
 * Two normalizations, both about the harness rather than the
 * tools: readdir order is not guaranteed identical across two
 * tmp roots, so list-real-files' list and grep's hit list are
 * compared order-insensitively (contents fully compared); the
 * root path itself is scrubbed to ROOT.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { setFsRoot } from '../launcher.js'
import {
  deleteFileTool, grepTool, listRealFilesTool, makeDirTool, readRealFileTool,
  renameFileTool, runProjectCheckTool, strReplaceTool, writeRealFileTool,
} from '../mastra/tools/realFsTools.js'
import { runFsTool } from './fsTools.js'

const runMastra = (tool: unknown, input: unknown) =>
  (tool as { execute: (i: unknown, c: unknown) => Promise<any> }).execute(input, {})

const MASTRA_FS: Record<string, unknown> = {
  'list-real-files': listRealFilesTool,
  'grep': grepTool,
  'read-real-file': readRealFileTool,
  'str-replace': strReplaceTool,
  'write-real-file': writeRealFileTool,
  'delete-file': deleteFileTool,
  'rename-file': renameFileTool,
  'make-dir': makeDirTool,
  'run-project-check': runProjectCheckTool,
}

const roots: string[] = []
function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-oc-fs-'))
  roots.push(root)
  const w = (rel: string, content: string | Buffer) => {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  w('src/a.txt', 'alpha\nbeta\ngamma\n')
  w('src/code.ts', 'export const x = 1\nexport const y = 2\n')
  w('dup.txt', 'same\nsame\nother\n')
  w('bin.dat', Buffer.from([0x41, 0x00, 0x42]))
  w('package.json', JSON.stringify({ name: 'parity', scripts: {} }, null, 2) + '\n')
  return root
}

after(() => {
  setFsRoot('')
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true })
})

function scrub(value: unknown, root: string): unknown {
  if (typeof value === 'string') return value.split(root).join('ROOT')
  if (Array.isArray(value)) return value.map((v) => scrub(v, root))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, root)]))
  }
  return value
}

function treeOf(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else out[path.relative(root, full)] = fs.readFileSync(full).toString('base64')
    }
  }
  walk(root)
  return out
}

const STEPS: Array<{ tool: string; input: Record<string, unknown>; sortList?: boolean; sortHits?: boolean }> = [
  { tool: 'list-real-files', input: {}, sortList: true },
  { tool: 'read-real-file', input: { path: '/src/a.txt' } },
  { tool: 'read-real-file', input: { path: '/src/a.txt', offset: 2, limit: 1 } },
  { tool: 'read-real-file', input: { path: '/missing.txt' } },
  { tool: 'read-real-file', input: { path: '/bin.dat' } },
  { tool: 'read-real-file', input: { path: '/src' } },
  { tool: 'grep', input: { pattern: 'export const' }, sortHits: true },
  { tool: 'grep', input: { pattern: 'ALPHA', caseInsensitive: true }, sortHits: true },
  { tool: 'grep', input: { pattern: '(' } },
  { tool: 'grep', input: { pattern: 'beta', path: 'null' }, sortHits: true },
  { tool: 'grep', input: { pattern: 'beta', path: '/gone' } },
  { tool: 'str-replace', input: { path: '/src/code.ts', old_string: 'export const y = 2', new_string: 'export const y = 3' } },
  { tool: 'str-replace', input: { path: '/src/code.ts', old_string: 'export const zzz', new_string: 'q' } },
  { tool: 'str-replace', input: { path: '/dup.txt', old_string: 'same', new_string: 'once' } },
  { tool: 'str-replace', input: { path: '/dup.txt', old_string: 'same', new_string: 'both', replace_all: true } },
  { tool: 'str-replace', input: { path: '/gone.txt', old_string: 'a', new_string: 'b' } },
  { tool: 'write-real-file', input: { path: '/new/deep/file.txt', content: 'hello\n' } },
  { tool: 'write-real-file', input: { path: '/src/a.txt', content: '[original content]' } },
  { tool: 'write-real-file', input: { path: '/src', content: 'x' } },
  { tool: 'rename-file', input: { from: '/new/deep/file.txt', to: '/new/moved.txt' } },
  { tool: 'rename-file', input: { from: '/new/moved.txt', to: '/src/a.txt' } },
  { tool: 'make-dir', input: { path: '/made/nested' } },
  { tool: 'delete-file', input: { path: '/new/moved.txt' } },
  { tool: 'delete-file', input: { path: '/new' } },
  { tool: 'delete-file', input: { path: '/new', recursive: true } },
  { tool: 'run-project-check', input: {} },
  { tool: 'write-real-file', input: { path: '/package.json', content: JSON.stringify({ name: 'parity', scripts: { build: 'node -e "console.log(123)"' } }) } },
  { tool: 'run-project-check', input: {} },
]

describe('opencode fs tools — parity with the Mastra originals', () => {
  it('the scripted sequence deepEquals step for step, and the final trees are byte-identical', async () => {
    const obsA: unknown[] = []
    const obsB: unknown[] = []
    const rootA = makeRoot()
    const rootB = makeRoot()
    for (const step of STEPS) {
      setFsRoot(rootA)
      obsA.push(await runMastra(MASTRA_FS[step.tool], step.input))
      setFsRoot(rootB)
      obsB.push(await runFsTool(step.tool, step.input))
    }
    STEPS.forEach((step, i) => {
      let a = scrub(obsA[i], rootA) as Record<string, unknown>
      let b = scrub(obsB[i], rootB) as Record<string, unknown>
      if (step.sortList) {
        a = { ...a, files: [...(a.files as string[])].sort() }
        b = { ...b, files: [...(b.files as string[])].sort() }
      }
      if (step.sortHits) {
        const byHit = (x: { path: string; line: number }, y: { path: string; line: number }) =>
          x.path === y.path ? x.line - y.line : x.path < y.path ? -1 : 1
        a = { ...a, hits: [...(a.hits as never[])].sort(byHit) }
        b = { ...b, hits: [...(b.hits as never[])].sort(byHit) }
      }
      assert.deepEqual(b, a, `step ${i}: ${step.tool} ${JSON.stringify(step.input)}`)
    })
    assert.deepEqual(treeOf(rootB), treeOf(rootA), 'final trees differ')
  })

  it('unknown tool names are an error value naming the full set', async () => {
    const r = (await runFsTool('nope', {})) as { ok: boolean; error: string }
    assert.equal(r.ok, false)
    assert.match(r.error, /unknown fs tool "nope"/)
    assert.match(r.error, /str-replace/)
  })
})
