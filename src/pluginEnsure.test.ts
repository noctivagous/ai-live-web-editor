import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildEnsuredSource,
  classifyConfigSource,
  createdConfigSource,
  detectPlugin,
  EDITOR_ROOT,
  enableProjectPlugin,
  ensureProjectPlugin,
  ensureSnippet,
  getEnsureState,
  isCreatedConfigSkeleton,
  MARK_BEGIN,
  PLUGIN_FILE,
  pluginImportPath,
  removeProjectPlugin,
  stripEnsuredSource,
} from './pluginEnsure.js'

/**
 * Plugin auto-ensure (slice 1): the safety bar is the feature —
 * conservative detection, anchored minimal edits, byte-exact round
 * trips, and NO edit when classification is uncertain. These tests
 * pin that matrix over fixture config shapes.
 */

const REL_SPEC = '../../src/vite-plugin/aiLiveEditor.ts'

function snippetFor(dir: string) {
  return ensureSnippet(dir, { apiBase: 'http://localhost:4112', envFile: '/editor/.env' })
}

/* ── Import path ─────────────────────────────────────────────── */

describe('pluginImportPath', () => {
  it('uses the seed-style relative path inside the editor repo', () => {
    assert.equal(
      pluginImportPath(path.join(EDITOR_ROOT, 'projects', 'demo')),
      '../../src/vite-plugin/aiLiveEditor.ts',
    )
    assert.equal(
      pluginImportPath(path.join(EDITOR_ROOT, 'projects')),
      '../src/vite-plugin/aiLiveEditor.ts',
    )
  })

  it('uses the absolute path for projects outside the repo', () => {
    const p = pluginImportPath('/tmp/somewhere/else')
    assert.equal(p, PLUGIN_FILE.split(path.sep).join('/'))
    assert.ok(p.startsWith('/'))
  })
})

/* ── Classification ──────────────────────────────────────────── */

const REGISTERED = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { aiLiveEditor } from '${REL_SPEC}'
export default defineConfig({
  plugins: [react(), aiLiveEditor({ envFile: '/x/.env', apiBase: 'http://localhost:4112' })],
})
`

describe('classifyConfigSource', () => {
  it('recognizes a registered plugin (seed shape)', () => {
    assert.equal(classifyConfigSource(REGISTERED).cls, 'registered')
  })

  it('recognizes registration with different arguments', () => {
    const src = REGISTERED.replace("aiLiveEditor({ envFile: '/x/.env', apiBase: 'http://localhost:4112' })", 'aiLiveEditor()')
    assert.equal(classifyConfigSource(src).cls, 'registered')
  })

  it('follows a renamed import to its call', () => {
    const src = REGISTERED
      .replace('import { aiLiveEditor }', 'import { aiLiveEditor as live }')
      .replace('aiLiveEditor({ envFile', 'live({ envFile')
    const c = classifyConfigSource(src)
    assert.equal(c.cls, 'registered')
    assert.equal(c.binding, 'live')
  })

  it('reports imported-but-never-called honestly', () => {
    const src = REGISTERED.replace(", aiLiveEditor({ envFile: '/x/.env', apiBase: 'http://localhost:4112' })", '')
    assert.equal(classifyConfigSource(src).cls, 'present-not-called')
  })

  it('treats an import from an unrecognized source as cannot', () => {
    const src = REGISTERED.replace(REL_SPEC, 'ai-live-editor')
    assert.equal(classifyConfigSource(src).cls, 'cannot')
  })

  it('treats a call with no import as cannot', () => {
    const src = `import { defineConfig } from 'vite'
export default defineConfig({ plugins: [aiLiveEditor()] })
`
    assert.equal(classifyConfigSource(src).cls, 'cannot')
  })

  it('treats a bare mention (comment) as cannot, never missing', () => {
    const src = `import { defineConfig } from 'vite'
