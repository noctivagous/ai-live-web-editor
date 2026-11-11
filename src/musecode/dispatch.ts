/**
 * Headless dispatch (Muse Code design §13, slice 10):
 * "Fix with Muse Code" — a one-shot `muse exec` run with a
 * packaged brief, judged by the gate, presented as a diff for
 * accept/reject.
 *
 * Shape:
 * - Brief packaging: project brief + facet/graph shape + the
 *   failing check's evidence + the criteria the fix will be
 *   judged by, written to a prompt file in ALE's state dir
 *   (never in the project — it must not pollute the diff).
 * - Run: `muse exec --json --prompt-file … --max-model-steps`
 *   with the resolved posture's flags + approval mode (never
 *   --yolo), argv array, no shell, cwd = project root,
 *   serialised per project. Dispatch sessions get the same
 *   ALE MCP registration and the same managed Stop hook as
 *   chat sessions.
 * - Settle: process exit + a quiet period in which the changed
 *   set stops moving (a detached writer can't sneak past the
 *   verdict).
 * - Judge: the gate re-runs on the settled tree; ITS verdict —
 *   not the exit code — is the run's outcome.
 * - Accept/reject: before dispatch, the tree is snapshotted
 *   (manifest + copies, in ALE's state dir). Accept keeps the
 *   tree and drops the snapshot; reject restores it exactly —
 *   changed files revert, added files are removed, deleted
 *   files come back.
 */
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getAgentSettingsPath } from '../agentSettings.js'
import { architectureSummary, getArchitecture } from '../architecture/architecture.js'
import { getFeatureGraph } from '../features/features.js'
import { getFsRoot } from '../launcher.js'
import { runGateVerdict, type GateVerdict } from '../mcpserver/gateVerdict.js'
import { aleMcpUrl } from '../mcpserver/server.js'
import { museRunConfig, type MuseRunConfig } from '../ui/lib/museSandbox.js'
import { getMuseCodeAvailability } from './availability.js'
import { ensureGateHookFiles, gateHookConfigArgs } from './gateHook.js'
import { musecodeVersionNote, resolveMusecodePosture } from './supervisor.js'

export const DISPATCH_MAX_MODEL_STEPS = 60

export interface DispatchBriefInput {
  /** What the user/agent is asking to fix, in one line. */
  title: string
  /** The failing check's evidence (gate findings, console
   * error text, the failed criteria) — the run's ground truth. */
  evidence: string
  /** Criteria the fix will be judged by, beyond the gate. */
  criteria?: string[]
  /** Where the dispatch was launched from. */
  source: 'criteria' | 'console' | 'gate' | 'manual'
}

export interface DispatchRecord {
  id: string
  at: string
  projectRoot: string
  source: DispatchBriefInput['source']
  title: string
  posture: string
  approvalMode: string
  binaryVersion: string
  versionNote: string | null
  /** How the ALE MCP server was registered for the run:
   * a .mcp.json ALE wrote for the run ('project-file'), one
   * the project already had ('existing-file'), or none. */
  mcpRoute: 'project-file' | 'existing-file' | 'none'
  exitCode: number | null
  /** Files the run changed, project-relative. */
  changedFiles: string[]
  /** The gate's verdict on the settled tree — the outcome. */
  verdict: GateVerdict | null
  status: 'running' | 'fixed' | 'not-fixed' | 'error' | 'accepted' | 'rejected'
  error?: string
  /** The final message the run produced, if any. */
  finalText?: string
}

/* ------------------------------------------------------------------ */
/* Brief packaging                                                     */
/* ------------------------------------------------------------------ */

