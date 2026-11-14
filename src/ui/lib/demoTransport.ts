/**
 * Demo transport — the fixture half of the Vercel demo.
 *
 * In demo mode (lib/demoMode) there is no editor server: this
 * module wraps window.fetch and answers the UI's /api/* calls in
 * the browser from the bundled fixture (src/ui/demo/fixtureData.ts,
 * generated from the real sample project by
 * scripts/generate-demo-fixture.ts — every payload there was
 * produced by the server's own derivation functions).
 *
 * What the demo can honestly do, it does: browsing the project,
 * reading and editing files (edits live in an in-memory copy —
 * nothing persists past the session, and nothing leaves the
 * browser), facet and Delivery views over the recorded state,
 * feature-graph edits in memory. What needs a real machine —
 * running tests, git actions, CI/deployment actions, provider
 * connections, dispatches — refuses in plain words, in the same
 * { ok: false, error } shape the real server uses for its own
 * refusals.
 *
 * The seam is fetch itself: src/ui/lib/api.ts (and the few lib
 * modules that fetch directly) all go through it, so no call
 * site changes. Non-API requests pass through untouched.
 */
import { FIXTURE_DATA } from '../demo/fixtureData'
import { pickReplay, type DemoStep } from '../demo/replays'
import { DEMO_LOCAL_NOTE, isDemoMode } from './demoMode'

export const DEMO_REFUSAL = DEMO_LOCAL_NOTE

type Json = Record<string, any>

export interface DemoReply {
  status: number
  json?: unknown
  text?: string
  contentType?: string
  /** Server-sent events (the chat replay stream). */
  stream?: ReadableStream<Uint8Array>
}

const ok = (json: unknown): DemoReply => ({ status: 200, json })
const refuse = (error: string = DEMO_REFUSAL, status = 422): DemoReply => ({ status, json: { ok: false, error } })
/** Action endpoints whose clients read { ok, error } off a 200. */
const refuseSoft = (error: string): DemoReply => ({ status: 200, json: { ok: false, error } })

const clone = <T,>(v: T): T => structuredClone(v)

function normPath(p: string): string {
  return '/' + p.replace(/^\/+/, '')
}

/* Feature rollup, mirroring graphRollup in src/features/features.ts
 * (COUNTED excludes regions, dropped and suggested nodes; BUILT is
 * done|verified; a region's rollup covers its subtree). Replicated
 * here because the server module cannot ship in the UI bundle. */
interface Rollup { total: number, built: number, blocked: number, pct: number }
function rollupOf(nodes: Json[]): Rollup {
  const counted = nodes.filter(n => n.kind !== 'region' && n.status !== 'dropped' && n.status !== 'suggested')
  const built = counted.filter(n => n.status === 'done' || n.status === 'verified').length
  return {
    total: counted.length,
    built,
    blocked: counted.filter(n => n.status === 'blocked').length,
    pct: counted.length ? Math.round((built / counted.length) * 100) : 0,
  }
}
function graphRollupLocal(graph: Json) {
  const nodes = graph.nodes as Json[]
  const byId = new Map(nodes.map(n => [n.id as string, n]))
  const subtree = (id: string): Json[] => {
    const out: Json[] = []
    const seen = new Set<string>()
    const queue = [byId.get(id)]
    while (queue.length) {
      const node = queue.shift()
      if (!node || seen.has(node.id)) continue
      seen.add(node.id)
      out.push(node)
      for (const child of nodes) if (child.parent === node.id) queue.push(child)
    }
    return out
  }
  return {
    overall: rollupOf(nodes),
    regions: nodes.filter(n => n.kind === 'region' && !n.parent)
      .map(node => ({ node, rollup: rollupOf(subtree(node.id as string)) })),
  }
}

export interface DemoHandler {
  (method: string, url: string, bodyText?: string): Promise<DemoReply | null>
}

/**
 * Build the request handler over a fixture. Pure of window/fetch
 * so tests can drive it directly; installDemoTransport wires it
 * to the real fetch.
 */
