import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
// The plugin asset is plain JS loaded by the OpenCode server (Bun);
// importing it here exercises the exact file the server will load.
import plugin from './ale-plugin/index.js'

interface AddedTool {
  name: string
  description: string
  input: Record<string, unknown>
  options?: Record<string, unknown>
  execute: (input: Record<string, unknown>, context: unknown) => Promise<{ content: string }>
}

async function setupWith(hostUrl: string): Promise<AddedTool[]> {
  const added: AddedTool[] = []
  const ctx = {
    options: { hostUrl },
    tool: {
      transform: async (cb: (editor: { add: (t: AddedTool) => void; namespace: () => void }) => void) => {
        cb({ add: (t) => added.push(t), namespace: () => {} })
      },
    },
  }
  await plugin.setup(ctx)
  return added
}

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const WAVE1 = [
  'take-snapshot', 'inspect-dom', 'page-sections', 'layout-snapshot', 'layout-svg',
  'patch-dom', 'eval-js', 'run-in-page', 'pool-open',
]

const WAVE2 = ['get-network-failures', 'resolve-source']

const WAVE3 = [
  'feature-add-node', 'feature-set-status', 'feature-link', 'feature-install-pack',
  'feature-query', 'feature-set-param', 'feature-build-node', 'feature-edit-node',
  'feature-remove-node', 'feature-unlink', 'feature-lint', 'feature-uninstall-pack',
  'feature-reconcile',
  'userflow-add-step', 'userflow-set-verification', 'userflow-link',
  'userflow-derive-suggestions', 'userflow-query',
]

const WAVE4A = [
  'plan-add-question', 'plan-remove-question', 'plan-revise-question', 'plan-from-graph',
  'plan-update-task', 'plan-finish',
  'read-skill', 'run-skill-checks',
  'find-component', 'codebase-map', 'adopt-registry', 'install-catalog-component', 'place-template',
  'runtime-state-scan', 'runtime-state-set',
  'unpack-code', 'read-symbol',
]

const WAVE4B_CONTENT = [
  'spreadsheet-inspect', 'spreadsheet-find', 'spreadsheet-set-cell', 'spreadsheet-add-row',
  'data-inspect', 'data-get', 'data-set', 'data-find', 'data-add', 'data-remove',
  'doc-inspect', 'doc-get', 'doc-find', 'doc-set-text', 'doc-set-item', 'doc-set-style',
  'doc-add-block', 'doc-remove-block',
]

const WAVE4B_WEB = ['web-search', 'fetch-page', 'research']

const WAVE4B_FS = [
  'list-real-files', 'grep', 'read-real-file', 'str-replace', 'write-real-file',
  'delete-file', 'rename-file', 'make-dir', 'run-project-check',
]

/** The plugin reads the override spawn envs at setup time
 * (ALE_OPENCODE_FS_TOOLS slice 5; ALE_OPENCODE_WEB_TOOLS and
 * ALE_OPENCODE_SKILL_TOOLS slice 8 — the supervisor sets them
 * from the agent settings, all default off). setupWithToggles
 * pins all three explicitly for the registration tests and
 * restores the ambient values after. */
const TOGGLE_ENVS = ['ALE_OPENCODE_FS_TOOLS', 'ALE_OPENCODE_WEB_TOOLS', 'ALE_OPENCODE_SKILL_TOOLS'] as const
const realEnvFlags = Object.fromEntries(TOGGLE_ENVS.map((k) => [k, process.env[k]]))
async function setupWithToggles(
  hostUrl: string,
  toggles: { fs?: boolean; web?: boolean; skill?: boolean },
): Promise<AddedTool[]> {
  const values: Record<string, boolean> = {
    ALE_OPENCODE_FS_TOOLS: toggles.fs === true,
    ALE_OPENCODE_WEB_TOOLS: toggles.web === true,
    ALE_OPENCODE_SKILL_TOOLS: toggles.skill === true,
  }
  for (const k of TOGGLE_ENVS) {
    if (values[k]) process.env[k] = '1'
    else delete process.env[k]
  }
  try {
    return await setupWith(hostUrl)
  } finally {
    for (const k of TOGGLE_ENVS) {
      if (realEnvFlags[k] === undefined) delete process.env[k]
      else process.env[k] = realEnvFlags[k]
    }
  }
}