export function packageBrief(input: DispatchBriefInput, projectRoot: string): string {
  const features = getFeatureGraph(projectRoot)
  const arch = getArchitecture(projectRoot) ? architectureSummary(projectRoot) : null
  const lines: string[] = [
    `# Fix: ${input.title}`,
    '',
    'You are running headlessly inside ALE (AI Live Editor) to fix a specific, evidenced problem. ALE has already judged the current state with its verify gate; your fix will be judged by re-running that gate — not by your exit status.',
    '',
    '## The failing check',
    '',
    input.evidence || '(no evidence captured)',
    '',
  ]
  if (input.criteria?.length) {
    lines.push('## Criteria the fix will be judged by', '', ...input.criteria.map((c) => `- ${c}`), '')
  }
  lines.push(
    '## Project shape',
    '',
    `- Root: ${projectRoot}`,
    ...(arch ? [`- Architecture: ${arch}`] : []),
    ...(features ? [`- Feature graph: "${features.title}" — ${features.nodes.length} nodes, ${features.edges.length} edges`] : ['- Feature graph: none yet']),
    '',
    '## Rules',
    '',
    '- Change as little as possible: fix the evidenced problem, nothing else.',
    '- You have ALE’s tools (the mcp__ale__* set): the live page, the verify gate, the graphs and plans. Run ale_verify_gate before you finish and report its verdict.',
    '- Do not ask questions; there is no one to answer. Make the smallest reasonable decision and note it in your final message.',
    '- Your final message should state what you changed and the gate verdict you observed.',
  )
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* Tree snapshot / diff / restore                                      */
/* ------------------------------------------------------------------ */

const SNAPSHOT_EXCLUDES = new Set(['.git', 'node_modules', '.ai-live', '.chrome-data', '.muse', 'ale-musecode-dispatch', 'ale-musecode-hooks'])

export interface TreeManifest {
  /** rel path → sha256 of contents. */
  files: Record<string, string>
}

function walkTree(root: string, dir: string, out: string[]): void {
  let entries: fs.Dirent[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SNAPSHOT_EXCLUDES.has(e.name)) continue
      walkTree(root, path.join(dir, e.name), out)
    } else if (e.isFile()) {
      out.push(path.relative(root, path.join(dir, e.name)))
    }
  }
}

function hashFile(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16)
}