export function createDemoHandler(fixture: Record<string, any> = FIXTURE_DATA, origin = ''): DemoHandler {
  const state = {
    contents: new Map<string, string>(Object.entries(fixture.contents as Record<string, string>)),
    files: [...(fixture.files.files as string[])],
    dirs: [...(fixture.files.dirs as string[])],
    mtimes: new Map<string, number>(Object.entries(fixture.files.mtimes as Record<string, number>)),
    featureGraph: fixture.features.graph ? clone(fixture.features.graph) : null,
    designGuide: fixture.designGuide.guide ? clone(fixture.designGuide.guide) : null,
    designGraph: clone(fixture.designGraphStored),
    projectConfig: clone(fixture.projectConfig.config) as Json,
    workflow: clone(fixture.workflow) as Json,
    agentSettings: clone(fixture.agentSettings) as Json,
    appSettings: { uiPrefs: null as Json | null, editorTheme: null as string | null, setupDone: true as boolean | null },
    connections: clone(fixture.connections) as Json,
    skillsState: clone(fixture.skillsState) as Json,
    crossLinks: clone(fixture.crossLinks.links) as Json[],
    deliverySettings: clone(fixture.deliverySettings.settings) as Json,
    plans: clone(fixture.plans) as Json,
  }

  const config = {
    ok: true,
    hasApiKey: true,
    hasOpenAiKey: true,
    model: 'demo-replay',
    modelName: 'Demo replay',
    modelId: 'demo/demo-replay',
    providerId: 'demo',
    providerName: 'Demo',
    contextWindow: 200000,
    baseUrl: '',
    launcherUrl: origin,
    previewStaticUrl: 'preview/',
    previewHmrUrl: 'preview/',
    workspace: 'projects',
    activeProject: 'lumen',
    fsRoot: 'lumen',
    playwrightPool: false,
    liveTarget: 'bridge',
  }

  const featuresPayload = () => state.featureGraph
    ? { ok: true, graph: state.featureGraph, rollup: graphRollupLocal(state.featureGraph) }
    : { ok: true, graph: null, rollup: null }

  return async (method: string, rawUrl: string, bodyText?: string): Promise<DemoReply | null> => {
    let url: URL
    try { url = new URL(rawUrl, 'http://demo.invalid') } catch { return null }
    // Absolute URLs to another origin are not ours to answer.
    if (url.hostname !== 'demo.invalid' && url.origin !== origin) return null
    const path = url.pathname
    const isApi = path.startsWith('/api/')
    if (!isApi && path !== '/live-edit/overlay.js' && !path.startsWith('/projects/')) return null

    let body: Json = {}
    if (bodyText) { try { body = JSON.parse(bodyText) as Json } catch { body = {} } }
    const q = url.searchParams

    /* The sample project's raw files, as the real server's
     * /projects/ static route would serve them. */
    if (path.startsWith('/projects/')) {
      const rel = normPath(decodeURIComponent(path.slice('/projects'.length)))
      const content = state.contents.get(rel)
      if (content === undefined) return { status: 404, text: 'Not in the demo project.', contentType: 'text/plain' }
      return { status: 200, text: content, contentType: contentTypeFor(rel) }
    }
    if (path === '/live-edit/overlay.js') {
      return { status: 200, text: '/* Demo mode: the live-edit overlay runs against a live page server, so it is not part of the demo. */', contentType: 'text/javascript' }
    }

    switch (`${method} ${path}`) {
      /* ── bootstrap ─────────────────────────────────────── */
      case 'GET /api/fs/health':
        return ok({ ok: true, root: 'lumen', files: state.files.slice(0, 20).map(f => f.replace(/^\//, '')) })
      case 'GET /api/config':
        return ok(config)
      case 'GET /api/projects':
        return ok(fixture.projects)
      case 'POST /api/projects/select':
        return ok({ ok: true, active: 'lumen', root: 'lumen', setup: fixture.projects.projects[0].setup, projects: fixture.projects.projects })
      case 'POST /api/projects/sync/changes':
        return ok({ ok: true, now: Date.now(), changed: [], deleted: [] })
      case 'GET /api/app-settings':
        return ok({ ok: true, ...state.appSettings })
      case 'PUT /api/app-settings': {
        if (body.uiPrefs !== undefined) state.appSettings.uiPrefs = body.uiPrefs
        if (typeof body.editorTheme === 'string') state.appSettings.editorTheme = body.editorTheme
        if (typeof body.setupDone === 'boolean') state.appSettings.setupDone = body.setupDone
        return ok({ ok: true, ...state.appSettings })
      }
      case 'GET /api/agent-settings':
        return ok({ ok: true, settings: state.agentSettings })
      case 'POST /api/agent-settings':
        Object.assign(state.agentSettings, body)
        return ok({ ok: true, settings: state.agentSettings })
      case 'GET /api/workflow':
        return ok(state.workflow)
      case 'POST /api/workflow': {
        for (const k of ['mode', 'deviceTarget', 'previewMark', 'previewLocation', 'searchBackend']) {
          if (k in body) state.workflow[k] = body[k]
        }
        return ok(state.workflow)
      }
      case 'GET /api/project/config':
        return ok({ ok: true, config: state.projectConfig, designated: fixture.projectConfig.designated })
      case 'POST /api/project/config': {
        for (const [k, v] of Object.entries(body)) {
          if (v === null) delete state.projectConfig[k]
          else state.projectConfig[k] = v
        }
        return ok({ ok: true, config: state.projectConfig, designated: fixture.projectConfig.designated })
      }

      /* ── files (in-memory) ─────────────────────────────── */
      case 'GET /api/fs/list':
        return ok({ files: [...state.files], dirs: [...state.dirs], mtimes: Object.fromEntries(state.mtimes), root: 'lumen' })
      case 'GET /api/fs/read': {
        const p = normPath(q.get('path') ?? '')
        const content = state.contents.get(p)
        return content === undefined ? ok({ error: 'Not found', path: q.get('path') }) : ok({ path: q.get('path'), content })
      }
      case 'GET /api/fs/read-binary': {
        const p = normPath(q.get('path') ?? '')
        const content = state.contents.get(p)
        return content === undefined
          ? { status: 404, text: 'Not found', contentType: 'text/plain' }
          : { status: 200, text: content, contentType: 'application/octet-stream' }
      }
      case 'POST /api/fs/write': {
        const p = normPath(String(body.path ?? ''))
        if (!state.contents.has(p)) { state.files.push(p) }
        state.contents.set(p, String(body.content ?? ''))
        state.mtimes.set(p, Date.now())
        return ok({ ok: true })
      }
      case 'POST /api/fs/write-binary':
        return ok({ ok: true })
      case 'POST /api/fs/rename': {
        const from = normPath(String(body.from ?? ''))
        const to = normPath(String(body.to ?? ''))
        const content = state.contents.get(from)
        if (content !== undefined) {
          state.contents.delete(from); state.contents.set(to, content)
          state.files = state.files.map(f => (f === from ? to : f))
          const mt = state.mtimes.get(from); state.mtimes.delete(from); if (mt) state.mtimes.set(to, mt)
        }
        return ok({ ok: true })
      }
      case 'POST /api/fs/delete': {
        const p = normPath(String(body.path ?? ''))
        state.contents.delete(p)
        state.files = state.files.filter(f => f !== p && !f.startsWith(p + '/'))
        state.dirs = state.dirs.filter(d => d !== p && !d.startsWith(p + '/'))
        for (const f of [...state.contents.keys()]) if (f.startsWith(p + '/')) state.contents.delete(f)
        return ok({ ok: true })
      }
      case 'POST /api/fs/mkdir': {
        const p = normPath(String(body.path ?? ''))
        if (!state.dirs.includes(p)) state.dirs.push(p)
        return ok({ ok: true })
      }
      case 'POST /api/jsx/bundle':
        return ok({ ok: false, error: 'Demo mode — bundling a component needs the local server. You can read and edit the source here; run ALE locally to render it.' })

      /* ── facets ────────────────────────────────────────── */
      case 'GET /api/features':
        return ok(featuresPayload())
      case 'POST /api/features/status': {
        const node = state.featureGraph?.nodes.find((n: Json) => n.id === body.id)
        if (node) node.status = body.status
        return ok({ ok: true })
      }
      case 'POST /api/features/param': {
        const node = state.featureGraph?.nodes.find((n: Json) => n.id === body.id)
        if (node) node.values = { ...(node.values ?? {}), [String(body.name)]: String(body.value) }
        return ok({ ok: true })
      }
      case 'POST /api/features/nodes': {
        if (!state.featureGraph) return refuse()
        const node = {
          id: `demo-${Math.random().toString(36).slice(2, 9)}`,
          name: String(body.name ?? 'Untitled'), kind: String(body.kind ?? 'feature'), status: 'proposed',
          ...(body.parentId ? { parent: String(body.parentId) } : {}),
        }
        state.featureGraph.nodes.push(node)
        return ok({ ok: true, node })
      }
      case 'POST /api/features/edit': {
        const node = state.featureGraph?.nodes.find((n: Json) => n.id === body.id)
        if (node) {
          if (typeof body.name === 'string') node.name = body.name
          if ('parentId' in body) { if (body.parentId) node.parent = body.parentId; else delete node.parent }
        }
        return ok({ ok: true, node })
      }
      case 'POST /api/features/remove-node': {
        const g = state.featureGraph
        if (!g) return ok({ ok: true })
        const target = g.nodes.find((n: Json) => n.id === body.id)
        if (target) {
          if (body.mode === 'cascade') {
            const dead = new Set<string>([target.id])
            let grew = true
            while (grew) { grew = false; for (const n of g.nodes) if (n.parent && dead.has(n.parent) && !dead.has(n.id)) { dead.add(n.id); grew = true } }
            g.nodes = g.nodes.filter((n: Json) => !dead.has(n.id))
            g.edges = g.edges.filter((e: Json) => !dead.has(e.from) && !dead.has(e.to))
          } else {
            for (const n of g.nodes) if (n.parent === target.id) { if (target.parent) n.parent = target.parent; else delete n.parent }
            g.nodes = g.nodes.filter((n: Json) => n.id !== target.id)
            g.edges = g.edges.filter((e: Json) => e.from !== target.id && e.to !== target.id)
          }
        }
        return ok({ ok: true })
      }
      case 'POST /api/features/links': {
        const g = state.featureGraph
        if (g && !g.edges.some((e: Json) => e.from === body.from && e.to === body.to && e.type === body.type)) {
          g.edges.push({ from: body.from, to: body.to, type: body.type })
        }
        return ok({ ok: true, totalEdges: g?.edges.length ?? 0 })
      }
      case 'POST /api/features/unlinks': {
        const g = state.featureGraph
        if (g) g.edges = g.edges.filter((e: Json) => !(e.from === body.from && e.to === body.to && e.type === body.type))
        return ok({ ok: true, totalEdges: g?.edges.length ?? 0 })
      }
      case 'POST /api/features/suggestions/derive':
        return ok({ ok: true, created: [], withdrawn: [], skippedDismissed: 0, alreadyLive: 0, suggestions: [] })
      case 'POST /api/features/suggestions/accept':
      case 'POST /api/features/suggestions/dismiss':
        return ok({ ok: true, rollup: state.featureGraph ? graphRollupLocal(state.featureGraph).overall : undefined })
      case 'GET /api/features/currency':
        return ok(fixture.featuresCurrency)
      case 'GET /api/features/lint':
        return ok(fixture.featuresLint)
      case 'GET /api/features/reconcile':
        return ok(fixture.featuresReconcile)
      case 'GET /api/design/guide':
        return ok({ ok: true, guide: state.designGuide })
      case 'POST /api/design/guide':
        state.designGuide = body.guide ?? null
        return ok({ ok: true, guide: state.designGuide })
      case 'GET /api/design/graph':
        return ok(state.designGraph)
      case 'POST /api/design/derive':
        state.designGraph = clone(fixture.designDerived)
        return ok(state.designGraph)
      case 'GET /api/design/packs':
        return ok(fixture.designPacks)
      case 'GET /api/architecture':
        return ok(fixture.architecture)
      case 'GET /api/architecture/packs':
        return ok(fixture.archPacks)
      case 'GET /api/tech-stack':
        return ok(fixture.techStack)
      case 'GET /api/config-inventory':
        return ok(fixture.configInventory)
      case 'GET /api/cross-links':
        return ok({ ok: true, links: state.crossLinks })
      case 'POST /api/cross-links': {
        const link = { id: `demo-${Math.random().toString(36).slice(2, 9)}`, kind: body.kind, from: body.from, to: body.to, resolved: false, targetLabel: String(body.to ?? '') }
        state.crossLinks.push(link)
        return ok({ ok: true, links: state.crossLinks })
      }
      case 'POST /api/cross-links/remove':
        state.crossLinks = state.crossLinks.filter(l => l.id !== body.id)
        return ok({ ok: true, links: state.crossLinks })
      case 'GET /api/userflows':
        return ok(fixture.userflows)
      case 'GET /api/plans':
        return ok(state.plans)
      case 'GET /api/catalog': {
        const query = (q.get('q') ?? '').toLowerCase()
        if (!query) return ok(fixture.catalog)
        const hit = (s: unknown) => String(s ?? '').toLowerCase().includes(query)
        return ok({
          ...fixture.catalog,
          components: fixture.catalog.components.filter((c: Json) => hit(c.tag) || hit(c.description)),
          packs: fixture.catalog.packs.filter((p: Json) => hit(p.name) || hit(p.description)),
          templates: fixture.catalog.templates.filter((t: Json) => hit(t.name) || hit(t.description)),
        })
      }
      case 'GET /api/skills/state':
        return ok(state.skillsState)
      case 'POST /api/skills/toggle': {
        const skill = state.skillsState.skills.find((s: Json) => s.name === body.name)
        if (skill) skill.enabled = body.enabled === true
        return ok(state.skillsState)
      }
      case 'GET /api/mcp/state':
        return ok(fixture.mcpState)
      case 'GET /api/mcp/catalog':
        return ok(fixture.mcpCatalog)

      /* ── delivery ──────────────────────────────────────── */
      case 'GET /api/delivery/git/status':
        return ok(fixture.deliveryGitStatus)
      case 'GET /api/delivery/git/log':
        return ok(fixture.deliveryGitLog)
      case 'GET /api/delivery/git/branches':
        return ok(fixture.deliveryGitBranches)
      case 'GET /api/delivery/git/worktrees':
        return ok(fixture.deliveryGitWorktrees)
      case 'POST /api/delivery/git/diff':
        return ok({ ok: true, diff: '' })
      case 'POST /api/delivery/git/draft-message':
        return ok({ ok: true, message: '' })
      case 'GET /api/delivery/tests':
        return ok(fixture.deliveryTests)
      case 'GET /api/delivery/summary':
        return ok(fixture.deliverySummary)
      case 'GET /api/delivery/ci':
        return ok(fixture.deliveryCi)
      case 'GET /api/delivery/deploy/targets':
        return ok(fixture.deliveryDeployTargets)
      case 'GET /api/delivery/settings':
        return ok({ ok: true, settings: state.deliverySettings })
      case 'POST /api/delivery/settings':
        state.deliverySettings = { agentCheckpoints: body.agentCheckpoints === true }
        return ok({ ok: true, settings: state.deliverySettings })

      /* ── host facts ────────────────────────────────────── */
      case 'GET /api/musecode/availability':
        return ok(fixture.musecodeAvailability)
      case 'GET /api/musecode/health':
        return ok(fixture.musecodeHealth)
      case 'POST /api/musecode/health/probe':
        return ok({ ok: true, probe: { state: 'indeterminate', detail: 'Demo mode — the sandbox probe runs on your own machine.', probedAt: new Date().toISOString() } })
      case 'GET /api/musecode/dispatches':
        return ok({ ok: true, dispatches: [] })
      case 'GET /api/musecode/gate-verdicts':
        return ok({ ok: true, verdicts: [] })
      case 'GET /api/connections':
        return ok(state.connections)
      case 'POST /api/connections/activate': {
        const conn = state.connections.connections.find((c: Json) => c.id === body.id)
        if (conn) { for (const c of state.connections.connections) c.active = c === conn; state.connections.activeId = conn.id }
        return ok(state.connections)
      }
      case 'POST /api/connections/modalities':
        return ok(state.connections)
      case 'POST /api/connections/test':
        return ok({ ...state.connections, probe: { ok: false, errorKind: 'unreachable', error: 'Demo mode — connections are tested from your own machine.' } })
      case 'POST /api/connections/probe':
        return ok({ ok: false, errorKind: 'unreachable', error: 'Demo mode — connections are checked from your own machine.' })
      case 'GET /api/research/config':
        return ok(fixture.researchConfig)
      case 'GET /api/page/status':
        return ok(fixture.pageStatus)
      case 'GET /api/plugin-ensure':
        return ok(fixture.pluginEnsure)
      case 'POST /api/plugin-ensure/remove':
      case 'POST /api/plugin-ensure/enable':
        return ok({ ok: true, ensure: fixture.pluginEnsure.ensure })
      case 'POST /api/chat/clear':
      case 'POST /api/chat/threads/clear':
      case 'POST /api/wizards/complete':
        return ok({ ok: true })
      case 'POST /api/chat/stream': {
        // The demo chat: a recorded replay (src/ui/demo/replays.ts),
        // streamed as real SSE in the ChatStreamEvent shapes. A
        // replay's patch step edits the in-memory fixture at the
        // moment the recorded tool call lands.
        const messages = Array.isArray(body.messages) ? body.messages : []
        const lastUser = [...messages].reverse().find((m: Json) => m?.role === 'user')
        const replay = pickReplay(typeof lastUser?.content === 'string' ? lastUser.content : '')
        const applyPatch = (step: Extract<DemoStep, { patch: unknown }>) => {
          const current = state.contents.get(step.patch.path)
          if (current && current.includes(step.patch.find)) {
            state.contents.set(step.patch.path, current.replace(step.patch.find, step.patch.replace))
            state.mtimes.set(step.patch.path, Date.now())
          }
        }
        return { status: 200, stream: sseReplayStream(replay.steps, applyPatch) }
      }
    }

    /* Facet criteria runs are per-facet GETs. */
    if (method === 'GET' && path.startsWith('/api/facet-criteria/')) {
      const facet = decodeURIComponent(path.slice('/api/facet-criteria/'.length))
      const run = fixture.facetCriteria[facet]
      return run ? ok(run) : refuse('No criteria set for that facet.', 404)
    }
    /* A single plan's document: the demo project has none. */
    if (method === 'GET' && path.startsWith('/api/plans/')) {
      return refuse('The demo project has no plans to open.', 404)
    }

    /* Delivery actions: the sections read { ok, error } off the
     * payload, so refusals ride a 200 here — the same words the
     * real server uses when a provider or target is missing. */
    if (path.startsWith('/api/delivery/git/') && method === 'POST') {
      return refuseSoft('Demo mode — Git actions run against a real project on your own machine.')
    }
    if (path === '/api/delivery/tests/run') {
      return refuse('Demo mode — test runs happen on your own machine.')
    }
    if (path === '/api/delivery/ci/action' || path === '/api/delivery/ci/starter') {
      return refuse('Demo mode — CI actions need a local install with a connected provider. The sample project has no CI workflows.')
    }
    if (path.startsWith('/api/delivery/ci/')) {
      return refuse('Demo mode — the sample project has no CI runs to show.')
    }
    if (path === '/api/delivery/deploy/action') {
      return refuseSoft('Demo mode — deployments run from your own machine. The sample project has no deployment targets.')
    }
    if (path.startsWith('/api/delivery/deploy/')) {
      return refuse('Demo mode — the sample project has no deployment targets.')
    }

    /* Everything else under /api/: a clean demo refusal, never a
     * hang or a stack trace. Writes that would change a real
     * project (project creation, packs, plans, MCP servers,
     * dispatches, provider saves) all land here or in the cases
     * above. */
    if (method === 'GET') return ok({ ok: false, error: DEMO_REFUSAL, demo: true })
    return refuse()
  }
}

/** Stream replay steps as SSE frames (`data: {…}\n\n`, the wire
 * shape lib/api's chatStream parses), honouring each step's delay.
 * A patch step emits nothing — it mutates the fixture instead. */
function sseReplayStream(steps: DemoStep[], applyPatch: (step: Extract<DemoStep, { patch: unknown }>) => void): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  let cancelled = false
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const step of steps) {
        if (cancelled) return
        if (step.delayMs > 0) await new Promise(r => setTimeout(r, step.delayMs))
        if (cancelled) return
        if ('patch' in step) { applyPatch(step as Extract<DemoStep, { patch: unknown }>); continue }
        controller.enqueue(enc.encode(`data: ${JSON.stringify(step.event)}\n\n`))
      }
      controller.close()
    },
    cancel() { cancelled = true },
  })
}

