/**
 * generate-demo-fixture.ts — builds the demo's fixture data from
 * the repo's real sample project (projects/lumen).
 *
 * The Vercel demo (DESIGN: "ALE Demo") answers the editor UI's
 * API calls in the browser from this fixture. The fixture is NOT
 * hand-written: every payload below is produced by the same
 * server-side functions the real API handlers call, run against
 * projects/lumen, so the demo shows exactly what the real server
 * would say about this project. The output is a checked-in TS
 * module (src/ui/demo/fixtureData.ts) so the demo build needs no
 * server code; refresh it with:
 *
 *   npm install            (this repo)
 *   npx tsx scripts/generate-demo-fixture.ts [path-to-ale-checkout]
 *
 * Run it from a checkout of main so the recorded git state reads
 * as the project's own (branch main, clean tree). The one
 * deliberate deviation from a raw server dump: the git log is
 * scoped to the project folder (as it would look if lumen were
 * its own repo), and the branch/worktree lists are trimmed to
 * the current branch — a fixture generated inside a working
 * multi-branch repo would otherwise leak that repo's local
 * branch list into the sample project's demo.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { setFsRoot } from '../src/launcher.js'
import { classifyProject } from '../src/projectDetect.js'
import { readProjectConfig, isDesignated } from '../src/projectConfig.js'
import { AGENT_SETTINGS_DEFAULTS } from '../src/agentSettings.js'
import { getFeatureGraph, graphRollup, lintGraph, gitHeadSync, gitCommitsBehind } from '../src/features/features.js'
import { reconcileGraph } from '../src/features/reconcile.js'
import { getDesignGuide } from '../src/design/designGuide.js'
import { getDesignGraph, deriveDesignGraph, designReport } from '../src/design/designGraph.js'
import { loadDesignPacks } from '../src/design/designPacks.js'
import { getArchitecture, getArchitectureGuide, checkArchitecture } from '../src/architecture/architecture.js'
import { loadArchPacks } from '../src/architecture/archPacks.js'
import { deriveTechStack } from '../src/techstack/techStack.js'
import { deriveConfigInventory } from '../src/configregistry/configRegistry.js'
import { resolveCrossLinks } from '../src/facetLinks/crossLinks.js'
import { runFacetCriteria, type FacetCriteriaId } from '../src/facetLinks/facetCriteria.js'
import { getUserFlowGraph, userFlowCounts } from '../src/userflows/userflows.js'
import { listPlans, getActivePlan } from '../src/plans/plans.js'
import { gitStatus, gitBranches, gitOut, parseGitLog } from '../src/delivery/git.js'
import { testsOverview } from '../src/delivery/testRun.js'
import { latestRun, readTestRuns, flakyTestKeys } from '../src/delivery/testStore.js'
import { deliverySummary } from '../src/delivery/summary.js'
import { ciOverview } from '../src/delivery/ci.js'
import { ALL_CI_PLUGINS } from '../src/delivery/ciPlugins.js'
import { targetViews, readDeployments } from '../src/delivery/deploy.js'
import { ALL_DEPLOY_PLUGINS } from '../src/delivery/deployPlugins.js'
import { readDeliverySettings } from '../src/delivery/checkpoints.js'
import { loadCatalog, entryEnabled, entrySummary } from '../src/catalog/catalog.js'
import { loadPacks, packSummary } from '../src/catalog/packs.js'
import { loadTemplates } from '../src/catalog/templates.js'
import { skillsState } from '../src/skills/skillsApi.js'
import { DEFAULT_MCP_BUDGET, DEFAULT_MCP_SETTINGS } from '../src/mcp/mcpStore.js'
import { CONNECTOR_CATALOG } from '../src/mcp/connectorCatalog.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const aleRoot = path.resolve(process.argv[2] ?? repoRoot)
const lumenRoot = path.join(aleRoot, 'projects', 'lumen')
if (!fs.existsSync(lumenRoot)) throw new Error(`sample project not found at ${lumenRoot}`)

setFsRoot(lumenRoot)

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: aleRoot, encoding: 'utf-8' }).trim()
}

/* The file walk — the same rules as GET /api/fs/list. */
function walkProject() {
  const files: string[] = []
  const dirs: string[] = []
  const mtimes: Record<string, number> = {}
  const contents: Record<string, string> = {}
  const walk = (dir: string, base = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.chrome-data') || entry.name === 'node_modules' || entry.name === '.vite' || entry.name === 'dist') continue
      const full = path.join(dir, entry.name)
      const rel = path.join(base, entry.name)
      const asPath = '/' + rel.replace(/\\/g, '/')
      if (entry.isDirectory()) { dirs.push(asPath); walk(full, rel) }
      else {
        files.push(asPath)
        try { mtimes[asPath] = fs.statSync(full).mtimeMs } catch { /* raced */ }
        contents[asPath] = fs.readFileSync(full, 'utf-8')
      }
    }
  }
  walk(lumenRoot)
  return { files, dirs, mtimes, contents }
}