// aiLiveEditor was removed by hand
export default defineConfig({ plugins: [] })
`
    assert.equal(classifyConfigSource(src).cls, 'cannot')
  })

  it('classifies the editable shapes as missing', () => {
    const shapes = [
      // defineConfig with a plugins array
      `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nexport default defineConfig({\n  plugins: [react()],\n})\n`,
      // defineConfig without plugins
      `import { defineConfig } from 'vite'\nexport default defineConfig({\n  server: { port: 3000 },\n})\n`,
      // plain object export
      `export default {\n  plugins: [],\n}\n`,
      // TS-flavoured config
      `import { defineConfig } from 'vite'\nimport type { Plugin } from 'vite'\nconst extra: Plugin[] = []\nexport default defineConfig({\n  plugins: [...extra],\n})\n`,
      // module.exports (CJS)
      `const { defineConfig } = require('vite')\nmodule.exports = defineConfig({\n  plugins: [],\n})\n`,
    ]
    for (const src of shapes) assert.equal(classifyConfigSource(src).cls, 'missing', src)
  })

  it('refuses function configs and indirect shapes as cannot', () => {
    const shapes = [
      `import { defineConfig } from 'vite'\nexport default defineConfig(() => ({ plugins: [] }))\n`,
      `import { defineConfig } from 'vite'\nexport default defineConfig(({ mode }) => ({ plugins: [] }))\n`,
      `const config = { plugins: [] }\nexport default config\n`,
      `import { defineConfig } from 'vite'\nconst base = {}\nexport default defineConfig({ ...base, plugins: [] })\n`,
      `import { defineConfig } from 'vite'\nexport default defineConfig({ plugins: sharedPlugins })\n`,
      `const x = 1\n`,
    ]
    for (const src of shapes) assert.equal(classifyConfigSource(src).cls, 'cannot', src)
  })

  it('recognizes a CJS registration', () => {
    const src = `const { aiLiveEditor } = require('/abs/src/vite-plugin/aiLiveEditor.ts')