function contentTypeFor(p: string): string {
  if (p.endsWith('.html')) return 'text/html'
  if (p.endsWith('.js') || p.endsWith('.jsx') || p.endsWith('.ts') || p.endsWith('.tsx')) return 'text/javascript'
  if (p.endsWith('.css')) return 'text/css'
  if (p.endsWith('.json')) return 'application/json'
  if (p.endsWith('.md')) return 'text/markdown'
  return 'text/plain'
}

let installed = false

/** Wrap window.fetch so demo-mode API calls are answered by the
 * fixture handler. Called once from main.tsx before first render;
 * a no-op outside demo mode. */
export function installDemoTransport(): void {
  if (installed || !isDemoMode() || typeof window === 'undefined') return
  installed = true
  const handler = createDemoHandler(FIXTURE_DATA, window.location.origin)
  const original = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const bodyText = typeof init?.body === 'string' ? init.body : undefined
    const reply = await handler(method, url, bodyText).catch(() => null)
    if (!reply) return original(input, init)
    if (reply.stream) {
      return new Response(reply.stream, { status: reply.status, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
    }
    if (reply.text !== undefined) {
      return new Response(reply.text, { status: reply.status, headers: { 'Content-Type': reply.contentType ?? 'text/plain' } })
    }
    return new Response(JSON.stringify(reply.json ?? {}), { status: reply.status, headers: { 'Content-Type': 'application/json' } })
  }
}