async function setupWithFs(hostUrl: string, fsOn: boolean): Promise<AddedTool[]> {
  return setupWithToggles(hostUrl, { fs: fsOn })
}

describe('ai-live-editor opencode plugin', () => {
  it('registers the default inventory (65 tools, every override OFF), all direct (non-Code-Mode)', async () => {
    assert.equal(plugin.id, 'ai-live-editor')
    const added = await setupWithToggles('http://127.0.0.1:4112', {})
    assert.deepEqual(added.map((t) => t.name), [
      'get-console', ...WAVE1, ...WAVE2, ...WAVE3,
      ...WAVE4A.filter((n) => n !== 'read-skill'), ...WAVE4B_CONTENT, 'console-expect',
    ])
    assert.equal(added.length, 65)
    assert.ok(added.every((t) => !WAVE4B_FS.includes(t.name)), 'no ALE fs tool is registered by default')
    assert.ok(added.every((t) => !WAVE4B_WEB.includes(t.name)), 'no ALE web tool is registered by default')
    assert.ok(!added.some((t) => t.name === 'read-skill'), 'read-skill is not registered by default')
    assert.ok(added.some((t) => t.name === 'run-skill-checks'), 'run-skill-checks has no native counterpart — it stays')
    for (const tool of added) {
      assert.deepEqual(tool.options, { codemode: false }, tool.name)
      assert.equal((tool.input as { additionalProperties?: boolean }).additionalProperties, false, tool.name)
      assert.ok(tool.description.length > 20, tool.name)
    }
  })

  it('registration counts per override combination (slice 8): groups add exactly their tools', async () => {
    const names = async (toggles: { fs?: boolean; web?: boolean; skill?: boolean }) =>
      (await setupWithToggles('http://127.0.0.1:4112', toggles)).map((t) => t.name)
    const base = await names({})
    assert.equal(base.length, 65)
    const fsOnly = await names({ fs: true })
    assert.equal(fsOnly.length, 74)
    assert.deepEqual(fsOnly.filter((n) => !base.includes(n)), WAVE4B_FS)
    const webOnly = await names({ web: true })
    assert.equal(webOnly.length, 68)
    assert.deepEqual(webOnly.filter((n) => !base.includes(n)), WAVE4B_WEB)
    const skillOnly = await names({ skill: true })
    assert.equal(skillOnly.length, 66)
    assert.deepEqual(skillOnly.filter((n) => !base.includes(n)), ['read-skill'])
    assert.equal((await names({ fs: true, web: true })).length, 77)
    assert.equal((await names({ fs: true, skill: true })).length, 75)
    assert.equal((await names({ web: true, skill: true })).length, 69)
    const all = await names({ fs: true, web: true, skill: true })
    assert.equal(all.length, 78)
    assert.deepEqual(all, [
      'get-console', ...WAVE1, ...WAVE2, ...WAVE3, ...WAVE4A, ...WAVE4B_CONTENT, ...WAVE4B_WEB, ...WAVE4B_FS, 'console-expect',
    ])
  })

  it('wave-1 schemas keep the Mastra originals required fields and key enums', async () => {
    const added = await setupWith('http://127.0.0.1:4112')
    const byName = new Map(added.map((t) => [t.name, t]))
    const required = (n: string) => (byName.get(n)!.input as { required?: string[] }).required ?? []
    assert.deepEqual(required('patch-dom'), ['selector'])
    assert.deepEqual(required('eval-js'), ['code'])
    assert.deepEqual(required('run-in-page'), ['code'])
    assert.deepEqual(required('pool-open'), ['url'])
    assert.deepEqual(required('take-snapshot'), [])
    const patch = byName.get('patch-dom')!.input as { properties: Record<string, { enum?: string[] }> }
    assert.deepEqual(patch.properties.op.enum, ['html', 'text', 'style', 'attr', 'class', 'remove', 'insert', 'move'])
    const layout = byName.get('layout-snapshot')!.input as { properties: Record<string, { enum?: string[] }> }
    assert.deepEqual(layout.properties.computedStylePreset.enum, ['minimal', 'layout', 'standard', 'debug', 'typography', 'paint'])
    const svg = byName.get('layout-svg')!.input as { properties: Record<string, unknown> }
    assert.ok('scale' in svg.properties && 'showOverlaps' in svg.properties)
  })

  it('get-console POSTs to the editor host console endpoint and returns its JSON', async () => {
    const added = await setupWith('http://127.0.0.1:9999')
    let seenUrl = ''
    let seenBody = ''
    globalThis.fetch = (async (url: string, init: { body: string }) => {
      seenUrl = String(url)
      seenBody = init.body
      return { json: async () => ({ via: 'vite-page', entries: [{ level: 'error', text: 'boom' }] }) }
    }) as typeof fetch
    const out = await added[0].execute({ maxEntries: 5 }, {})
    assert.equal(seenUrl, 'http://127.0.0.1:9999/api/page/console')
    assert.deepEqual(JSON.parse(seenBody), { maxEntries: 5 })
    assert.deepEqual(JSON.parse(out.content), { via: 'vite-page', entries: [{ level: 'error', text: 'boom' }] })
  })

  it('reports a dead host as tool content, not a throw', async () => {
    const added = await setupWith('http://127.0.0.1:9999')
    globalThis.fetch = (async () => { throw new Error('connect ECONNREFUSED') }) as typeof fetch
    const out = await added[0].execute({}, {})
    const parsed = JSON.parse(out.content) as { ok: boolean; error: string }
    assert.equal(parsed.ok, false)
    assert.match(parsed.error, /ECONNREFUSED/)
  })

  it('each dispatch tool (wave-1 + wave-2) POSTs {tool, input} to the dispatch endpoint and returns its JSON', async () => {
    const added = await setupWith('http://127.0.0.1:9999')
    for (const tool of added.slice(1, 1 + WAVE1.length + WAVE2.length)) {
      let seenUrl = ''
      let seenBody = ''
      globalThis.fetch = (async (url: string, init: { body: string }) => {
        seenUrl = String(url)
        seenBody = init.body
        return { json: async () => ({ ok: true, marker: tool.name }) }
      }) as typeof fetch
      const out = await tool.execute({ probe: 1 }, {})
      assert.equal(seenUrl, 'http://127.0.0.1:9999/api/page/tool', tool.name)
      assert.deepEqual(JSON.parse(seenBody), { tool: tool.name, input: { probe: 1 } }, tool.name)
      assert.deepEqual(JSON.parse(out.content), { ok: true, marker: tool.name }, tool.name)
    }
  })

  it('each wave-3 graph tool POSTs {tool, input} to the graph dispatch endpoint and returns its JSON', async () => {
    const added = await setupWith('http://127.0.0.1:9999')
    const graphTools = added.filter((t) => WAVE3.includes(t.name))
    assert.equal(graphTools.length, 18)
    for (const tool of graphTools) {
      let seenUrl = ''
      let seenBody = ''
      globalThis.fetch = (async (url: string, init: { body: string }) => {
        seenUrl = String(url)
        seenBody = init.body
        return { json: async () => ({ ok: true, marker: tool.name }) }
      }) as typeof fetch
      const out = await tool.execute({ probe: 1 }, {})
      assert.equal(seenUrl, 'http://127.0.0.1:9999/api/graph/tool', tool.name)
      assert.deepEqual(JSON.parse(seenBody), { tool: tool.name, input: { probe: 1 } }, tool.name)
      assert.deepEqual(JSON.parse(out.content), { ok: true, marker: tool.name }, tool.name)
    }
  })

  it('wave-3 schemas mirror the Mastra originals (required fields, enums, nullable parentId)', async () => {
    const added = await setupWith('http://127.0.0.1:4112')
    const byName = new Map(added.map((t) => [t.name, t]))
    const required = (n: string) => (byName.get(n)!.input as { required?: string[] }).required ?? []
    assert.deepEqual(required('feature-add-node'), ['name', 'kind'])
    assert.deepEqual(required('feature-set-status'), ['id', 'status'])
    assert.deepEqual(required('feature-link'), ['from', 'to', 'type'])
    assert.deepEqual(required('feature-install-pack'), ['packId'])
    assert.deepEqual(required('feature-query'), ['mode'])
    assert.deepEqual(required('feature-set-param'), ['id', 'name', 'value'])
    assert.deepEqual(required('feature-build-node'), ['id'])
    assert.deepEqual(required('feature-edit-node'), ['id'])
    assert.deepEqual(required('feature-remove-node'), ['id'])
    assert.deepEqual(required('feature-unlink'), ['from', 'to', 'type'])
    assert.deepEqual(required('feature-lint'), [])
    assert.deepEqual(required('feature-uninstall-pack'), ['packId'])
    assert.deepEqual(required('feature-reconcile'), [])
    assert.deepEqual(required('userflow-add-step'), ['journey', 'name', 'type'])
    assert.deepEqual(required('userflow-set-verification'), ['id', 'state'])
    assert.deepEqual(required('userflow-link'), ['from', 'to', 'type'])
    assert.deepEqual(required('userflow-derive-suggestions'), [])
    assert.deepEqual(required('userflow-query'), ['mode'])
    const add = byName.get('feature-add-node')!.input as { properties: Record<string, { enum?: string[] }> }
    assert.deepEqual(add.properties.kind.enum, ['region', 'feature', 'screen', 'component', 'setting', 'data', 'service'])
    const link = byName.get('feature-link')!.input as { properties: Record<string, { enum?: string[] }> }
    assert.deepEqual(link.properties.type.enum, ['depends-on', 'configures', 'renders', 'data-flows', 'derived-from'])
    const edit = byName.get('feature-edit-node')!.input as { properties: Record<string, { type?: unknown }> }
    assert.deepEqual(edit.properties.parentId.type, ['string', 'null'])
    const ufLink = byName.get('userflow-link')!.input as { properties: Record<string, { enum?: string[] }> }
    assert.deepEqual(ufLink.properties.type.enum, ['navigates-to', 'submits', 'branches-on', 'requires', 'exercises'])
    const ufVerify = byName.get('userflow-set-verification')!.input as { properties: Record<string, { enum?: string[] }> }
    assert.deepEqual(ufVerify.properties.state.enum, ['untested', 'ok', 'blocked', 'error'])
    assert.deepEqual(ufVerify.properties.blockKind.enum, ['unreachable', 'missing-affordance', 'console-error', 'dead-end', 'state-blocked'])
  })

  it('a wave-3 tool reports a dead host as content naming the tool, not a throw', async () => {
    const added = await setupWith('http://127.0.0.1:9999')
    const query = added.find((t) => t.name === 'feature-query')!
    globalThis.fetch = (async () => { throw new Error('connect ECONNREFUSED') }) as typeof fetch
    const out = await query.execute({ mode: 'overview' }, {})
    const parsed = JSON.parse(out.content) as { ok: boolean; error: string }
    assert.equal(parsed.ok, false)
    assert.match(parsed.error, /feature-query/)
    assert.match(parsed.error, /ECONNREFUSED/)
  })

  it('a wave-1 tool reports a dead host as content naming the tool, not a throw', async () => {
    const added = await setupWith('http://127.0.0.1:9999')
    const patch = added.find((t) => t.name === 'patch-dom')!
    globalThis.fetch = (async () => { throw new Error('connect ECONNREFUSED') }) as typeof fetch
    const out = await patch.execute({ selector: 'h1' }, {})
    const parsed = JSON.parse(out.content) as { ok: boolean; error: string }
    assert.equal(parsed.ok, false)
    assert.match(parsed.error, /patch-dom/)
    assert.match(parsed.error, /ECONNREFUSED/)
  })

  it('wave-2 schemas mirror the Mastra originals (required fields, nested sourceLoc)', async () => {
    const added = await setupWith('http://127.0.0.1:4112')
    const byName = new Map(added.map((t) => [t.name, t]))
    const required = (n: string) => (byName.get(n)!.input as { required?: string[] }).required ?? []
    assert.deepEqual(required('get-network-failures'), [])
    assert.deepEqual(required('resolve-source'), ['selector'])
    assert.deepEqual(required('console-expect'), ['text'])
    const rs = byName.get('resolve-source')!.input as {
      properties: Record<string, { properties?: Record<string, unknown>; required?: string[] }>
    }
    assert.deepEqual(rs.properties.sourceLoc.required, ['file'])
    assert.ok('file' in (rs.properties.sourceLoc.properties ?? {}) && 'line' in (rs.properties.sourceLoc.properties ?? {}))
    const gnf = byName.get('get-network-failures')!.input as { properties: Record<string, { maximum?: number }> }
    assert.equal(gnf.properties.maxEntries.maximum, 200)
  })

  it('console-expect POSTs the declaration to its own endpoint and returns its JSON', async () => {
    const added = await setupWith('http://127.0.0.1:9999')
    const tool = added.find((t) => t.name === 'console-expect')!
    let seenUrl = ''
    let seenBody = ''
    globalThis.fetch = (async (url: string, init: { body: string }) => {
      seenUrl = String(url)
      seenBody = init.body
      return { json: async () => ({ ok: true, declared: 1 }) }
    }) as typeof fetch
    const out = await tool.execute({ text: 'PROBE-1' }, {})
    assert.equal(seenUrl, 'http://127.0.0.1:9999/api/console/expect')
    assert.deepEqual(JSON.parse(seenBody), { text: 'PROBE-1' })
    assert.deepEqual(JSON.parse(out.content), { ok: true, declared: 1 })
  })

  it('console-expect reports a dead host as content, not a throw', async () => {
    const added = await setupWith('http://127.0.0.1:9999')
    const tool = added.find((t) => t.name === 'console-expect')!
    globalThis.fetch = (async () => { throw new Error('connect ECONNREFUSED') }) as typeof fetch
    const out = await tool.execute({ text: 'PROBE-1' }, {})
    const parsed = JSON.parse(out.content) as { ok: boolean; error: string }
    assert.equal(parsed.ok, false)
    assert.match(parsed.error, /console-expect/)
    assert.match(parsed.error, /ECONNREFUSED/)
  })

  it('each wave-4A project tool POSTs {tool, input} to the project dispatch endpoint and returns its JSON', async () => {
    const added = await setupWithToggles('http://127.0.0.1:9999', { skill: true })
    const projectTools = added.filter((t) => WAVE4A.includes(t.name))
    assert.equal(projectTools.length, 17)
    for (const tool of projectTools) {
      let seenUrl = ''
      let seenBody = ''
      globalThis.fetch = (async (url: string, init: { body: string }) => {
        seenUrl = String(url)
        seenBody = init.body
        return { json: async () => ({ ok: true, marker: tool.name }) }
      }) as typeof fetch
      const out = await tool.execute({ probe: 1 }, {})
      assert.equal(seenUrl, 'http://127.0.0.1:9999/api/project/tool', tool.name)
      assert.deepEqual(JSON.parse(seenBody), { tool: tool.name, input: { probe: 1 } }, tool.name)
      assert.deepEqual(JSON.parse(out.content), { ok: true, marker: tool.name }, tool.name)
    }
  })

  it('wave-4A schemas mirror the Mastra originals (required fields, enums, caps)', async () => {
    const added = await setupWithToggles('http://127.0.0.1:4112', { skill: true })
    const byName = new Map(added.map((t) => [t.name, t]))
    const required = (n: string) => (byName.get(n)!.input as { required?: string[] }).required ?? []
    assert.deepEqual(required('plan-add-question'), ['label', 'defaultProposal'])
    assert.deepEqual(required('plan-remove-question'), ['id'])
    assert.deepEqual(required('plan-revise-question'), ['id'])
    assert.deepEqual(required('plan-from-graph'), [])
    assert.deepEqual(required('plan-update-task'), ['id', 'status'])
    assert.deepEqual(required('plan-finish'), ['summary'])
    assert.deepEqual(required('read-skill'), ['name'])
    assert.deepEqual(required('run-skill-checks'), ['skill'])
    assert.deepEqual(required('find-component'), [])
    assert.deepEqual(required('codebase-map'), [])
    assert.deepEqual(required('adopt-registry'), [])
    assert.deepEqual(required('install-catalog-component'), ['tag'])
    assert.deepEqual(required('place-template'), [])
    assert.deepEqual(required('runtime-state-scan'), [])
    assert.deepEqual(required('runtime-state-set'), ['key', 'value'])
    assert.deepEqual(required('unpack-code'), ['path'])
    assert.deepEqual(required('read-symbol'), ['path', 'name'])
    const upd = byName.get('plan-update-task')!.input as { properties: Record<string, { enum?: string[] }> }
    assert.deepEqual(upd.properties.status.enum, ['todo', 'doing', 'done'])
    const add = byName.get('plan-add-question')!.input as { properties: Record<string, { enum?: string[] }> }
    assert.deepEqual(add.properties.control.enum, ['choice', 'text'])
    const set = byName.get('runtime-state-set')!.input as { properties: Record<string, { enum?: string[] }> }
    assert.deepEqual(set.properties.store.enum, ['localStorage', 'sessionStorage'])
    const fc = byName.get('find-component')!.input as { properties: Record<string, { maximum?: number }> }
    assert.equal(fc.properties.limit.maximum, 12)
    const map = byName.get('codebase-map')!.input as { properties: Record<string, { maximum?: number }> }
    assert.equal(map.properties.budgetTokens.maximum, 4000)
  })

  it('with only the fs override ON, the 9 ALE fs tools register too (74 total), after the content tools', async () => {
    const added = await setupWithFs('http://127.0.0.1:4112', true)
    assert.equal(added.length, 74)
    assert.deepEqual(added.map((t) => t.name), [
      'get-console', ...WAVE1, ...WAVE2, ...WAVE3,
      ...WAVE4A.filter((n) => n !== 'read-skill'), ...WAVE4B_CONTENT, ...WAVE4B_FS, 'console-expect',
    ])
    for (const tool of added) assert.deepEqual(tool.options, { codemode: false }, tool.name)
  })

  it('each wave-4B content tool POSTs {tool, input} to /api/data/tool; web tools to /api/web/tool; fs tools (when on) to /api/fs/tool', async () => {
    const off = await setupWithToggles('http://127.0.0.1:9999', { web: true })
    const on = await setupWithFs('http://127.0.0.1:9999', true)
    const groups: Array<{ tools: AddedTool[]; url: string }> = [
      { tools: off.filter((t) => WAVE4B_CONTENT.includes(t.name)), url: 'http://127.0.0.1:9999/api/data/tool' },
      { tools: off.filter((t) => WAVE4B_WEB.includes(t.name)), url: 'http://127.0.0.1:9999/api/web/tool' },
      { tools: on.filter((t) => WAVE4B_FS.includes(t.name)), url: 'http://127.0.0.1:9999/api/fs/tool' },
    ]
    assert.equal(groups[0].tools.length, 18)
    assert.equal(groups[1].tools.length, 3)
    assert.equal(groups[2].tools.length, 9)
    for (const { tools, url } of groups) {
      for (const tool of tools) {
        let seenUrl = ''
        let seenBody = ''
        globalThis.fetch = (async (u: string, init: { body: string }) => {
          seenUrl = String(u)
          seenBody = init.body
          return { json: async () => ({ ok: true, marker: tool.name }) }
        }) as typeof fetch
        const out = await tool.execute({ probe: 1 }, {})
        assert.equal(seenUrl, url, tool.name)
        assert.deepEqual(JSON.parse(seenBody), { tool: tool.name, input: { probe: 1 } }, tool.name)
        assert.deepEqual(JSON.parse(out.content), { ok: true, marker: tool.name }, tool.name)
      }
    }
  })

  it('wave-4B schemas mirror the Mastra originals (required fields, enums, caps)', async () => {
    const added = await setupWithToggles('http://127.0.0.1:4112', { fs: true, web: true })
    const byName = new Map(added.map((t) => [t.name, t]))
    const required = (n: string) => (byName.get(n)!.input as { required?: string[] }).required ?? []
    assert.deepEqual(required('spreadsheet-inspect'), ['path'])
    assert.deepEqual(required('spreadsheet-set-cell'), ['path', 'row', 'col', 'value'])
    assert.deepEqual(required('spreadsheet-add-row'), ['path', 'values'])
    assert.deepEqual(required('data-get'), ['path', 'address'])
    assert.deepEqual(required('data-set'), ['path', 'address', 'value'])
    assert.deepEqual(required('data-add'), ['path', 'parent', 'value'])
    assert.deepEqual(required('data-remove'), ['path', 'address'])
    assert.deepEqual(required('doc-set-item'), ['path', 'block', 'item'])
    assert.deepEqual(required('doc-set-style'), ['path', 'block'])
    assert.deepEqual(required('doc-add-block'), ['path', 'kind', 'text'])
    assert.deepEqual(required('web-search'), ['query'])
    assert.deepEqual(required('fetch-page'), ['url'])
    assert.deepEqual(required('research'), ['question', 'queries'])
    assert.deepEqual(required('grep'), ['pattern'])
    assert.deepEqual(required('str-replace'), ['path', 'old_string', 'new_string'])
    assert.deepEqual(required('write-real-file'), ['path', 'content'])
    assert.deepEqual(required('rename-file'), ['from', 'to'])
    assert.deepEqual(required('list-real-files'), [])
    assert.deepEqual(required('run-project-check'), [])
    const add = byName.get('data-add')!.input as { properties: Record<string, { enum?: string[] }> }
    assert.deepEqual(add.properties.type.enum, ['string', 'number', 'boolean', 'null'])
    const style = byName.get('doc-set-style')!.input as { properties: Record<string, { enum?: string[]; maximum?: number }> }
    assert.deepEqual(style.properties.align.enum, ['left', 'center', 'right', 'justify'])
    assert.equal(style.properties.level.maximum, 6)
    const kind = byName.get('doc-add-block')!.input as { properties: Record<string, { enum?: string[] }> }
    assert.deepEqual(kind.properties.kind.enum, ['heading', 'paragraph', 'list'])
    const ws = byName.get('web-search')!.input as { properties: Record<string, { maximum?: number; enum?: string[] }> }
    assert.equal(ws.properties.count.maximum, 10)
    assert.deepEqual(ws.properties.freshness.enum, ['day', 'week', 'month', 'year'])
    const q = byName.get('research')!.input as { properties: Record<string, { maxItems?: number }> }
    assert.equal(q.properties.queries.maxItems, 6)
    const gh = byName.get('grep')!.input as { properties: Record<string, { minimum?: number }> }
    assert.equal(gh.properties.maxHits.minimum, 1)
  })

  it('a wave-1 tool reports a non-JSON host answer as content with the HTTP status', async () => {
    const added = await setupWith('http://127.0.0.1:9999')
    const snap = added.find((t) => t.name === 'take-snapshot')!
    globalThis.fetch = (async () => ({
      status: 502,
      json: async () => { throw new Error('not json') },
    })) as unknown as typeof fetch
    const out = await snap.execute({}, {})
    const parsed = JSON.parse(out.content) as { ok: boolean; error: string }
    assert.equal(parsed.ok, false)
    assert.match(parsed.error, /HTTP 502/)
  })
})

