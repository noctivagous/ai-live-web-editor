import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dayFile } from '../../serverLog.js'
import { setFsRoot } from '../../launcher.js'

/* Tool calls append to logs/ — isolate the log home per test so the
 * suite never touches the repo's real logs. */
let logHome = ''
let savedLogHome: string | undefined
beforeEach(() => {
  logHome = fs.mkdtempSync(path.join(os.tmpdir(), 'realfs-log-test-'))
  savedLogHome = process.env.AI_LIVE_LOG_DIR
  process.env.AI_LIVE_LOG_DIR = logHome
})
afterEach(() => {
  if (savedLogHome === undefined) delete process.env.AI_LIVE_LOG_DIR
  else process.env.AI_LIVE_LOG_DIR = savedLogHome
  fs.rmSync(logHome, { recursive: true, force: true })
})
function loggedRows(): Record<string, unknown>[] {
  const file = dayFile(logHome)
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf-8').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>)
}
import { deleteFileTool, grepTool, LIST_FILES_CAP, listRealFilesTool, makeDirTool, readRealFileTool, renameFileTool, strReplaceTool, writeRealFileTool } from './realFsTools.js'

/**
 * The file tools' execute() paths, exercised directly (basics audit
 * slice 1). Before the shared resolver, a relative write path silently
 * landed in a hidden dot-folder while reporting ok:true — these tests
 * pin the fixed behaviour: every path form lands in the same place,
 * results carry the canonical path, and escapes are error values.
 */

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'realfs-tools-test-'))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src', 'App.jsx'), 'export default () => <div>hi</div>\n')
  setFsRoot(root)
  return root
}

const run = (tool: unknown, input: unknown) =>
  (tool as { execute: (i: unknown, c: unknown) => Promise<Record<string, unknown>> }).execute(input, {})