export function snapshotTree(root: string, snapshotDir: string): TreeManifest {
  const rels: string[] = []
  walkTree(root, root, rels)
  const manifest: TreeManifest = { files: {} }
  fs.mkdirSync(snapshotDir, { recursive: true })
  for (const rel of rels) {
    const src = path.join(root, rel)
    try {
      manifest.files[rel] = hashFile(src)
      const dest = path.join(snapshotDir, rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(src, dest)
    } catch { /* a file vanishing mid-walk is simply not snapshotted */ }
  }
  return manifest
}

/** What changed between a manifest and the tree as it stands. */
export function diffTree(root: string, manifest: TreeManifest): { changed: string[]; added: string[]; deleted: string[] } {
  const rels: string[] = []
  walkTree(root, root, rels)
  const now = new Set(rels)
  const changed: string[] = []
  const added: string[] = []
  const deleted: string[] = []
  for (const rel of rels) {
    const before = manifest.files[rel]
    if (!before) added.push(rel)
    else if (hashFile(path.join(root, rel)) !== before) changed.push(rel)
  }
  for (const rel of Object.keys(manifest.files)) {
    if (!now.has(rel)) deleted.push(rel)
  }
  return { changed, added, deleted }
}

/** Restore the tree to the snapshot: revert changed, remove
 * added, bring back deleted. */
export function restoreTree(root: string, snapshotDir: string, manifest: TreeManifest): void {
  const { changed, added, deleted } = diffTree(root, manifest)
  for (const rel of added) {
    try { fs.rmSync(path.join(root, rel), { force: true }) } catch { /* already gone */ }
  }
  for (const rel of [...changed, ...deleted]) {
    const src = path.join(snapshotDir, rel)
    const dest = path.join(root, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }
}

/* ------------------------------------------------------------------ */
/* The exec run                                                        */
/* ------------------------------------------------------------------ */

export function dispatchStateDir(): string {
  return path.join(path.dirname(getAgentSettingsPath()), 'ale-musecode-dispatch')
}

/** Posture → exec argv (§5.3 as the spike amended it): the
 * posture's sandbox/trust flags are exec's own flags too; the
 * per-session approval mode maps onto exec's --approval-mode
 * (allowAll → never, onRequest → on-request, denyUnmatched →
 * untrusted). --yolo is never generated. Pure. */
export function dispatchExecArgs(runConfig: MuseRunConfig, opts: { promptFile: string; hooksPath: string | null }): string[] {
  const approval = runConfig.approvalMode === 'allowAll'
    ? 'never'
    : runConfig.approvalMode === 'denyUnmatched'
      ? 'untrusted'
      : 'on-request'
  const args = [
    'exec',
    '--json',
    '--prompt-file', opts.promptFile,
    '--max-model-steps', String(DISPATCH_MAX_MODEL_STEPS),
    '--approval-mode', approval,
    ...runConfig.serveArgs,
  ]
  // No -c mcpServers here: Muse Code 1.4.15's exec refuses
  // MCP registration through -c in every shape (whole map,
  // per-server object, per-field — all "refusing run", probed
  // live in the slice-10 drive). Exec sessions register MCP
  // servers from the project's .mcp.json (spike route b); the
  // dispatch writes one for the run when the project has none.
  if (opts.hooksPath) args.push(...gateHookConfigArgs(opts.hooksPath))
  return args
}

export interface ExecRunResult {
  exitCode: number | null
  stdout: string
  stderr: string
  finalText?: string
}

export type ExecRunner = (binPath: string, args: string[], cwd: string) => Promise<ExecRunResult>

const defaultExecRunner: ExecRunner = (binPath, args, cwd) => new Promise((resolve) => {
  execFile(binPath, args, { cwd, timeout: 15 * 60_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
    const code = err && typeof (err as any).code === 'number' ? (err as any).code : err ? null : 0
    resolve({ exitCode: code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
  })
})

let execRunner: ExecRunner = defaultExecRunner
/** Test hook: replace the exec runner. */
export function setDispatchExecRunner(next: ExecRunner | null): void {
  execRunner = next ?? defaultExecRunner
}

function finalTextFromJsonl(stdout: string): string | undefined {
  let last: string | undefined
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    try {
      const ev = JSON.parse(line) as any
      const text = ev?.text ?? ev?.message ?? ev?.item?.text ?? ev?.result?.text
      if (typeof text === 'string' && text) last = text
    } catch { /* not every line is JSON */ }
  }
  return last
}

/* ------------------------------------------------------------------ */
/* Dispatch orchestration                                              */
/* ------------------------------------------------------------------ */

const records = new Map<string, DispatchRecord>()
const snapshotDirs = new Map<string, string>()
const projectChains = new Map<string, Promise<unknown>>()
let dispatchSeq = 0

export function dispatchRecord(id: string): DispatchRecord | undefined {
  return records.get(id)
}

export function listDispatchRecords(projectRoot: string = getFsRoot()): DispatchRecord[] {
  return [...records.values()].filter((r) => r.projectRoot === projectRoot).reverse()
}

/** Serialise per project: chain onto the project's tail. */
function serialise<T>(projectRoot: string, fn: () => Promise<T>): Promise<T> {
  const tail = projectChains.get(projectRoot) ?? Promise.resolve()
  const run = tail.then(fn, fn)
  projectChains.set(projectRoot, run.then(() => { /* settled */ }, () => { /* settled */ }))
  return run
}

export interface DispatchDeps {
  /** Judge override for tests. */
  judge?: () => Promise<GateVerdict>
  /** Settle poll interval / quiet window overrides for tests. */
  settlePollMs?: number
  settleQuietMs?: number
}

/**
 * Run one dispatch to completion (its record settles into
 * 'fixed' | 'not-fixed' | 'error' with the diff pending the
 * user's accept/reject). Serialised per project.
 */
export async function runDispatch(input: DispatchBriefInput, deps: DispatchDeps = {}): Promise<DispatchRecord> {
  const projectRoot = getFsRoot()
  return serialise(projectRoot, () => runDispatchInner(input, projectRoot, deps))
}

async function runDispatchInner(input: DispatchBriefInput, projectRoot: string, deps: DispatchDeps): Promise<DispatchRecord> {
  dispatchSeq += 1
  const id = `disp-${Date.now().toString(36)}-${dispatchSeq}`
  const availability = await getMuseCodeAvailability()
  const posture = resolveMusecodePosture(projectRoot)
  const runConfig = museRunConfig(posture)
  const record: DispatchRecord = {
    id,
    at: new Date().toISOString(),
    projectRoot,
    source: input.source,
    title: input.title,
    posture,
    approvalMode: runConfig.approvalMode,
    binaryVersion: availability.version ?? 'unknown',
    versionNote: musecodeVersionNote(availability.version),
    mcpRoute: 'none',
    exitCode: null,
    changedFiles: [],
    verdict: null,
    status: 'running',
  }
  records.set(id, record)
  if (!availability.available || !availability.binPath) {
    record.status = 'error'
    record.error = 'Muse Code is not installed on this machine, so the dispatch cannot run. Install it (see the Requirement: Muse Code note in Settings), or pick a different chat engine.'
    return record
  }

  const stateDir = path.join(dispatchStateDir(), id)
  fs.mkdirSync(stateDir, { recursive: true })
  const snapshotDir = path.join(stateDir, 'snapshot')
  const manifest = snapshotTree(projectRoot, snapshotDir)
  snapshotDirs.set(id, snapshotDir)

  // MCP registration for the dispatch session (§13: the same
  // tools as chat). Exec registers servers from the project's
  // .mcp.json (spike route b — the -c surface refuses MCP
  // registration in every shape, probed in the slice-10
  // drive), so ALE writes one for the run when the project
  // has none and removes it afterwards; a project that
  // already has one keeps it untouched.
  const mcpJsonPath = path.join(projectRoot, '.mcp.json')
  const wroteMcpJson = !fs.existsSync(mcpJsonPath)
  record.mcpRoute = wroteMcpJson ? 'project-file' : 'existing-file'
  if (wroteMcpJson) {
    fs.writeFileSync(mcpJsonPath, JSON.stringify({ mcpServers: { ale: { type: 'http', url: aleMcpUrl() } } }, null, 2), 'utf-8')
  }

  const brief = packageBrief(input, projectRoot)
  const promptFile = path.join(stateDir, 'brief.md')
  fs.writeFileSync(promptFile, brief, 'utf-8')
  const hooksPath = ensureGateHookFiles()

  try {
    const args = dispatchExecArgs(runConfig, { promptFile, hooksPath })
    const run = await execRunner(availability.binPath, args, projectRoot)
    record.exitCode = run.exitCode
    record.finalText = finalTextFromJsonl(run.stdout)

    // Settle: exit + a quiet window with a stable changed set.
    const pollMs = deps.settlePollMs ?? 1_000
    const quietMs = deps.settleQuietMs ?? 2_000
    let lastKey = ''
    let stableSince = Date.now()
    const deadline = Date.now() + 30_000
    for (;;) {
      const diff = diffTree(projectRoot, manifest)
      const key = [...diff.changed, ...diff.added, ...diff.deleted].sort().join('|')
      if (key !== lastKey) { lastKey = key; stableSince = Date.now() }
      if (Date.now() - stableSince >= quietMs || Date.now() >= deadline) {
        // The run's own scaffolding (.mcp.json, when ALE wrote
        // it) is not part of the user's diff.
        const scaffolding = wroteMcpJson ? new Set(['.mcp.json']) : new Set<string>()
        record.changedFiles = [...diff.changed, ...diff.added, ...diff.deleted].filter((f) => !scaffolding.has(f)).sort()
        break
      }
      await new Promise((r) => setTimeout(r, pollMs))
    }

    // Judge: the gate's verdict on the settled tree.
    record.verdict = deps.judge ? await deps.judge() : await runGateVerdict()
    record.status = record.verdict.ok ? 'fixed' : 'not-fixed'
    return record
  } catch (e: any) {
    record.status = 'error'
    record.error = e?.message || String(e)
    return record
  } finally {
    if (wroteMcpJson) {
      try { fs.rmSync(mcpJsonPath, { force: true }) } catch { /* already gone */ }
    }
  }
}

/** Accept a dispatch's diff: keep the tree, drop the snapshot. */
export function acceptDispatch(id: string): DispatchRecord | null {
  const record = records.get(id)
  if (!record) return null
  if (record.status === 'fixed' || record.status === 'not-fixed') {
    record.status = 'accepted'
    const dir = snapshotDirs.get(id)
    if (dir) { try { fs.rmSync(path.dirname(dir), { recursive: true, force: true }) } catch { /* best-effort */ } }
    snapshotDirs.delete(id)
  }
  return record
}

/** Reject a dispatch's diff: restore the pre-dispatch tree. */
export function rejectDispatch(id: string): DispatchRecord | null {
  const record = records.get(id)
  if (!record) return null
  if (record.status === 'fixed' || record.status === 'not-fixed') {
    const dir = snapshotDirs.get(id)
    if (dir && fs.existsSync(dir)) {
      // The manifest is rebuilt from the snapshot dir itself:
      // its files ARE the pre-dispatch tree.
      const manifest: TreeManifest = { files: {} }
      const rels: string[] = []
      walkTree(dir, dir, rels)
      for (const rel of rels) manifest.files[rel] = hashFile(path.join(dir, rel))
      restoreTree(record.projectRoot, dir, manifest)
    }
    record.status = 'rejected'
    snapshotDirs.delete(id)
  }
  return record
}

/** Test hook: forget all dispatch state. */
export function resetDispatchState(): void {
  records.clear()
  snapshotDirs.clear()
  projectChains.clear()
}