describe('ai-live-editor opencode plugin: slice-7 execute.before backstop', () => {
  type HookInput = { tool: string; sessionID: string; agent: string }
  type HookFn = (input: HookInput) => Promise<void>

  async function setupWithHook(hostUrl: string): Promise<{ hook: HookFn }> {
    let hook: HookFn | null = null
    const ctx = {
      options: { hostUrl },
      tool: {
        transform: async (cb: (editor: { add: (t: AddedTool) => void; namespace: () => void }) => void) => {
          cb({ add: () => {}, namespace: () => {} })
        },
        hook: async (name: string, cb: HookFn) => {
          assert.equal(name, 'execute.before')
          hook = cb
          return {}
        },
      },
    }
    await plugin.setup(ctx)
    assert.ok(hook, 'the plugin registers an execute.before hook')
    return { hook: hook as HookFn }
  }

  it('consults the host tool-check endpoint for ALE tools and passes on allow', async () => {
    const { hook } = await setupWithHook('http://127.0.0.1:9999')
    let seenUrl = ''
    let seenBody = ''
    globalThis.fetch = (async (url: string, init: { body: string }) => {
      seenUrl = String(url)
      seenBody = init.body
      return { json: async () => ({ allow: true }) }
    }) as typeof fetch
    await hook({ tool: 'patch-dom', sessionID: 'ses-1', agent: 'ale-sketch' })
    assert.equal(seenUrl, 'http://127.0.0.1:9999/api/opencode/tool-check')
    assert.deepEqual(JSON.parse(seenBody), { sessionID: 'ses-1', tool: 'patch-dom' })
  })

  it('throws the host’s reason on an explicit deny (the throw is what blocks execution)', async () => {
    const { hook } = await setupWithHook('http://127.0.0.1:9999')
    globalThis.fetch = (async () => ({
      json: async () => ({ allow: false, reason: 'write-real-file is not available in this turn (sketch workflow).' }),
    })) as unknown as typeof fetch
    await assert.rejects(
      hook({ tool: 'write-real-file', sessionID: 'ses-1', agent: 'ale-sketch' }),
      /write-real-file is not available in this turn/,
    )
  })

  it('never consults the host for native OpenCode tools', async () => {
    const { hook } = await setupWithHook('http://127.0.0.1:9999')
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return { json: async () => ({ allow: false, reason: 'no' }) }
    }) as unknown as typeof fetch
    await hook({ tool: 'shell', sessionID: 'ses-1', agent: 'ale-files' })
    await hook({ tool: 'edit', sessionID: 'ses-1', agent: 'ale-files' })
    await hook({ tool: 'execute', sessionID: 'ses-1', agent: 'ale-files' })
    assert.equal(calls, 0, 'natives are governed by config permissions, not the backstop')
  })

  it('an unreachable host or a non-JSON answer never denies (execute reports host failures itself)', async () => {
    const { hook } = await setupWithHook('http://127.0.0.1:9999')
    globalThis.fetch = (async () => { throw new Error('connect ECONNREFUSED') }) as typeof fetch
    await hook({ tool: 'get-console', sessionID: 'ses-1', agent: 'ale-files' })
    globalThis.fetch = (async () => ({
      json: async () => { throw new Error('not json') },
    })) as unknown as typeof fetch
    await hook({ tool: 'get-console', sessionID: 'ses-1', agent: 'ale-files' })
  })
})