describe('write-real-file path forms', () => {
  it('writes a relative path into the project, not a hidden dot-folder', async () => {
    const root = tmpProject()
    try {
      const r = await run(writeRealFileTool, { path: 'src/components/Badge.jsx', content: 'export const B = 1\n' })
      assert.equal(r.ok, true)
      assert.equal(r.path, '/src/components/Badge.jsx')
      assert.equal(r.created, true)
      assert.equal(fs.readFileSync(path.join(root, 'src', 'components', 'Badge.jsx'), 'utf-8'), 'export const B = 1\n')
      assert.equal(fs.existsSync(path.join(root, '.src')), false)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('reports created:false on overwrite and accepts ./ and leading-slash forms', async () => {
    const root = tmpProject()
    try {
      const first = await run(writeRealFileTool, { path: './notes.txt', content: 'one' })
      assert.equal(first.created, true)
      assert.equal(first.path, '/notes.txt')
      const second = await run(writeRealFileTool, { path: '/notes.txt', content: 'two' })
      assert.equal(second.ok, true)
      assert.equal(second.created, false)
      assert.equal(fs.readFileSync(path.join(root, 'notes.txt'), 'utf-8'), 'two')
      assert.equal(fs.existsSync(path.join(root, '.notes.txt')), false)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('refuses an escaping path as an error value and writes nothing', async () => {
    const root = tmpProject()
    try {
      const r = await run(writeRealFileTool, { path: '../escape-marker.txt', content: 'x' })
      assert.match(String(r.error), /escapes the project root/)
      assert.equal(fs.existsSync(path.join(root, '..', 'escape-marker.txt')), false)
      assert.equal(fs.existsSync(path.join(root, '...')), false)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('refuses to write onto a directory instead of throwing', async () => {
    const root = tmpProject()
    try {
      const r = await run(writeRealFileTool, { path: '/src', content: 'x' })
      assert.match(String(r.error), /Is a directory/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})

describe('delete-file / rename-file / make-dir (slice 2)', () => {
  it('make-dir creates nested folders and refuses an existing path', async () => {
    const root = tmpProject()
    try {
      const made = await run(makeDirTool, { path: 'src/features/auth' })
      assert.equal(made.ok, true)
      assert.equal(made.path, '/src/features/auth')
      assert.equal(fs.statSync(path.join(root, 'src', 'features', 'auth')).isDirectory(), true)
      const again = await run(makeDirTool, { path: '/src/features/auth' })
      assert.match(String(again.error), /already exists/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('rename-file moves a file across folders and refuses an existing target', async () => {
    const root = tmpProject()
    try {
      const moved = await run(renameFileTool, { from: 'src/App.jsx', to: 'src/ui/App.jsx' })
      assert.equal(moved.ok, true)
      assert.equal(moved.from, '/src/App.jsx')
      assert.equal(moved.to, '/src/ui/App.jsx')
      assert.equal(fs.existsSync(path.join(root, 'src', 'ui', 'App.jsx')), true)
      assert.equal(fs.existsSync(path.join(root, 'src', 'App.jsx')), false)
      const clash = await run(renameFileTool, { from: '/src/ui/App.jsx', to: '/src/ui/App.jsx' })
      assert.match(String(clash.error), /same path/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('delete-file removes a file; folders need recursive and say so', async () => {
    const root = tmpProject()
    try {
      fs.mkdirSync(path.join(root, 'src', 'old'), { recursive: true })
      fs.writeFileSync(path.join(root, 'src', 'old', 'x.js'), 'x')
      const refused = await run(deleteFileTool, { path: 'src/old' })
      assert.match(String(refused.error), /not empty \(1 entries\)/)
      assert.equal(fs.existsSync(path.join(root, 'src', 'old', 'x.js')), true)
      const gone = await run(deleteFileTool, { path: '/src/old', recursive: true })
      assert.equal(gone.ok, true)
      assert.equal(gone.isDir, true)
      assert.equal(fs.existsSync(path.join(root, 'src', 'old')), false)
      const file = await run(deleteFileTool, { path: '/src/App.jsx' })
      assert.equal(file.ok, true)
      assert.equal(file.isDir, false)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('refuses the project root and escaping paths as error values', async () => {
    const root = tmpProject()
    try {
      const rootDel = await run(deleteFileTool, { path: '/', recursive: true })
      assert.match(String(rootDel.error), /project root/)
      const escape = await run(deleteFileTool, { path: '../outside.txt' })
      assert.match(String(escape.error), /escapes the project root/)
      const missing = await run(deleteFileTool, { path: '/nope.txt' })
      assert.match(String(missing.error), /Not found/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})

describe('list / grep hygiene (slice 4)', () => {
  it('list-real-files skips dot-directories but keeps dot-files', async () => {
    const root = tmpProject()
    try {
      fs.mkdirSync(path.join(root, '.git', 'objects'), { recursive: true })
      fs.writeFileSync(path.join(root, '.git', 'objects', 'blob'), 'UNIQUETOKEN')
      fs.mkdirSync(path.join(root, '.ai-live'), { recursive: true })
      fs.writeFileSync(path.join(root, '.ai-live', 'map.json'), '{"token":"UNIQUETOKEN"}')
      fs.mkdirSync(path.join(root, '.hidden'), { recursive: true })
      fs.writeFileSync(path.join(root, '.hidden', 'secret.js'), 'UNIQUETOKEN')
      fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n')
      const r = await run(listRealFilesTool, {})
      const files = r.files as string[]
      assert.ok(files.includes('/src/App.jsx'))
      assert.ok(files.includes('/.gitignore'))
      assert.equal(files.some((f) => f.startsWith('/.git/') || f.startsWith('/.ai-live/') || f.startsWith('/.hidden/')), false)
      assert.equal(r.truncated, false)
      assert.equal(r.totalFiles, files.length)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('grep never searches dot-directories', async () => {
    const root = tmpProject()
    try {
      fs.mkdirSync(path.join(root, '.ai-live'), { recursive: true })
      fs.writeFileSync(path.join(root, '.ai-live', 'map.json'), 'UNIQUETOKEN')
      const r = await run(grepTool, { pattern: 'UNIQUETOKEN' })
      assert.equal(r.count, 0)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('list-real-files caps its output and says so', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'realfs-list-cap-'))
    setFsRoot(root)
    try {
      for (let i = 0; i < LIST_FILES_CAP + 3; i++) {
        fs.writeFileSync(path.join(root, `f${String(i).padStart(4, '0')}.txt`), '')
      }
      const r = await run(listRealFilesTool, {})
      assert.equal((r.files as string[]).length, LIST_FILES_CAP)
      assert.equal(r.totalFiles, LIST_FILES_CAP + 3)
      assert.equal(r.truncated, true)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})

describe('read / str-replace / grep path forms', () => {
  it('reads and edits via relative paths, returning the canonical path', async () => {
    const root = tmpProject()
    try {
      const read = await run(readRealFileTool, { path: 'src/App.jsx' })
      assert.equal(read.path, '/src/App.jsx')
      assert.match(String(read.content ?? read.text ?? ''), /hi/)
      const edit = await run(strReplaceTool, { path: './src/App.jsx', old_string: 'hi', new_string: 'hello' })
      assert.equal(edit.ok, true)
      assert.equal(edit.path, '/src/App.jsx')
      assert.match(fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf-8'), /hello/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('refuses binary files instead of returning garbled text (slice 5b)', async () => {
    const root = tmpProject()
    try {
      fs.writeFileSync(path.join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]))
      const r = await run(readRealFileTool, { path: '/logo.png' })
      assert.match(String(r.error), /Binary file: \/logo\.png/)
      assert.equal(r.content, undefined)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('returns readable error values for missing and escaping paths', async () => {
    const root = tmpProject()
    try {
      const missing = await run(readRealFileTool, { path: 'nope.txt' })
      assert.equal(missing.error, 'Not found: /nope.txt')
      const escape = await run(readRealFileTool, { path: '../secret.txt' })
      assert.match(String(escape.error), /escapes the project root/)
      const dirRead = await run(readRealFileTool, { path: '/src' })
      assert.match(String(dirRead.error), /Is a directory/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('greps under a relative directory path', async () => {
    const root = tmpProject()
    try {
      const r = await run(grepTool, { pattern: 'div', path: 'src' })
      assert.equal(r.count, 1)
      const bad = await run(grepTool, { pattern: 'div', path: '../' })
      assert.match(String(bad.error), /escapes the project root/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})

describe('str-replace line facts (failure report)', () => {
  it('a miss returns the file’s actual line count with matches:0', async () => {
    const root = tmpProject()
    try {
      fs.writeFileSync(path.join(root, 'src', 'App.jsx'), 'line1\nline2\nline3\n')
      const miss = await run(strReplaceTool, { path: '/src/App.jsx', old_string: 'nope-not-here', new_string: 'x' })
      assert.match(String(miss.error), /old_string not found/)
      assert.equal(miss.matches, 0)
      assert.equal(miss.fileLines, 3)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('a hit returns the applied 1-based line range', async () => {
    const root = tmpProject()
    try {
      fs.writeFileSync(path.join(root, 'src', 'App.jsx'), 'line1\nline2\nline3\n')
      const hit = await run(strReplaceTool, { path: '/src/App.jsx', old_string: 'line2', new_string: 'LINE2\nLINE2b' })
      assert.equal(hit.ok, true)
      assert.deepEqual(hit.range, [2, 3])
      assert.equal(hit.fileLines, 4)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })

  it('logs every call with tool, path, line facts and outcome', async () => {
    const root = tmpProject()
    try {
      fs.writeFileSync(path.join(root, 'src', 'App.jsx'), 'line1\nline2\nline3\n')
      await run(strReplaceTool, { path: '/src/App.jsx', old_string: 'nope', new_string: 'x' })
      const rows = loggedRows()
      assert.equal(rows.length, 1)
      assert.equal(rows[0].kind, 'tool-call')
      assert.equal(rows[0].tool, 'str-replace')
      assert.equal(rows[0].path, '/src/App.jsx')
      assert.equal(rows[0].ok, false)
      assert.equal(rows[0].matches, 0)
      assert.equal(rows[0].fileLines, 3)
      assert.match(String(rows[0].error), /old_string not found/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})