async function main() {
  const { files, dirs, mtimes, contents } = walkProject()
  const setup = classifyProject(lumenRoot)
  const projectConfig = readProjectConfig(lumenRoot)
  const graph = getFeatureGraph(lumenRoot)
  const storedDesignGraph = getDesignGraph(lumenRoot)
  let derivedDesignGraph: ReturnType<typeof deriveDesignGraph> | null = null
  try { derivedDesignGraph = deriveDesignGraph(lumenRoot) } catch { derivedDesignGraph = null }

  const catalog = loadCatalog()
  const packsFile = loadPacks()

  const criteriaFacets: FacetCriteriaId[] = ['architecture', 'graphic-design', 'configuration', 'tech-stack', 'delivery']
  const facetCriteria: Record<string, unknown> = {}
  for (const facet of criteriaFacets) {
    try { facetCriteria[facet] = { ok: true, run: runFacetCriteria(facet, lumenRoot) } }
    catch (e) { facetCriteria[facet] = { ok: false, error: e instanceof Error ? e.message : String(e) } }
  }

  // Git: real status/branches from the project's repo; the log is
  // scoped to the project folder (see the header note).
  const status = await gitStatus(lumenRoot)
  const logOut = await gitOut(lumenRoot, [
    'log', '--format=%H\x1f%h\x1f%an\x1f%aI\x1f%s\x1f%D\x1e', '-n', '60', '--', '.',
  ])
  const allBranches = await gitBranches(lumenRoot)
  const branches = allBranches.filter(b => b.current || b.name === 'main' || b.name === 'origin/main')
  const head = git(['rev-parse', 'HEAD'])

  const plans = listPlans(lumenRoot)
  const activePlan = getActivePlan(lumenRoot)
  const userFlowGraph = getUserFlowGraph(lumenRoot)
  const tests = testsOverview(lumenRoot)

  const fixture = {
    meta: {
      projectId: 'lumen',
      generatedAt: new Date().toISOString(),
      sourceCommit: head,
      sourceBranch: git(['branch', '--show-current']) || 'main',
      note: 'Generated by scripts/generate-demo-fixture.ts from projects/lumen — see DEMO.md.',
    },
    files: { files, dirs, mtimes, root: 'lumen' },
    contents,
    projects: {
      ok: true,
      workspace: 'projects',
      active: 'lumen',
      projects: [{ id: 'lumen', root: 'lumen', setup }],
    },
    projectConfig: { ok: true, config: projectConfig, designated: isDesignated(projectConfig) },
    workflow: {
      ok: true,
      mode: 'files',
      deviceTarget: 'desktop',
      accepted: true,
      patches: [],
      selfMode: false,
      selfCheck: null,
      searchBackend: 'off',
      searchOptions: [
        { id: 'provider', label: 'Provider web search', available: false },
        { id: 'brave', label: 'Brave Search', available: false },
      ],
      plan: activePlan ? { slug: activePlan.slug, title: activePlan.title, status: activePlan.status, level: activePlan.level } : null,
      previewMark: 'index.html',
      previewLocation: null,
    },
    appSettings: { ok: true, uiPrefs: null, editorTheme: null, setupDone: true },
    agentSettings: { ...AGENT_SETTINGS_DEFAULTS },
    connections: {
      ok: true,
      connections: [{
        id: 'demo', presetId: 'demo', name: 'Demo', baseUrl: '', model: 'demo-replay',
        keyLast4: 'demo', verifiedModels: [{ id: 'demo-replay', modalities: ['text'] }],
        status: 'verified', updatedAt: 0, hasKey: true, active: true,
      }],
      activeId: 'demo',
      modalityDefaults: { text: { connectionId: 'demo', model: 'demo-replay' } },
    },
    features: { ok: true, graph, rollup: graph ? graphRollup(graph) : null },
    featuresCurrency: {
      ok: true,
      sync: graph?.sync ?? null,
      head: gitHeadSync(lumenRoot),
      behind: graph?.sync ? gitCommitsBehind(lumenRoot, graph.sync.commit) : null,
    },
    featuresLint: { ok: true, problems: graph ? lintGraph(graph) : [] },
    featuresReconcile: graph
      ? { ok: true, ...reconcileGraph(graph, lumenRoot) }
      : { ok: true, drift: [], checked: 0 },
    designGuide: { ok: true, guide: getDesignGuide(lumenRoot) },
    designGraphStored: { ok: true, graph: storedDesignGraph, report: storedDesignGraph ? designReport(lumenRoot, storedDesignGraph) : null },
    designDerived: { ok: true, graph: derivedDesignGraph, report: derivedDesignGraph ? designReport(lumenRoot, derivedDesignGraph) : null },
    designPacks: { ok: true, packs: loadDesignPacks() },
    architecture: {
      ok: true,
      declaration: getArchitecture(lumenRoot),
      guide: getArchitectureGuide(lumenRoot),
      report: checkArchitecture(lumenRoot),
    },
    archPacks: { ok: true, packs: loadArchPacks() },
    techStack: { ok: true, stack: deriveTechStack(lumenRoot) },
    configInventory: { ok: true, inventory: deriveConfigInventory(lumenRoot) },
    crossLinks: { ok: true, links: resolveCrossLinks(lumenRoot) },
    facetCriteria,
    userflows: { ok: true, graph: userFlowGraph, counts: userFlowGraph ? userFlowCounts(userFlowGraph) : null },
    plans: {
      ok: true,
      plans: plans.map(doc => ({
        slug: doc.slug, title: doc.title, kind: doc.kind, level: doc.level,
        status: doc.status, updatedAt: doc.updatedAt,
        questions: doc.questions.length,
        tasks: doc.tasks.length,
        tasksDone: doc.tasks.filter(t => t.status === 'done').length,
      })),
      active: activePlan?.slug ?? null,
    },
    catalog: {
      ok: true,
      packs: packsFile.packs.map(packSummary),
      components: catalog.components.filter(e => entryEnabled(e, false)).map(entrySummary),
      templates: loadTemplates().templates,
      designPacks: loadDesignPacks().map(p => ({ id: p.id, kind: p.kind, name: p.name, version: p.version, description: p.description, contents: p.contents })),
      archPacks: loadArchPacks().map(p => ({ id: p.id, kind: p.kind, name: p.name, version: p.version, description: p.description, contents: p.contents })),
    },
    skillsState: skillsState(),
    mcpState: {
      config: { version: 1, budget: DEFAULT_MCP_BUDGET, settings: { ...DEFAULT_MCP_SETTINGS }, servers: [] },
      counts: { enabled: 0, total: 0 },
    },
    mcpCatalog: { ok: true, entries: CONNECTOR_CATALOG, installed: {} },
    deliveryGitStatus: { ok: true, status },
    deliveryGitLog: { ok: true, entries: logOut === null ? [] : parseGitLog(logOut) },
    deliveryGitBranches: { ok: true, branches },
    deliveryGitWorktrees: {
      ok: true,
      worktrees: [{ path: 'lumen', head, branch: status.branch ?? 'main', detached: false, bare: false, current: true }],
    },
    deliveryTests: {
      ok: true,
      runners: tests.runners,
      suites: tests.suites,
      latestRun: latestRun(lumenRoot),
      runCount: readTestRuns(lumenRoot).runs.length,
      flaky: flakyTestKeys(lumenRoot),
    },
    deliverySummary: { ok: true, summary: await deliverySummary(lumenRoot) },
    deliveryCi: { ok: true, overview: await ciOverview(lumenRoot, ALL_CI_PLUGINS) },
    deliveryDeployTargets: { ok: true, targets: await targetViews(lumenRoot, ALL_DEPLOY_PLUGINS), history: readDeployments(lumenRoot) },
    deliverySettings: { ok: true, settings: readDeliverySettings(lumenRoot) },
    musecodeAvailability: {
      ok: true,
      availability: { available: false, version: null, versionLine: null, binPath: null },
    },
    musecodeHealth: {
      ok: true,
      health: {
        availability: { available: false, version: null, versionLine: null, binPath: null },
        signIn: { state: 'none-found', detail: 'Demo mode — Muse Code runs on your own machine, not in the browser.' },
        sandboxProbe: null,
      },
    },
    researchConfig: { ok: true, brave: { configured: false } },
    pluginEnsure: {
      ok: true,
      ensure: { state: 'standalone', detail: 'Demo mode — the preview shows the sample project’s own static build.' },
    },
    pageStatus: { ok: true, clients: null },
  }

  const out = path.join(repoRoot, 'src', 'ui', 'demo', 'fixtureData.ts')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const body = [
    '/**',
    ' * GENERATED by scripts/generate-demo-fixture.ts — do not edit by hand.',
    ' * Every payload was produced by the server\'s own derivation',
    ' * functions run against projects/lumen (see DEMO.md for how to',
    ' * refresh). The demo transport (src/ui/lib/demoTransport.ts)',
    ' * serves these in the browser.',
    ' */',
    `export const FIXTURE_DATA: Record<string, any> = ${JSON.stringify(fixture, null, 1)}`,
    '',
  ].join('\n')
  fs.writeFileSync(out, body)
  console.log(`fixture written: ${out} (${(body.length / 1024).toFixed(0)} KB, ${files.length} files, source ${head.slice(0, 7)} on ${fixture.meta.sourceBranch})`)
}

void main()
