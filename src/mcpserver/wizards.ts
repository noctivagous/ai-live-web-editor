/**
 * The two-headed wizard registry (Muse Code design §9,
 * slice 8) — the server-side half the MCP wizard tools run
 * against.
 *
 * Every wizard in the product registry (ui/lib/wizards.ts)
 * has an entry here. A wizard is READY only when it declares
 * BOTH heads over one shared validation and one shared effect:
 *
 * - `ui`: the editor component that renders it + how an agent
 *   open reaches it (the wizardApi SSE channel).
 * - `headless`: a params schema + defaults policy + an execute
 *   function agents call through ale_run_wizard.
 *
 * A wizard cannot register with only one head: registerWizard
 * refuses a single-headed declaration outright, so a UI-only
 * wizard that later needs retrofitting (the failure §9.1
 * exists to prevent) cannot be declared. Stubs are declared
 * with NO heads — present, named, and honestly not ready —
 * exactly as the UI registry shows them greyed.
 *
 * Slice 8 converts ONE reference wizard: Add a Feature. Its
 * shared effect is the feature-pack graft (the same
 * feature-install-pack dispatch the graph tools expose); its
 * shared validation is "packId names a catalog pack". The UI
 * head's Quick add drives that same graft through a chat turn;
 * the headless head runs it directly. The other fifteen
 * wizards stay stubs here, untouched but for the declaration
 * this registry's shape requires (§18: each is built
 * two-headed when its own slice comes).
 */
import { getPack } from '../catalog/packs.js'
import { runGraphTool } from '../opencode/graphTools.js'

export interface WizardOutcome {
  status: 'completed' | 'cancelled'
  wizardId: string
  /** Which head produced the outcome (absent for UI outcomes
   * the component reports without head detail). */
  head?: 'ui' | 'headless'
  action?: string
  input?: Record<string, unknown>
  created?: unknown
  detail?: unknown
  reason?: string
}

export interface WizardHeads {
  ui: {
    /** The editor component that renders this wizard. */
    component: string
    note: string
  }
  headless: {
    inputSchema: Record<string, unknown>
    /** The stated defaults: what an omitted input means. */
    defaults: string
    execute: (input: Record<string, any>) => Promise<WizardOutcome>
  }
  /** One validation for both heads: an error string, or null
   * when the input may proceed. */
  validate: (input: Record<string, any>) => string | null
}

export interface WizardRegistration {
  id: string
  title: string
  facet: string
  heads: WizardHeads | null
}

const registry = new Map<string, WizardRegistration>()

/**
 * Register a wizard. The two-head rule is enforced here, at
 * declaration time: a heads object missing either head throws,
 * so "ready with one head" is unrepresentable. Passing
 * heads: null declares a stub.
 */
export function registerWizard(reg: WizardRegistration): void {
  if (reg.heads) {
    const h = reg.heads as Partial<WizardHeads>
    if (!h.ui || !h.headless || typeof h.validate !== 'function') {
      throw new Error(`Wizard "${reg.id}" must declare BOTH heads (ui + headless) and a shared validate — a single-headed wizard cannot register.`)
    }
    if (typeof h.headless.execute !== 'function' || !h.headless.inputSchema) {
      throw new Error(`Wizard "${reg.id}" headless head needs an inputSchema and an execute function.`)
    }
  }
  registry.set(reg.id, reg)
}

export function wizardRegistration(id: string): WizardRegistration | undefined {
  return registry.get(id)
}

export function wizardRegistrations(): WizardRegistration[] {
  return [...registry.values()]
}

export function wizardReady(reg: WizardRegistration): boolean {
  return reg.heads !== null
}

/* ------------------------------------------------------------------ */
/* Add a Feature — the reference wizard (§9, converted in slice 8)     */
/* ------------------------------------------------------------------ */

function validateAddFeature(input: Record<string, any>): string | null {
  const packId = typeof input?.packId === 'string' ? input.packId : ''
  if (!packId) return 'Pass packId: the catalog feature pack to add.'
  if (!getPack(packId)) return `No feature pack with id "${packId}". The catalog’s packs are listed in the Library (find-component with kind pack).`
  return null
}

async function executeAddFeature(input: Record<string, any>): Promise<WizardOutcome> {
  const packId = String(input.packId)
  const graft = await runGraphTool('feature-install-pack', {
    packId,
    ...(typeof input.parentId === 'string' && input.parentId ? { parentId: input.parentId } : {}),
  }) as Record<string, unknown>
  if (graft.ok === false) {
    return { status: 'cancelled', wizardId: 'add-feature', head: 'headless', reason: String(graft.error ?? 'the graft was refused'), input }
  }
  return {
    status: 'completed',
    wizardId: 'add-feature',
    head: 'headless',
    action: 'install-pack',
    input,
    created: { pack: graft.pack, added: graft.added, buildOrder: graft.buildOrder },
    detail: { wired: graft.wired, unwired: graft.unwired, totalNodes: graft.totalNodes },
  }
}