module.exports = { plugins: [aiLiveEditor({})] }
`
    assert.equal(classifyConfigSource(src).cls, 'registered')
  })
})

/* ── Edit + strip round trips ────────────────────────────────── */

const EDITABLE_SHAPES: Array<[string, string]> = [
  ['defineConfig with plugins', `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({\n  plugins: [react()],\n})\n`],
  ['formatted plugins array', `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({\n  plugins: [\n    react(),\n  ],\n  server: { port: 5173 },\n})\n`],
  ['defineConfig without plugins', `import { defineConfig } from 'vite'\n\nexport default defineConfig({\n  server: { port: 3000 },\n})\n`],
  ['plain object export', `export default {\n  plugins: [],\n}\n`],
  ['one-line config', `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nexport default defineConfig({ plugins: [react()] })\n`],
  ['empty plugins on one line', `import { defineConfig } from 'vite'\nexport default defineConfig({ plugins: [] })\n`],
  ['no imports at all', `export default {\n  plugins: [],\n}\n`],
]

describe('buildEnsuredSource / stripEnsuredSource', () => {
  for (const [name, src] of EDITABLE_SHAPES) {
    it(`round-trips byte-for-byte: ${name}`, () => {
      const snippet = snippetFor(path.join(EDITOR_ROOT, 'projects', 'demo'))
      const out = buildEnsuredSource(src, snippet)
      assert.ok(out, 'edit produced output')
      assert.ok(out.includes(MARK_BEGIN), 'markers present')
      assert.ok(out.includes(`from '${REL_SPEC}'`), 'relative import used')
      assert.equal(classifyConfigSource(out).cls, 'registered')
      const stripped = stripEnsuredSource(out)
      assert.equal(stripped.removed, true)
      assert.equal(stripped.source, src)
    })
  }

  it('round-trips a CRLF config', () => {
    const src = "import { defineConfig } from 'vite'\r\n\r\nexport default defineConfig({\r\n  plugins: [],\r\n})\r\n"
    const out = buildEnsuredSource(src, snippetFor(path.join(EDITOR_ROOT, 'projects', 'demo')))
    assert.ok(out)
    assert.equal(classifyConfigSource(out).cls, 'registered')
    assert.equal(stripEnsuredSource(out).source, src)
  })

  it('strip refuses damaged or unpaired markers', () => {
    const out = buildEnsuredSource(EDITABLE_SHAPES[0][1], snippetFor(path.join(EDITOR_ROOT, 'projects', 'demo'))) as string
    const damaged = out.split('\n').filter(l => !l.includes('end plugin')).join('\n')
    assert.equal(stripEnsuredSource(damaged).removed, false)
    assert.equal(stripEnsuredSource(EDITABLE_SHAPES[0][1]).removed, false)
  })

  it('the created config classifies registered and strips to its skeleton', () => {
    const created = createdConfigSource(snippetFor('/tmp/outside'))
    assert.equal(classifyConfigSource(created).cls, 'registered')
    const stripped = stripEnsuredSource(created)
    assert.equal(stripped.removed, true)
    assert.equal(isCreatedConfigSkeleton(stripped.source), true)
  })
})

/* ── Detection + ensure on disk ──────────────────────────────── */

function tmpProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-test-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content, 'utf-8')
  }
  return dir
}

const PKG = JSON.stringify({
  name: 'fixture',
  scripts: { dev: 'vite --port 5173' },
  devDependencies: { vite: '^5.0.0' },
})

function optsFor(dir: string) {
  return { stateFile: path.join(dir, '.state', 'plugin-ensure.json'), apiBase: 'http://localhost:4112', envFile: '/editor/.env' }
}

describe('detectPlugin', () => {
  it('classifies folders by package and config', () => {
    const bare = tmpProject({})
    try {
      assert.equal(detectPlugin(bare).cls, 'not-vite')
      const noVite = tmpProject({ 'package.json': JSON.stringify({ name: 'x' }) })
      try {
        assert.equal(detectPlugin(noVite).cls, 'not-vite')
        const noConfig = tmpProject({ 'package.json': PKG })
        try {
          assert.equal(detectPlugin(noConfig).cls, 'no-config')
          const missing = tmpProject({ 'package.json': PKG, 'vite.config.ts': EDITABLE_SHAPES[0][1] })
          try {
            assert.equal(detectPlugin(missing).cls, 'missing')
            const done = tmpProject({ 'package.json': PKG, 'vite.config.js': REGISTERED })
            try { assert.equal(detectPlugin(done).cls, 'registered') } finally { fs.rmSync(done, { recursive: true, force: true }) }
          } finally { fs.rmSync(missing, { recursive: true, force: true }) }
        } finally { fs.rmSync(noConfig, { recursive: true, force: true }) }
      } finally { fs.rmSync(noVite, { recursive: true, force: true }) }
    } finally { fs.rmSync(bare, { recursive: true, force: true }) }
  })

  it('follows vite config precedence (js before ts)', () => {
    const dir = tmpProject({
      'package.json': PKG,
      'vite.config.js': REGISTERED,
      'vite.config.ts': EDITABLE_SHAPES[0][1],
    })
    try {
      const det = detectPlugin(dir)
      assert.equal(det.cls, 'registered')
      assert.ok(det.configFile?.endsWith('vite.config.js'))
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('ensureProjectPlugin / removeProjectPlugin / enableProjectPlugin', () => {
  it('adds the marked registration, idempotently; removal restores the file and opts out', () => {
    const original = EDITABLE_SHAPES[1][1]
    const dir = tmpProject({ 'package.json': PKG, 'vite.config.js': original })
    const opts = optsFor(dir)
    try {
      const added = ensureProjectPlugin(dir, opts)
      assert.equal(added.state, 'added')
      assert.equal(added.configFile, 'vite.config.js')
      const edited = fs.readFileSync(path.join(dir, 'vite.config.js'), 'utf-8')
      assert.ok(edited.includes(MARK_BEGIN))
      // A tmp project lives outside the repo → absolute import path.
      assert.ok(edited.includes(`from '${PLUGIN_FILE.split(path.sep).join('/')}'`))
      assert.equal(classifyConfigSource(edited).cls, 'registered')

      const again = ensureProjectPlugin(dir, opts)
      assert.equal(again.state, 'registered')
      assert.equal(fs.readFileSync(path.join(dir, 'vite.config.js'), 'utf-8'), edited, 'second ensure changed nothing')

      const removed = removeProjectPlugin(dir, opts)
      assert.equal(removed.ok, true)
      assert.equal(removed.changed, true)
      assert.equal(fs.readFileSync(path.join(dir, 'vite.config.js'), 'utf-8'), original, 'removal restored the original bytes')
      assert.equal(getEnsureState(dir)?.state, 'missing-declined')

      const suppressed = ensureProjectPlugin(dir, opts)
      assert.equal(suppressed.state, 'missing-declined')
      assert.equal(fs.readFileSync(path.join(dir, 'vite.config.js'), 'utf-8'), original, 'opt-out suppressed the re-add')

      const reenabled = enableProjectPlugin(dir, opts)
      assert.equal(reenabled.state, 'added')
      assert.ok(fs.readFileSync(path.join(dir, 'vite.config.js'), 'utf-8').includes(MARK_BEGIN))
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('creates a config for a no-config project and deletes it on removal', () => {
    const dir = tmpProject({ 'package.json': PKG })
    const opts = optsFor(dir)
    try {
      const added = ensureProjectPlugin(dir, opts)
      assert.equal(added.state, 'added')
      const created = path.join(dir, 'vite.config.js')
      assert.ok(fs.existsSync(created))
      assert.equal(classifyConfigSource(fs.readFileSync(created, 'utf-8')).cls, 'registered')
      const removed = removeProjectPlugin(dir, opts)
      assert.equal(removed.ok, true)
      assert.ok(!fs.existsSync(created), 'the created file was deleted, not left as an empty config')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('never touches a hand-written registration', () => {
    const dir = tmpProject({ 'package.json': PKG, 'vite.config.js': REGISTERED })
    const opts = optsFor(dir)
    try {
      assert.equal(ensureProjectPlugin(dir, opts).state, 'registered')
      const removed = removeProjectPlugin(dir, opts)
      assert.equal(removed.ok, false)
      assert.equal(removed.changed, false)
      assert.equal(fs.readFileSync(path.join(dir, 'vite.config.js'), 'utf-8'), REGISTERED)
      // No opt-out was recorded: a later ensure still sees it as registered.
      assert.equal(ensureProjectPlugin(dir, opts).state, 'registered')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('reports cannot (with the manual snippet) and writes nothing for uneditable shapes', () => {
    const fnConfig = `import { defineConfig } from 'vite'\nexport default defineConfig(() => ({ plugins: [] }))\n`
    const dir = tmpProject({ 'package.json': PKG, 'vite.config.js': fnConfig })
    const opts = optsFor(dir)
    try {
      const state = ensureProjectPlugin(dir, opts)
      assert.equal(state.state, 'cannot')
      assert.ok(state.snippet?.includes('aiLiveEditor('))
      assert.equal(fs.readFileSync(path.join(dir, 'vite.config.js'), 'utf-8'), fnConfig)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('reports cannot for imported-but-never-called', () => {
    const src = REGISTERED.replace(", aiLiveEditor({ envFile: '/x/.env', apiBase: 'http://localhost:4112' })", '')
    const dir = tmpProject({ 'package.json': PKG, 'vite.config.js': src })
    try {
      assert.equal(ensureProjectPlugin(dir, optsFor(dir)).state, 'cannot')
      assert.equal(fs.readFileSync(path.join(dir, 'vite.config.js'), 'utf-8'), src)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('classifies package-less folders as standalone (with HTML) or not-vite', () => {
    const withHtml = tmpProject({ 'index.html': '<html><body>hi</body></html>' })
    try {
      assert.equal(ensureProjectPlugin(withHtml, optsFor(withHtml)).state, 'standalone')
      const empty = tmpProject({})
      try { assert.equal(ensureProjectPlugin(empty, optsFor(empty)).state, 'not-vite') } finally { fs.rmSync(empty, { recursive: true, force: true }) }
    } finally { fs.rmSync(withHtml, { recursive: true, force: true }) }
  })

  it('never ensures the editor repo itself', () => {
    const before = fs.existsSync(path.join(EDITOR_ROOT, 'vite.config.js'))
      ? fs.readFileSync(path.join(EDITOR_ROOT, 'vite.config.js'), 'utf-8')
      : null
    const state = ensureProjectPlugin(EDITOR_ROOT, optsFor(os.tmpdir()))
    assert.equal(state.state, 'registered')
    const after = fs.existsSync(path.join(EDITOR_ROOT, 'vite.config.js'))
      ? fs.readFileSync(path.join(EDITOR_ROOT, 'vite.config.js'), 'utf-8')
      : null
    assert.equal(after, before)
  })
})
