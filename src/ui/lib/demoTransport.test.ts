import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createDemoHandler } from './demoTransport'

const handler = createDemoHandler()

describe('demoTransport — core endpoints answer fixture-shaped data', () => {
  it('bootstrap: projects, config, workflow', async () => {
    const projects = await handler('GET', '/api/projects')
    assert.equal(projects?.status, 200)
    const pj = projects!.json as any
    assert.equal(pj.active, 'lumen')
    assert.equal(pj.projects.length, 1)
    assert.equal(pj.projects[0].setup.kind, 'ready')

    const config = await handler('GET', '/api/config')
    const cfg = config!.json as any
    assert.equal(cfg.activeProject, 'lumen')
    assert.equal(cfg.previewHmrUrl, 'preview/')

    const wf = await handler('GET', '/api/workflow')
    assert.equal((wf!.json as any).previewMark, 'index.html')
  })

  it('files: list and read come from the real sample project', async () => {
    const list = await handler('GET', '/api/fs/list')
    const lj = list!.json as any
    assert.equal(lj.root, 'lumen')
    assert.ok(lj.files.includes('/App.jsx'))
    assert.ok(lj.files.includes('/ai-features/graph.json'))

    const read = await handler('GET', '/api/fs/read?path=' + encodeURIComponent('/ai-features/graph.json'))
    const content = (read!.json as any).content as string
    assert.ok(content.includes('"Inbox & Email"'))

    const missing = await handler('GET', '/api/fs/read?path=/nope.ts')
    assert.equal((missing!.json as any).error, 'Not found')
  })

  it('facets: features carry the real graph and rollup', async () => {
    const r = await handler('GET', '/api/features')
    const j = r!.json as any
    assert.equal(j.graph.nodes.length, 23)
    assert.equal(j.rollup.overall.total, 19)
    assert.equal(j.rollup.overall.pct, 58)

    const tech = await handler('GET', '/api/tech-stack')
    assert.ok((tech!.json as any).stack.facts.length > 0)
    const criteria = await handler('GET', '/api/facet-criteria/delivery')
    assert.equal((criteria!.json as any).ok, true)
  })

  it('delivery: summaries are the recorded real state', async () => {
    const summary = await handler('GET', '/api/delivery/summary')
    const j = summary!.json as any
    assert.equal(j.summary.git.branch, 'main')
    const status = await handler('GET', '/api/delivery/git/status')
    assert.equal((status!.json as any).status.clean, true)
  })
})

describe('demoTransport — writes stay in memory', () => {
  it('a write is readable from the same handler, absent from a fresh one', async () => {
    const h = createDemoHandler()
    await h('POST', '/api/fs/write', JSON.stringify({ path: '/App.jsx', content: '// edited in the demo\n' }))
    const read = await h('GET', '/api/fs/read?path=/App.jsx')
    assert.equal((read!.json as any).content, '// edited in the demo\n')

    const fresh = createDemoHandler()
    const orig = await fresh('GET', '/api/fs/read?path=/App.jsx')
    assert.notEqual((orig!.json as any).content, '// edited in the demo\n')
  })

  it('a feature status edit moves the rollup', async () => {
    const h = createDemoHandler()
    const before = (await h('GET', '/api/features'))!.json as any
    const building = before.graph.nodes.find((n: any) => n.status === 'building' && n.kind !== 'region')
    assert.ok(building)
    await h('POST', '/api/features/status', JSON.stringify({ id: building.id, status: 'done' }))
    const after = (await h('GET', '/api/features'))!.json as any
    assert.equal(after.rollup.overall.built, before.rollup.overall.built + 1)
  })
})

describe('demoTransport — chat replays stream as real SSE events', () => {
  async function runChat(h: ReturnType<typeof createDemoHandler>, userText: string) {
    const reply = await h('POST', '/api/chat/stream', JSON.stringify({ messages: [{ role: 'user', content: userText }] }))
    assert.ok(reply?.stream, 'chat stream returns an SSE stream')
    const reader = reply!.stream!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
    }
    return buf.split('\n\n').filter(p => p.startsWith('data: ')).map(p => JSON.parse(p.slice(6)))
  }

  it('the edit replay patches the fixture file and ends with the gate verdict', async () => {
    const h = createDemoHandler()
    const events = await runChat(h, 'Change the subject of Nora’s email to “Onboarding empty state: the first-run inbox pass”')
    const types = events.map((e: any) => e.type)
    assert.ok(types.includes('tool-call'))
    assert.ok(types.includes('tool-result'))
    assert.equal(types[types.length - 1], 'done')
    const doneEv = events[events.length - 1] as any
    assert.equal(doneEv.verification.ran, true)
    assert.equal(doneEv.verification.clean, false)
    assert.equal(doneEv.verification.newLayout, 1)
    const tool = events.find((e: any) => e.type === 'tool-call') as any
    assert.equal(tool.name, 'str-replace')

    const read = await h('GET', '/api/fs/read?path=/App.jsx')
    const content = (read!.json as any).content as string
    assert.ok(content.includes('Onboarding empty state: the first-run inbox pass'))
    assert.ok(!content.includes('Onboarding empty state needs a pass'))
  })

  it('the organisation replay answers from the feature graph', async () => {
    const events = await runChat(createDemoHandler(), 'How is this project organised?')
    const text = events.filter((e: any) => e.type === 'text-delta').map((e: any) => e.text).join('')
    assert.match(text, /Inbox & Email/)
    assert.match(text, /58%/)
    const doneEv = events[events.length - 1] as any
    assert.equal(doneEv.type, 'done')
    assert.equal(doneEv.verification, undefined)
  })

  it('free text gets the honest fallback, not a fake agent', async () => {
    const events = await runChat(createDemoHandler(), 'Please refactor the flux capacitor')
    const text = events.filter((e: any) => e.type === 'text-delta').map((e: any) => e.text).join('')
    assert.match(text, /recording, not a live agent/)
  })
})

describe('demoTransport — refusals are clean and plain', () => {
  it('server-only actions refuse with the demo note', async () => {
    const commit = await handler('POST', '/api/delivery/git/commit', JSON.stringify({ message: 'x' }))
    assert.equal((commit!.json as any).ok, false)
    assert.match((commit!.json as any).error, /Demo mode/)

    const ci = await handler('POST', '/api/delivery/ci/action', JSON.stringify({ action: 'trigger', pipelineId: 'x' }))
    assert.equal(ci?.status, 422)
    assert.equal((ci!.json as any).ok, false)

    const create = await handler('POST', '/api/projects/create', JSON.stringify({ id: 'new' }))
    assert.equal(create?.status, 422)
    assert.equal((create!.json as any).ok, false)
  })

  it('unknown endpoints get a typed demo answer, never a hang', async () => {
    const r = await handler('GET', '/api/something-unheard-of')
    assert.equal((r!.json as any).ok, false)
    assert.equal((r!.json as any).demo, true)
  })

  it('non-API requests pass through (null)', async () => {
    assert.equal(await handler('GET', '/assets/index-abc.js'), null)
    assert.equal(await handler('GET', 'https://example.com/api/projects'), null)
  })

  it('project files serve raw through /projects/', async () => {
    const r = await handler('GET', '/projects/index.html')
    assert.equal(r?.status, 200)
    assert.match(r!.text!, /<title>Lumen<\/title>/)
  })
})
