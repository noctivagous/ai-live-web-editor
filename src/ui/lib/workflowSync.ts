/** Sync the Files | Live sketch control across the sidebar Chat and /chat-embed (same origin).
 *
 * Both Chat instances render the same segmented control from `workflow` +
 * `sketch` state, but each instance fetched them once on mount, so a mode
 * toggle, undo/discard/accept, or server-side auto-route in one window left
 * the other stale. The launcher (`GET /api/workflow`) stays the source of
 * truth: this module only broadcasts "something changed, re-fetch" and
 * compares snapshots so polling does not cause redundant renders.
 */
import type { ChatWorkflow, WorkflowSnapshot } from './api'

export type WorkflowSyncSnapshot = WorkflowSnapshot

export const WORKFLOW_CHANNEL = 'ai-live-editor.workflow'
export const WORKFLOW_STORAGE_KEY = 'ai-live-editor.workflow.signal'

function patchesEqual(
  a: WorkflowSnapshot['patches'],
  b: WorkflowSnapshot['patches'],
): boolean {
  if (a.length !== b.length) return false
  return a.every((p, i) => {
    const q = b[i]
    return p.id === q.id
      && p.selector === q.selector
      && p.op === q.op
      && p.ok === q.ok
      && (p.detail || '') === (q.detail || '')
  })
}

/** True when every UI aspect derived from the snapshot matches (seg control,
 * sketch panel, patch list, actions, placeholder). */
export function workflowSnapshotsEqual(a: WorkflowSyncSnapshot, b: WorkflowSyncSnapshot): boolean {
  return a.mode === b.mode
    && a.deviceTarget === b.deviceTarget
    && (a.searchBackend || 'off') === (b.searchBackend || 'off')
    && JSON.stringify(a.searchOptions || []) === JSON.stringify(b.searchOptions || [])
    && Boolean(a.selfMode) === Boolean(b.selfMode)
    && (a.plan?.slug || '') === (b.plan?.slug || '')
    && (a.plan?.status || '') === (b.plan?.status || '')
    && (a.selfCheck?.at || 0) === (b.selfCheck?.at || 0)
    && Boolean(a.selfCheck?.running) === Boolean(b.selfCheck?.running)
    && Boolean(a.accepted) === Boolean(b.accepted)
    && patchesEqual(a.patches || [], b.patches || [])
}

function parseMode(value: unknown): ChatWorkflow | null {
  return value === 'files' || value === 'sketch' ? value : null
}

function parseDeviceTarget(value: unknown): WorkflowSnapshot['deviceTarget'] {
  return value === 'phone' || value === 'tablet' || value === 'desktop' ? value : 'desktop'
}

function parseSearchBackend(value: unknown): WorkflowSnapshot['searchBackend'] {
  return value === 'provider' || value === 'brave' || value === 'off' ? value : 'off'
}

function parseSearchOptions(value: unknown): WorkflowSnapshot['searchOptions'] {
  if (!Array.isArray(value)) return []
  return value.flatMap(o => {
    const row = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>
    if (row.id !== 'provider' && row.id !== 'brave') return []
    return [{
      id: row.id,
      label: typeof row.label === 'string' ? row.label : row.id,
      available: row.available === true,
    }]
  })
}

/** Normalize a server snapshot; null when it is not a workflow snapshot. */
export function parseWorkflowSnapshot(raw: unknown): WorkflowSyncSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const mode = parseMode(row.mode)
  if (!mode || !Array.isArray(row.patches)) return null
  const selfCheck = (row.selfCheck && typeof row.selfCheck === 'object')
    ? (row.selfCheck as WorkflowSnapshot['selfCheck'])
    : null
  const planRow = (row.plan && typeof row.plan === 'object') ? (row.plan as Record<string, unknown>) : null
  const plan = planRow && typeof planRow.slug === 'string'
    ? {
        slug: planRow.slug,
        title: typeof planRow.title === 'string' ? planRow.title : planRow.slug,
        status: typeof planRow.status === 'string' ? planRow.status : 'draft',
        level: typeof planRow.level === 'number' ? planRow.level : 1,
      }
    : null
  return {
    ok: row.ok !== false,
    mode,
    deviceTarget: parseDeviceTarget(row.deviceTarget),
    searchBackend: parseSearchBackend(row.searchBackend),
    searchOptions: parseSearchOptions(row.searchOptions),
    selfMode: Boolean(row.selfMode),
    selfCheck,
    plan,
    accepted: Boolean(row.accepted),
    patches: row.patches.map((p) => {
      const patch = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
      const selector = typeof patch.selector === 'string' ? patch.selector : 'body'
      const op = typeof patch.op === 'string' ? patch.op : 'html'
      return {
        id: typeof patch.id === 'string' ? patch.id : '',
        selector,
        op,
        ok: patch.ok !== false,
        detail: typeof patch.detail === 'string' && patch.detail ? patch.detail : `${op} ${selector}`,
      }
    }),
  }
}

/** Tell every other Chat instance to re-fetch `GET /api/workflow`. */
export function publishWorkflowChanged(): void {
  try {
    const ch = new BroadcastChannel(WORKFLOW_CHANNEL)
    ch.postMessage({ type: 'workflow-changed', at: Date.now() })
    ch.close()
  } catch { /* unsupported */ }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(WORKFLOW_STORAGE_KEY, String(Date.now()))
    }
  } catch { /* quota / private mode */ }
}

/** Invoke `onChanged` whenever another instance publishes a workflow change. */
export function subscribeWorkflow(onChanged: () => void): () => void {
  let ch: BroadcastChannel | null = null
  try {
    ch = new BroadcastChannel(WORKFLOW_CHANNEL)
    ch.onmessage = () => { onChanged() }
  } catch { /* unsupported */ }
  const onStorage = (e: StorageEvent) => {
    if (e.key !== WORKFLOW_STORAGE_KEY || !e.newValue) return
    onChanged()
  }
  try {
    if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  } catch { /* non-browser */ }
  return () => {
    try {
      if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
    } catch { /* non-browser */ }
    try { ch?.close() } catch { /* ignore */ }
  }
}