registerWizard({
  id: 'add-feature',
  title: 'Add a Feature',
  facet: 'features',
  heads: {
    ui: {
      component: 'AddFeatureWizard',
      note: 'Opens the pack picker in the editor; the user picks a pack and either quick-adds it (one turn, stated defaults, no questions) or plans it first. The component reports the outcome to the completion registry when it closes.',
    },
    headless: {
      inputSchema: {
        type: 'object',
        properties: {
          packId: { type: 'string', description: 'The catalog feature pack id' },
          parentId: { type: 'string', description: 'Optional graph node to graft under' },
        },
        required: ['packId'],
        additionalProperties: false,
      },
      defaults: 'The pack’s stated defaults apply to every setting; links the graft cannot wire are reported as unwired, never silently dropped.',
      execute: executeAddFeature,
    },
    validate: validateAddFeature,
  },
})

/* The remaining product wizards, declared as stubs (no heads):
 * named and listed so agents see the product's real shape, and
 * un-runnable until their own slices build both heads (§18). */
const STUBS: Array<[string, string, string]> = [
  ['new-project', 'New Project', 'architecture'],
  ['base-layout', 'Choose a Base Layout', 'architecture'],
  ['project-type', 'Project Type & Format', 'architecture'],
  ['choose-arch-pack', 'Choose an Architecture Plan Pack', 'architecture'],
  ['apply-arch-pack', 'Apply Plan Pack to This Codebase', 'architecture'],
  ['device-targets', 'Device Targets', 'configuration'],
  ['connect-provider', 'Connect a Provider', 'configuration'],
  ['add-configuration', 'Add a Configuration', 'configuration'],
  ['choose-design-pack', 'Choose a Design Pack', 'graphic-design'],
  ['import-graphic-design', 'Import Graphic Design', 'graphic-design'],
  ['add-package', 'Add a Package', 'tech-stack'],
  ['upgrade-package', 'Upgrade a Package', 'tech-stack'],
  ['remove-package', 'Remove a Package', 'tech-stack'],
  ['restyle-app', 'Restyle the App', 'graphic-design'],
  ['make-responsive', 'Make It Responsive', 'graphic-design'],
]
for (const [id, title, facet] of STUBS) registerWizard({ id, title, facet, heads: null })

/* ------------------------------------------------------------------ */
/* WizardCompletion — the promise registry (§9.2)                      */
/* ------------------------------------------------------------------ */

/** How long an opened wizard may wait for the user before the
 * tool call resolves as a cancellation. A wizard is a human
 * round-trip; the spike proved the call holds open well past
 * any transport timeout that matters, and a forgotten wizard
 * must still never hang the session forever. */
export const WIZARD_COMPLETION_TIMEOUT_MS = 10 * 60_000

interface PendingCompletion {
  completionId: string
  wizardId: string
  prefill: Record<string, unknown>
  createdAt: number
  resolve: (outcome: WizardOutcome) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingCompletion>()
let completionSeq = 0

export type WizardOpenListener = (open: { completionId: string; wizardId: string; prefill: Record<string, unknown> }) => void
const openListeners = new Set<WizardOpenListener>()

/** Subscribe to wizard opens (the wizardApi SSE channel). The
 * listener is also replayed the currently pending opens, so a
 * UI that connects late still shows the wizard. */
export function onWizardOpen(listener: WizardOpenListener): () => void {
  openListeners.add(listener)
  for (const p of pending.values()) {
    listener({ completionId: p.completionId, wizardId: p.wizardId, prefill: p.prefill })
  }
  return () => { openListeners.delete(listener) }
}

/**
 * Open a completion: returns the id the UI reports against
 * and the promise the tool call awaits. The promise resolves
 * exactly once — completion, user cancellation, or timeout —
 * never hangs, never rejects.
 */
export function openWizardCompletion(
  wizardId: string,
  prefill: Record<string, unknown> = {},
  timeoutMs: number = WIZARD_COMPLETION_TIMEOUT_MS,
): { completionId: string; promise: Promise<WizardOutcome> } {
  completionSeq += 1
  const completionId = `wiz-${Date.now().toString(36)}-${completionSeq}`
  let resolveFn!: (outcome: WizardOutcome) => void
  const promise = new Promise<WizardOutcome>((r) => { resolveFn = r })
  const timer = setTimeout(() => {
    completeWizard(completionId, {
      status: 'cancelled', wizardId, head: 'ui', reason: 'timeout',
      detail: `The wizard was not completed within ${Math.round(timeoutMs / 60_000)} minutes.`,
    })
  }, timeoutMs)
  timer.unref?.()
  pending.set(completionId, { completionId, wizardId, prefill, createdAt: Date.now(), resolve: resolveFn, timer })
  for (const l of openListeners) l({ completionId, wizardId, prefill })
  return { completionId, promise }
}

/** Resolve a pending completion (first resolution wins — a
 * completed report that lands after a timeout is noted and
 * dropped, never a double resolution). True when it resolved
 * a live pending entry. */
export function completeWizard(completionId: string, outcome: WizardOutcome): boolean {
  const entry = pending.get(completionId)
  if (!entry) return false
  pending.delete(completionId)
  clearTimeout(entry.timer)
  entry.resolve(outcome)
  return true
}

export function pendingWizardCount(): number {
  return pending.size
}

/** Test hook: resolve and drop every pending completion. */
export function resetWizardCompletions(): void {
  for (const entry of [...pending.values()]) {
    completeWizard(entry.completionId, { status: 'cancelled', wizardId: entry.wizardId, reason: 'reset' })
  }
  openListeners.clear()
}
