const API = import.meta.env?.VITE_API_URL ?? ''

export function staticPreviewUrl(): string {
  return API.replace(/\/*$/, '') + '/projects/'
}

export async function listFiles() {
  const r = await fetch(`${API}/api/fs/list`)
  return r.json() as Promise<{files: string[], dirs?: string[], mtimes?: Record<string, number>, root: string}>
}

async function fsPost(url: string, body: unknown) {
  const r = await fetch(`${API}${url}`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(body)
  })
  return r.json() as Promise<{ok: boolean, error?: string, [k: string]: unknown}>
}
export function renameFsPath(from: string, to: string) {
  return fsPost('/api/fs/rename', { from, to })
}
export function deleteFsPath(path: string, recursive = false) {
  return fsPost('/api/fs/delete', { path, recursive })
}
export function mkdirFsPath(path: string) {
  return fsPost('/api/fs/mkdir', { path })
}
export async function readFile(path: string) {
  const r = await fetch(`${API}/api/fs/read?path=${encodeURIComponent(path)}`)
  return r.json() as Promise<{path: string, content?: string, error?: string}>
}
export async function writeFile(path: string, content: string) {
  const r = await fetch(`${API}/api/fs/write`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({path, content})
  })
  return r.json()
}

export async function bundleJsx(path: string) {
  const r = await fetch(`${API}/api/jsx/bundle`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ path })
  })
  return r.json() as Promise<{ ok: boolean, code?: string, error?: string }>
}
/** URL that serves a project file's raw bytes (the image editor's
 * load path — /projects/ static serving is shadowed by the UI's
 * SPA fallback when the UI runs from source). */
export function binaryFileUrl(path: string) {
  return `${API}/api/fs/read-binary?path=${encodeURIComponent(path)}`
}
/** Write binary content (base64) — the image editor's save path. */
export async function writeBinaryFile(path: string, base64: string) {
  const r = await fetch(`${API}/api/fs/write-binary`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({path, base64})
  })
  const data = await r.json() as { ok?: boolean, error?: string }
  if (!r.ok || data.ok === false) throw new Error(data.error || `write failed (${r.status})`)
  return data
}
export interface LauncherConfig {
  ok: boolean
  hasApiKey: boolean
  hasOpenAiKey: boolean
  model: string
  modelName: string
  modelId?: string
  providerId?: string | null
  providerName?: string | null
  contextWindow?: number
  baseUrl: string
  launcherUrl: string
  previewStaticUrl: string
  previewHmrUrl: string
  workspace?: string
  activeProject?: string
  fsRoot?: string
  playwrightPool?: boolean
  liveTarget?: 'bridge' | 'pool'
}

/** Server-side folder classification (src/projectDetect.ts). Optional
 * so older launchers' payloads still parse; treat missing as 'ready'. */
export interface ProjectSetupInfo {
  kind: 'ready' | 'html' | 'loose' | 'empty'
  entry: string | null
  htmlFiles: string[]
  stack: string
  hasPackageJson: boolean
}

export interface ProjectInfo { id: string, root: string, setup?: ProjectSetupInfo }

export async function listProjects() {
  const r = await fetch(`${API}/api/projects`)
  return r.json() as Promise<{ ok: boolean, workspace: string, active: string, projects: ProjectInfo[] }>
}

export async function selectProject(id: string) {
  const r = await fetch(`${API}/api/projects/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  const data = await r.json() as { ok: boolean, active?: string, root?: string, setup?: ProjectSetupInfo, projects?: ProjectInfo[], error?: string }
  if (!r.ok || data.ok === false) throw new Error(data.error || `Select failed (${r.status})`)
  return data
}

export async function createProject(id: string) {
  const r = await fetch(`${API}/api/projects/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  const data = await r.json() as { ok: boolean, active?: string, root?: string, projects?: ProjectInfo[], installError?: string, error?: string }
  if (!r.ok || data.ok === false) throw new Error(data.error || `Create failed (${r.status})`)
  return data
}

export async function getConfig() {
  const r = await fetch(`${API}/api/config`)
  return r.json() as Promise<LauncherConfig>
}

/* ── Plugin auto-ensure (bridge guarantee) ────────────────────── */

export type PluginEnsureStateName = 'registered' | 'added' | 'missing-declined' | 'cannot' | 'not-vite' | 'standalone'

export interface PluginEnsureInfo {
  state: PluginEnsureStateName
  configFile?: string
  detail?: string
  /** The exact lines to add by hand when the auto-edit can't. */
  snippet?: string
}

export async function getPluginEnsure(): Promise<PluginEnsureInfo | null> {
  try {
    const r = await fetch(`${API}/api/plugin-ensure`)
    const data = await r.json() as { ok: boolean, ensure?: PluginEnsureInfo }
    return data.ensure ?? null
  } catch { return null }
}

async function postPluginEnsure(path: 'remove' | 'enable'): Promise<{ ok: boolean, ensure?: PluginEnsureInfo, detail?: string }> {
  const r = await fetch(`${API}/api/plugin-ensure/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  return r.json() as Promise<{ ok: boolean, ensure?: PluginEnsureInfo, detail?: string }>
}

export function postPluginEnsureRemove() { return postPluginEnsure('remove') }
export function postPluginEnsureEnable() { return postPluginEnsure('enable') }

export interface PageStatusInfo {
  /** Live page-bridge clients the launcher's status route can see,
   * or null when it could not produce a count (nothing answered its
   * relay to the page's own bridge registry). Null means "no page
   * connected" to callers — never an error worth surfacing. */
  clients: number | null
}

/** Bridge status from the LAUNCHER origin only. The route answers
 * from the launcher's own registry when it has clients and otherwise
 * relays the page server's count server-side; either way the UI
 * never talks to the page's origin for this. */
export async function getPageStatus(): Promise<PageStatusInfo> {
  try {
    const r = await fetch(`${API}/api/page/status`)
    const data = await r.json() as { ok?: boolean, clients?: unknown }
    return { clients: data.ok !== false && typeof data.clients === 'number' ? data.clients : null }
  } catch { return { clients: null } }
}

/* ── Setup wizard (Open slice C) ─────────────────────────────── */

export type ProjectTemplateId = 'seed-app' | 'blank-page' | 'article' | 'pricing'

export async function applyProjectTemplate(template: ProjectTemplateId) {
  const r = await fetch(`${API}/api/projects/apply-template`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template }),
  })
  const data = await r.json() as { ok: boolean, setup?: ProjectSetupInfo, projects?: ProjectInfo[], installed?: boolean, installError?: string, error?: string }
  if (!r.ok || data.ok === false) throw new Error(data.error || `Template failed (${r.status})`)
  return data
}

export async function convertToPage(path: string) {
  const r = await fetch(`${API}/api/projects/convert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  const data = await r.json() as { ok: boolean, created?: string, setup?: ProjectSetupInfo, projects?: ProjectInfo[], error?: string }
  if (!r.ok || data.ok === false) throw new Error(data.error || `Convert failed (${r.status})`)
  return data
}

export interface ProviderModels {
  ok: boolean
  provider?: string
  providerName?: string
  baseUrl?: string
  models: string[]
  suggested?: string
  error?: string
}

export async function probeModels(input: { key?: string, baseUrl?: string } = {}) {
  const r = await fetch(`${API}/api/config/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await r.json() as ProviderModels
  if (!r.ok || data.ok === false) throw new Error(data.error || `Could not list models (${r.status})`)
  return data
}

/* ── Provider connections (BYOK) ─────────────────────────────────────── */

export interface TaggedModel {
  id: string
  modalities: ('text' | 'image' | 'video' | 'audio')[]
}

export interface ConnectionPricing { input: number; output: number }

export interface ConnectionInfo {
  id: string
  presetId: string
  name: string
  baseUrl: string
  model: string
  keyLast4: string
  verifiedModels: TaggedModel[]
  status: 'verified' | 'configured' | 'failed'
  updatedAt: number
  hasKey: boolean
  active: boolean
  pricing?: ConnectionPricing
}

export interface ModalityDefault {
  connectionId: string
  model: string
}

export interface ConnectionsPayload {
  ok: boolean
  connections: ConnectionInfo[]
  activeId: string | null
  modalityDefaults: Partial<Record<'text' | 'image' | 'video' | 'audio', ModalityDefault>>
}

export type ProbeErrorKind = 'invalid_key' | 'no_credit' | 'unreachable' | 'no_models' | 'unknown'

export interface ConnectionProbe {
  ok: boolean
  provider?: string
  providerName?: string
  baseUrl?: string
  models?: string[]
  tagged?: TaggedModel[]
  suggested?: string
  errorKind?: ProbeErrorKind
  error?: string
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(`${API}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json() as T & { error?: string }
  if (!r.ok) throw new Error((data as { error?: string }).error || `Request failed (${r.status})`)
  return data
}

export async function getConnections() {
  const r = await fetch(`${API}/api/connections`)
  return r.json() as Promise<ConnectionsPayload>
}

export async function probeConnection(input: { key?: string, baseUrl?: string, presetId?: string, connectionId?: string }) {
  // Probe failures are data, not exceptions: the card renders them by kind.
  const r = await fetch(`${API}/api/connections/probe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return r.json() as Promise<ConnectionProbe>
}

export async function saveConnection(input: {
  id?: string, presetId: string, name?: string, baseUrl?: string,
  model: string, key?: string, verifiedModels?: TaggedModel[],
  pricing?: ConnectionPricing | null,
}) {
  return postJson<ConnectionsPayload & { saved: string }>('/api/connections', input)
}

export async function deleteConnection(id: string) {
  return postJson<ConnectionsPayload>('/api/connections/delete', { id })
}

export async function activateConnection(id: string) {
  return postJson<ConnectionsPayload>('/api/connections/activate', { id })
}

export async function testConnection(id: string) {
  return postJson<ConnectionsPayload & { probe: { ok: boolean, errorKind?: ProbeErrorKind, error?: string } }>('/api/connections/test', { id })
}

export async function saveModalityDefaults(defaults: ConnectionsPayload['modalityDefaults']) {
  return postJson<ConnectionsPayload>('/api/connections/modalities', { defaults })
}

export interface BraveStatus {
  configured: boolean
  keyLast4?: string
}

export async function getResearchConfig() {
  const r = await fetch(`${API}/api/research/config`)
  return r.json() as Promise<{ ok: boolean, brave: BraveStatus }>
}

export async function saveBraveKey(apiKey: string) {
  return postJson<{ ok: boolean, brave: BraveStatus }>('/api/research/brave', { apiKey })
}

export async function testBraveKey(apiKey?: string) {
  return postJson<{ ok: boolean, resultCount?: number, error?: string }>('/api/research/brave/test', { apiKey })
}

export async function setPlaywrightPool(enabled: boolean) {
  const r = await fetch(`${API}/api/config/pool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  const data = await r.json() as LauncherConfig & { saved?: boolean, error?: string }
  if (!r.ok) throw new Error(data.error || `Save failed (${r.status})`)
  return data
}

export async function saveAiConfig(input: { key?: string, baseUrl?: string, model?: string }) {
  const r = await fetch(`${API}/api/config/key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await r.json() as LauncherConfig & { saved?: boolean, error?: string }
  if (!r.ok) throw new Error(data.error || `Save failed (${r.status})`)
  return data
}

/** Clear the server-side chat threads (Mastra Memory) for every project
 * in the workspace — the server half of Settings → Clear saved chats. */
export function clearServerChatThreads() {
  return fsPost('/api/chat/threads/clear', {})
}

/** Clear this chat's server-side history (Mastra thread + cached
 * OpenCode session for the active project) — the server half of the
 * chat Clear button. The visible log clears locally regardless. */
export function clearChatHistory() {
  return fsPost('/api/chat/clear', {})
}

export async function chat(messages: {role:string, content:string}[]) {
  const r = await fetch(`${API}/api/chat`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({messages})
  })
  return r.json()
}

export type { TurnUsage } from './chatSession'
export type ChatStreamEvent =
  | { type: 'status'; text: string }
  | { type: 'workflow'; mode: ChatWorkflow; reason?: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; detail: string }
  | { type: 'tool-delta'; id: string; name: string; text: string }
  | { type: 'tool-result'; id: string; name: string; ok: boolean; detail: string }
  | { type: 'text-delta'; text: string }
  | { type: 'skills'; skills: { name: string, via: string }[] }
  | { type: 'error'; error: string }
  | { type: 'done'; usage?: import('./chatSession').TurnUsage | null; model?: string }

export type ChatWorkflow = 'files' | 'sketch'

export type DeviceTarget = 'phone' | 'tablet' | 'desktop'

export interface SelfCheck {
  at: number
  running: boolean
  tscOk?: boolean
  testsOk?: boolean
  testsSummary?: string
  tail?: string
}

export type SearchBackendId = 'provider' | 'brave' | 'off'

export interface SearchOption {
  id: 'provider' | 'brave'
  label: string
  available: boolean
}

export interface WorkflowSnapshot {
  ok: boolean
  mode: ChatWorkflow
  deviceTarget: DeviceTarget
  accepted: boolean
  patches: { id: string, selector: string, op: string, ok: boolean, detail: string }[]
  /** Self mode (§L): true while the editor itself is the workspace. */
  selfMode?: boolean
  selfCheck?: SelfCheck | null
  /** Web search (§N): the resolved backend + available options for the header setting. */
  searchBackend?: SearchBackendId
  searchOptions?: SearchOption[]
  /** Planning (§O): the active plan's summary, for the header pill. */
  plan?: PlanSummary | null
  /** Preview (Open slice B): the marked file + drifted location. */
  previewMark?: string | null
  previewLocation?: string | null
  error?: string
}

/* ── Plans (§O) ─────────────────────────────────────────── */

export interface PlanQuestion {
  id: string
  label: string
  control: 'choice' | 'text'
  options?: string[]
  default: string
  answer?: string
  note?: string
  revised?: boolean
}

export interface PlanConsideration {
  id: string
  title: string
  text: string
  note?: string
  revised?: boolean
}

export interface PlanTask {
  id: string
  text: string
  status: 'todo' | 'doing' | 'done'
  detail?: string
}

export interface PlanDoc {
  slug: string
  title: string
  kind: 'feature' | 'app' | 'install' | 'fix' | 'refactor'
  level: 1 | 2 | 3
  status: 'draft' | 'approved' | 'executing' | 'done'
  goal: string
  mutability?: { goal: number; steps: number; methods: number }
  considerations: PlanConsideration[]
  questions: PlanQuestion[]
  tasks: PlanTask[]
  review?: { summary: string; at: number }
  createdAt: number
  updatedAt: number
}

export interface PlanSummary {
  slug: string
  title: string
  status: string
  level: number
}

export async function getPlans() {
  const r = await fetch(`${API}/api/plans`)
  return r.json() as Promise<{ ok: boolean, plans: (PlanSummary & { kind: string, questions: number, tasks: number, tasksDone: number, updatedAt: number })[], active: string | null }>
}

export async function createPlan(input: { goal: string, kind: string, level: number, title?: string }) {
  return postJson<{ ok: boolean, plan?: PlanDoc, error?: string }>('/api/plans', input)
}

export async function planFromGraph(input: { nodeId?: string, packId?: string }) {
  return postJson<{ ok: boolean, plan?: PlanDoc, skippedBuilt?: number, error?: string }>('/api/plans/from-graph', input)
}

/* ── Feature graph (ai-features/) ─────────────────────────── */

export type FeatureNodeStatus = 'proposed' | 'planned' | 'building' | 'done' | 'verified' | 'blocked' | 'dropped' | 'suggested'

/** Dogfood provenance on a feature node derivation created —
 * mirrors src/features/features.ts SuggestionProvenance. */
export interface SuggestionProvenanceItem {
  source: 'dogfood'
  kind: 'fix' | 'coverage'
  stepId: string
  stepName: string
  state?: 'blocked' | 'error'
  blockKind?: string
  evidence?: string
  runId?: string
  at: string
}

export interface FeatureParamItem {
  name: string
  type: 'text' | 'choice' | 'boolean' | 'color' | 'number'
  options?: string[]
  default?: string
}

export interface FeatureNodeItem {
  id: string
  name: string
  kind: 'region' | 'feature' | 'screen' | 'component' | 'setting' | 'data' | 'service'
  status: FeatureNodeStatus
  parent?: string
  component?: string
  template?: string
  pack?: string
  derivedFrom?: string
  params?: FeatureParamItem[]
  values?: Record<string, string>
  note?: string
  suggestion?: SuggestionProvenanceItem
}

export interface FeatureEdgeItem { from: string, to: string, type: string }

export interface PendingLinkItem {
  pack: string
  from: string
  type: string
  role: string
  match: string
  direction: 'out' | 'in'
}

export interface FeatureGraphItem {
  title: string
  nodes: FeatureNodeItem[]
  edges: FeatureEdgeItem[]
  pendingLinks?: PendingLinkItem[]
  sync?: { commit: string | null, at: number }
}

export interface GraphCurrency {
  ok: boolean
  sync: { commit: string | null, at: number } | null
  head: string | null
  behind: number | null
}

export async function getFeatureCurrency(): Promise<GraphCurrency> {
  const r = await fetch(`${API}/api/features/currency`)
  return r.json() as Promise<GraphCurrency>
}

export interface FeatureRollup { total: number, built: number, blocked: number, pct: number }

/** The design guide record (Facets design §3.3), as stored in
 * ai-design/guide.json. Every field optional — a partial guide
 * is a real guide. */
export interface DesignGuideItem {
  version: 1
  name?: string
  description?: string
  principles?: string
  tokens?: { source?: 'css-variables' | 'tokens-json' | 'tailwind', file?: string, groups?: string[] }
  typography?: {
    families: { name: string, role?: string, source?: string }[]
    scale: { step: string, size: string, weight?: string, lineHeight?: string, role?: string }[]
  }
  layout?: {
    grid?: { columns?: number, gutter?: string, margin?: string }
    breakpoints: { name: string, minWidth: number }[]
    spacingBase?: number
  }
  icons?: { sets: { name: string, source?: string, format?: string }[], usage?: string }
  components?: { name: string, note?: string }[]
  voice?: string
  motion?: string
  provenance?: string
}

export async function getDesignGuide() {
  const r = await fetch(`${API}/api/design/guide`)
  return r.json() as Promise<{ ok: boolean, guide: DesignGuideItem | null, error?: string }>
}

export async function saveDesignGuide(guide: DesignGuideItem) {
  return postJson<{ ok: boolean, guide: DesignGuideItem, error?: string }>('/api/design/guide', { guide })
}

/** The derived design graph (Facets design §3.5) and its report. */
export interface DesignGraphItem {
  version: 1
  derivedAt: number
  source?: { kind: 'css-variables' | 'tokens-json' | 'tailwind', file: string }
  nodes: { id: string, kind: string, name: string, value?: string, group?: string, file?: string, note?: string }[]
  edges: { from: string, to: string, type: string }[]
}

export interface DesignReportItem {
  unusedTokens: string[]
  hardcoded: { value: string, count: number, files: string[] }[]
  contrastFlags: { background: string, text: string, ratio: number }[]
  unseenTypeSteps: string[]
  componentsMissingFromGuide: string[]
  guideComponentsNotFound: string[]
}

export async function getDesignGraph() {
  const r = await fetch(`${API}/api/design/graph`)
  return r.json() as Promise<{ ok: boolean, graph: DesignGraphItem | null, report: DesignReportItem | null, error?: string }>
}

export async function deriveDesignGraph() {
  return postJson<{ ok: boolean, graph: DesignGraphItem, report: DesignReportItem, error?: string }>('/api/design/derive', {})
}

/** Write one token back to its source file (§3.4); the response
 * carries the re-derived graph so previews re-render. */
export async function setDesignTokenValue(name: string, value: string) {
  return postJson<{ ok: boolean, graph: DesignGraphItem, report: DesignReportItem, error?: string }>('/api/design/token', { name, value })
}

export async function getFeatures() {
  const r = await fetch(`${API}/api/features`)
  return r.json() as Promise<{
    ok: boolean,
    graph: FeatureGraphItem | null,
    rollup: { overall: FeatureRollup, regions: { node: FeatureNodeItem, rollup: FeatureRollup }[] } | null,
    error?: string,
  }>
}

export async function setFeatureNodeStatus(id: string, status: FeatureNodeStatus) {
  return postJson<{ ok: boolean, error?: string }>('/api/features/status', { id, status })
}

export async function setFeatureParam(id: string, name: string, value: string) {
  return postJson<{ ok: boolean, configFile?: string, error?: string }>('/api/features/param', { id, name, value })
}

export async function addFeatureNode(input: { name: string, kind: string, parentId?: string }) {
  return postJson<{ ok: boolean, node?: FeatureNodeItem, error?: string }>('/api/features/nodes', input)
}

export async function editFeatureNode(id: string, patch: { name?: string, parentId?: string | null }) {
  return postJson<{ ok: boolean, node?: FeatureNodeItem, error?: string }>('/api/features/edit', { id, ...patch })
}

export async function removeFeatureNode(id: string, mode: 'lift' | 'cascade') {
  return postJson<{ ok: boolean, removed?: unknown[], lifted?: number, error?: string }>('/api/features/remove-node', { id, mode })
}

export async function linkFeatures(from: string, to: string, type: string) {
  return postJson<{ ok: boolean, totalEdges?: number, error?: string }>('/api/features/links', { from, to, type })
}

export async function unlinkFeatures(from: string, to: string, type: string) {
  return postJson<{ ok: boolean, totalEdges?: number, error?: string }>('/api/features/unlinks', { from, to, type })
}

export interface DeriveSuggestionsResult {
  ok: boolean
  created?: FeatureNodeItem[]
  withdrawn?: { id: string, name: string }[]
  skippedDismissed?: number
  alreadyLive?: number
  suggestions?: FeatureNodeItem[]
  rollup?: FeatureRollup
  error?: string
}

export async function deriveFeatureSuggestions() {
  return postJson<DeriveSuggestionsResult>('/api/features/suggestions/derive', {})
}

export async function acceptFeatureSuggestion(id: string, regionId?: string | null) {
  return postJson<{ ok: boolean, node?: FeatureNodeItem, rollup?: FeatureRollup, error?: string }>(
    '/api/features/suggestions/accept',
    regionId === undefined ? { id } : { id, regionId },
  )
}

export async function dismissFeatureSuggestion(id: string) {
  return postJson<{ ok: boolean, rollup?: FeatureRollup, error?: string }>('/api/features/suggestions/dismiss', { id })
}

export interface GraphProblemItem { kind: string, message: string, nodeId?: string }

export async function getFeatureLint() {
  const r = await fetch(`${API}/api/features/lint`)
  return r.json() as Promise<{ ok: boolean, problems: GraphProblemItem[] }>
}

export interface DriftItem { nodeId: string, node: string, binding: string, problem: string }

export async function getFeatureReconcile() {
  const r = await fetch(`${API}/api/features/reconcile`)
  return r.json() as Promise<{ ok: boolean, drift: DriftItem[], checked: number }>
}

/* ── User flow graph (ai-user-flows/) ─────────────────────── */

export type UserFlowStepType = 'screen' | 'action' | 'outcome'
export type UserFlowEdgeType = 'navigates-to' | 'submits' | 'branches-on' | 'requires'
export type VerificationState = 'untested' | 'ok' | 'blocked' | 'error'
export type BlockKind = 'unreachable' | 'missing-affordance' | 'console-error' | 'dead-end' | 'state-blocked'

export interface StepBlockItem {
  kind: BlockKind
  evidence?: string
  runId?: string
  at: string
}

export interface UserFlowJourneyItem { id: string, name: string, note?: string }

export interface UserFlowStepItem {
  id: string
  name: string
  type: UserFlowStepType
  journey: string
  note?: string
  verification: { state: VerificationState, block?: StepBlockItem }
}

export interface UserFlowEdgeItem { from: string, to: string, type: UserFlowEdgeType }
export interface ExercisesLinkItem { step: string, feature: string }

export interface UserFlowGraphItem {
  title: string
  journeys: UserFlowJourneyItem[]
  steps: UserFlowStepItem[]
  edges: UserFlowEdgeItem[]
  exercises: ExercisesLinkItem[]
  sync?: { commit: string | null, at: number }
}

export interface UserFlowCountsItem {
  journeys: number
  steps: number
  ok: number
  blocked: number
  error: number
  untested: number
  verifiedPct: number
}

export async function getUserFlows() {
  const r = await fetch(`${API}/api/userflows`)
  return r.json() as Promise<{ ok: boolean, graph: UserFlowGraphItem | null, counts: UserFlowCountsItem | null, error?: string }>
}

/** Add a step; `journey` is a journey id or name — a name that
 * does not exist yet starts that journey (the store's rule). */
export async function addUserFlowStep(input: { name: string, type: UserFlowStepType, journey: string, note?: string }) {
  return postJson<{ ok: boolean, step?: UserFlowStepItem, journey?: { id: string, name: string }, totalSteps?: number, error?: string }>('/api/userflows/steps', input)
}

export async function editUserFlowStep(id: string, patch: { name?: string, type?: UserFlowStepType, journey?: string }) {
  return postJson<{ ok: boolean, step?: UserFlowStepItem, error?: string }>('/api/userflows/steps/edit', { id, ...patch })
}

/** Link two steps with a typed edge, or — type 'exercises' — a
 * step to the feature node it exercises (`to` is then a feature id). */
export async function linkUserFlows(from: string, to: string, type: UserFlowEdgeType | 'exercises') {
  return postJson<{ ok: boolean, totalEdges?: number, totalExercises?: number, error?: string }>('/api/userflows/links', { from, to, type })
}

export async function unlinkUserFlows(from: string, to: string, type: UserFlowEdgeType | 'exercises') {
  return postJson<{ ok: boolean, totalEdges?: number, totalExercises?: number, error?: string }>('/api/userflows/unlinks', { from, to, type })
}

export async function getPlan(slug: string) {
  const r = await fetch(`${API}/api/plans/${encodeURIComponent(slug)}`)
  return r.json() as Promise<{ ok: boolean, plan?: PlanDoc, error?: string }>
}

export async function draftPlan(slug: string) {
  return postJson<{ ok: boolean, plan?: PlanDoc, error?: string }>(`/api/plans/${encodeURIComponent(slug)}/draft`, {})
}

export async function patchPlan(slug: string, patch: Record<string, unknown>) {
  return postJson<{ ok: boolean, plan?: PlanDoc, error?: string }>(`/api/plans/${encodeURIComponent(slug)}`, patch)
}

export async function activatePlan(slug: string) {
  return postJson<{ ok: boolean, plan?: PlanDoc, error?: string }>(`/api/plans/${encodeURIComponent(slug)}/activate`, {})
}

export async function revisePlanItem(slug: string, target: 'question' | 'consideration', id: string) {
  return postJson<{ ok: boolean, plan?: PlanDoc, error?: string }>(`/api/plans/${encodeURIComponent(slug)}/revise`, { target, id })
}

export async function getWorkflow() {
  const r = await fetch(`${API}/api/workflow`)
  return r.json() as Promise<WorkflowSnapshot>
}

export interface ProjectConfig {
  /** The designated start page (Open slice B), root-relative .html. */
  entry?: string
  type?: string
  format?: 'app' | 'page'
  deviceTargets?: DeviceTarget[]
  defaultDeviceTarget?: DeviceTarget
  styleSet?: string
  features?: string[]
  appkit?: boolean
  planLevel?: 1 | 2 | 3
  planMutability?: number
  /** This project's Muse Code sandbox posture override; absent
   * means the device-wide default applies (lib/museSandbox). */
  museSandboxPosture?: 'unblocked' | 'sandboxed' | 'strict'
}

export async function getProjectConfig() {
  const r = await fetch(`${API}/api/project/config`)
  return r.json() as Promise<{ ok: boolean, config: ProjectConfig, designated: boolean }>
}

export async function postProjectConfig(patch: Record<string, unknown>) {
  const r = await fetch(`${API}/api/project/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return r.json() as Promise<{ ok: boolean, config: ProjectConfig, designated: boolean }>
}

export async function postWorkflow(body: { mode?: ChatWorkflow, action?: 'undo' | 'discard' | 'accept', deviceTarget?: DeviceTarget, searchBackend?: SearchBackendId, previewMark?: string | null, previewLocation?: string | null }) {
  const r = await fetch(`${API}/api/workflow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json() as Promise<WorkflowSnapshot>
}

/* ── Folder sync (Open-folder) ── */

export interface SyncServerChange { path: string; mtimeMs: number; size: number }

export interface SyncChangesResult {
  ok: boolean
  now: number
  changed: SyncServerChange[]
  deleted: string[]
  truncated?: boolean
  error?: string
}

export async function fetchSyncChanges(since: number, known: string[]): Promise<SyncChangesResult> {
  const r = await fetch('/api/projects/sync/changes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ since, known }),
  })
  const data = await r.json() as SyncChangesResult
  if (!r.ok || data.ok === false) throw new Error(data.error || `Sync check failed (${r.status})`)
  return data
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: string }).name
  return name === 'AbortError' || name === 'TimeoutError'
}

export async function chatStream(
  messages: { role: string, content: string }[],
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
  workflow?: ChatWorkflow,
) {
  const r = await fetch(`${API}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ messages, workflow }),
    signal,
  })
  if (!r.ok || !r.body) {
    let error = `Chat stream failed (${r.status})`
    try {
      const data = await r.json() as { error?: string }
      if (data.error) error = data.error
    } catch { /* ignore */ }
    throw new Error(error)
  }
  const reader = r.body.getReader()
  const onAbort = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', onAbort, { once: true })
  const decoder = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const parts = buf.split('\n\n')
      buf = parts.pop() || ''
      for (const part of parts) {
        const line = part.split('\n').find(l => l.startsWith('data: '))
        if (!line) continue
        try { onEvent(JSON.parse(line.slice(6)) as ChatStreamEvent) } catch { /* ignore malformed */ }
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

export interface PageNote { selector: string, text: string, type?: string, targetSelector?: string }

export async function submitLiveEdit(annotations: PageNote[], pageNotes: string, url?: string) {
  const r = await fetch(`${API}/api/live-edit/submit`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ annotations, pageNotes, url })
  })
  return r.json()
}

export async function fetchOverlaySource(): Promise<string> {
  const r = await fetch(`${API}/live-edit/overlay.js`)
  if (!r.ok) throw new Error(`overlay fetch failed: ${r.status}`)
  return r.text()
}

// --- Library (§3): tiered catalog + templates for the Library panel ---

export interface CatalogSummaryItem {
  tag: string
  category: string
  description: string
  props: string[]
  runtime?: 'lit' | 'react'
  stock: 'shadcn' | 'appkit'
}

export interface TemplateItem {
  id: string
  name: string
  kind: 'module' | 'compound' | 'multi-column'
  description: string
  sourceFile: string
  target: string
}

export interface PackSummaryItem {
  id: string
  name: string
  description: string
  nodes: number
  settings: number
  configures: string[]
}

export interface DesignPackSummaryItem {
  id: string
  kind: 'design'
  name: string
  version: string
  description: string
  contents: string[]
}

export async function getCatalog(q = '') {
  const r = await fetch(`${API}/api/catalog${q ? `?q=${encodeURIComponent(q)}` : ''}`)
  return r.json() as Promise<{ ok: boolean, packs: PackSummaryItem[], components: CatalogSummaryItem[], templates: TemplateItem[], designPacks: DesignPackSummaryItem[], archPacks: DesignPackSummaryItem[], error?: string }>
}

export interface DesignPackItem extends DesignPackSummaryItem {
  guide: DesignGuideItem
  tokensFile?: { path: string, content: string }
}

export async function getDesignPacks() {
  const r = await fetch(`${API}/api/design/packs`)
  return r.json() as Promise<{ ok: boolean, packs: DesignPackItem[], error?: string }>
}

export async function previewDesignPack(id: string) {
  return postJson<{ ok: boolean, preview: { pack: string, items: { item: string, state: string, detail: string }[] }, error?: string }>('/api/design/packs/preview', { id })
}

export async function applyDesignPack(id: string) {
  return postJson<{ ok: boolean, guide: DesignGuideItem, graph: DesignGraphItem, report: DesignReportItem, error?: string }>('/api/design/packs/apply', { id })
}

export interface DesignImportMappingItem {
  isPack: boolean
  mapped: { field: string, source: string, detail: string }[]
  unmapped: { source: string, keptAs: string }[]
  missing: string[]
  guide: DesignGuideItem | null
}

/* ── Architecture facet (Facets slice 7) ──────────────────── */

export interface ArchitectureDeclarationItem {
  version: 1
  name?: string
  layers: string[]
  modules: { name: string, path: string, responsibility?: string }[]
  allowedDependencies: { from: string, to: string }[]
  rules: { id: string, say: string, kind: 'no-import' | 'naming', from?: string, to?: string, path?: string, pattern?: string }[]
  provenance?: string
}

export interface ArchitectureReportItem {
  designated: boolean
  rules: { id: string, say: string, verdict: 'pass' | 'fail' | 'couldnt-check', evidence: string }[]
  drift: { declaredNotFound: string[], foundNotDeclared: string[] }
  guidePresent: boolean
}

export async function getArchitecture() {
  const r = await fetch(`${API}/api/architecture`)
  return r.json() as Promise<{ ok: boolean, declaration: ArchitectureDeclarationItem | null, guide: string, report: ArchitectureReportItem, error?: string }>
}

export interface ArchPackItem {
  id: string
  kind: 'architecture'
  name: string
  version: string
  description: string
  contents: string[]
  declaration: ArchitectureDeclarationItem
  guide: string
  refactorOutline: string[]
}

export async function getArchPacks() {
  const r = await fetch(`${API}/api/architecture/packs`)
  return r.json() as Promise<{ ok: boolean, packs: ArchPackItem[], error?: string }>
}

export async function previewArchPack(id: string) {
  return postJson<{ ok: boolean, preview: { item: string, state: string, detail: string }[], error?: string }>('/api/architecture/packs/preview', { id })
}

export async function followArchPack(id: string) {
  return postJson<{ ok: boolean, declaration: ArchitectureDeclarationItem, report: ArchitectureReportItem, error?: string }>('/api/architecture/packs/follow', { id })
}

export async function planArchPack(id: string) {
  return postJson<{ ok: boolean, plan: { slug: string, title: string, tasks: number }, error?: string }>('/api/architecture/packs/plan', { id })
}

/* ── Tech Stack facet (Facets slice 8) ────────────────────── */

export interface TechStackItem {
  derivedAt: number
  languages: { name: string, files: number, locations: string[] }[]
  packages: { name: string, declared?: string, installed?: string, kind: 'runtime' | 'dev', usedBy: string[] }[]
  filesOfNote: { path: string, what: string }[]
  facts: string[]
  ecosystems: string[]
  report: {
    declaredNotInstalled: string[]
    installedNotDeclared: string[]
    versionMismatches: { name: string, declared: string, installed: string }[]
    candidateUnused: string[]
  }
}

export async function getTechStack() {
  const r = await fetch(`${API}/api/tech-stack`)
  return r.json() as Promise<{ ok: boolean, stack: TechStackItem, error?: string }>
}

/* ── Configuration facet (Facets slice 9) ─────────────────── */

export interface ConfigInventoryItem {
  derivedAt: number
  groups: {
    id: string, label: string,
    entries: { file: string, aspect: string, profileId?: string, summary: string, envKeys?: string[] }[],
    missingAspects: string[],
  }[]
  unrecognised: string[]
  projectRecord?: { format?: string, deviceTargets?: string[], entry?: string, type?: string }
}

export async function getConfigInventory() {
  const r = await fetch(`${API}/api/config-inventory`)
  return r.json() as Promise<{ ok: boolean, inventory: ConfigInventoryItem, error?: string }>
}

/* ── Cross-facet links + criteria (Facets slice 10) ───────── */

export interface CrossLinkItem {
  id: string
  kind: 'uses-component' | 'requires-package' | 'needs-config' | 'follows-rule' | 'styled-by'
  from: string
  to: string
  note?: string
  resolved: boolean
  targetLabel: string
}

export async function getCrossLinks() {
  const r = await fetch(`${API}/api/cross-links`)
  return r.json() as Promise<{ ok: boolean, links: CrossLinkItem[], error?: string }>
}

export async function addCrossLink(link: { kind: CrossLinkItem['kind'], from: string, to: string }) {
  return postJson<{ ok: boolean, links: CrossLinkItem[], error?: string }>('/api/cross-links', link)
}

export async function removeCrossLink(id: string) {
  return postJson<{ ok: boolean, links: CrossLinkItem[], error?: string }>('/api/cross-links/remove', { id })
}

export interface FacetCriteriaRunItem {
  facet: string
  ranAt: number
  results: { id: string, say: string, verdict: 'pass' | 'fail' | 'couldnt-check', evidence: string }[]
}

export async function getFacetCriteria(facet: string) {
  const r = await fetch(`${API}/api/facet-criteria/${facet}`)
  return r.json() as Promise<{ ok: boolean, run: FacetCriteriaRunItem, error?: string }>
}

export async function mapDesignImport(files: { path: string, content: string }[], apply: boolean) {
  return postJson<{ ok: boolean, mapping: DesignImportMappingItem, applied: boolean, graph?: DesignGraphItem, report?: DesignReportItem, error?: string }>('/api/design/import', { files, apply })
}

export async function installCatalogComponent(tag: string) {
  const r = await fetch(`${API}/api/catalog/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag }),
  })
  return r.json() as Promise<{ ok: boolean, tag: string, dest?: string, error?: string }>
}

export async function placeTemplate(id: string) {
  const r = await fetch(`${API}/api/catalog/place-template`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  return r.json() as Promise<{ ok: boolean, id: string, dest?: string, error?: string }>
}

/** Seed a chat turn from outside the chat panel (Library "Ask AI", plan execute). */
export function askAi(text: string) {
  window.dispatchEvent(new CustomEvent('ai-live:ask-ai', { detail: { text } }))
}

/** Launcher-global agent behavior settings (Settings → Agent & Chat). */
export interface AgentSettings {
  defaultWorkflow: 'files' | 'sketch'
  contextTrim: boolean
  mapInjection: 'auto' | 'always' | 'off'
  chatEngine: 'musecode' | 'opencode' | 'mastra'
  consoleCheck: boolean
  aleFsTools: boolean
  aleWebTools: boolean
  aleSkillTools: boolean
}

export async function getAgentSettings(): Promise<AgentSettings> {
  const r = await fetch('/api/agent-settings')
  const j = await r.json() as { ok: boolean, settings: AgentSettings }
  return j.settings
}

export async function postAgentSettings(patch: Partial<AgentSettings>): Promise<AgentSettings> {
  const r = await fetch('/api/agent-settings', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
  })
  const j = await r.json() as { ok: boolean, settings: AgentSettings }
  return j.settings
}

/** Whether Muse Code is installed on this machine, and which
 * version answered — computed by the host (musecode/availability). */
export interface MuseCodeAvailability {
  available: boolean
  version: string | null
  versionLine: string | null
  binPath: string | null
}

/** `fresh` bypasses the host's short availability cache — the
 * requirement note's Refresh asks for it, so a Muse Code install
 * that just finished is seen on the click, not up to 30s later. */
export async function getMuseCodeAvailability(fresh = false): Promise<MuseCodeAvailability> {
  const r = await fetch(`/api/musecode/availability${fresh ? '?fresh=1' : ''}`)
  const j = await r.json() as { ok: boolean, availability: MuseCodeAvailability }
  return j.availability
}

/** Muse Code health facts for the sandbox surface (musecode/health):
 * the binary, the sign-in state, and the sandbox probe's last
 * result (null until a check has run — reading health never
 * spends a run). */
export interface MuseSignIn {
  state: 'api-key' | 'stored' | 'none-found'
  detail: string
}

export interface SandboxProbeResult {
  state: 'ok' | 'sandbox-failed' | 'indeterminate'
  detail: string
  probedAt: string
}

export interface MuseCodeHealth {
  availability: MuseCodeAvailability
  signIn: MuseSignIn
  sandboxProbe: SandboxProbeResult | null
}

export async function getMuseCodeHealth(fresh = false): Promise<MuseCodeHealth> {
  const r = await fetch(`/api/musecode/health${fresh ? '?fresh=1' : ''}`)
  const j = await r.json() as { ok: boolean, health: MuseCodeHealth }
  return j.health
}

/** Run (or re-run) the sandbox probe on the host: one capped
 * sandboxed run in a scratch folder. Cached per binary unless
 * forced. */
export async function postMuseSandboxProbe(force = false): Promise<SandboxProbeResult> {
  const r = await fetch('/api/musecode/health/probe', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ force }),
  })
  const j = await r.json() as { ok: boolean, probe: SandboxProbeResult }
  return j.probe
}

export interface AppSettingsSnapshot {
  ok: boolean
  uiPrefs?: import('./uiPrefs.js').UiPrefs | null
  editorTheme?: string | null
  setupDone?: boolean | null
  error?: string
}

export async function getAppSettings(): Promise<AppSettingsSnapshot> {
  const r = await fetch(`${API}/api/app-settings`)
  return r.json()
}

export async function putAppSettings(patch: {
  uiPrefs?: Partial<import('./uiPrefs.js').UiPrefs>
  editorTheme?: string
  setupDone?: boolean
}): Promise<AppSettingsSnapshot> {
  const r = await fetch(`${API}/api/app-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return r.json()
}
