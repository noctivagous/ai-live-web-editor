import type { PackSummaryItem } from './api'
import type { ActionFacet } from './agentActions'

/**
 * The wizard registry (slice 3). Wizards live under facets — each
 * facet (features / architecture / graphic design / …) has its own set, because
 * a wizard walks one aspect of the project from its current state
 * to a new one. A wizard is either `ready` (it runs) or a `stub`:
 * named, described, and shown in the menu greyed with its reason,
 * so the shape of the product is visible before the machinery is.
 * Only Add a Feature is ready in this slice; it is the wizard the
 * whole layer was designed around.
 */

export type WizardStatus = 'ready' | 'stub'

export interface WizardDef {
  id: string
  title: string
  blurb: string
  facet: Exclude<ActionFacet, 'any'>
  status: WizardStatus
}

/** Facet order in the Wizards menu: Features first, as everywhere. */
export const WIZARD_FACETS: { id: WizardDef['facet'], title: string }[] = [
  { id: 'features', title: 'Features' },
  { id: 'architecture', title: 'Architecture' },
  { id: 'graphic-design', title: 'Graphic Design' },
  { id: 'tech-stack', title: 'Tech Stack' },
  { id: 'configuration', title: 'Configuration' },
]

export const WIZARDS: WizardDef[] = [
  /* ── Features ────────────────────────────────────────────── */
  {
    id: 'add-feature', title: 'Add a Feature', facet: 'features', status: 'ready',
    blurb: 'Install a feature pack — quickly with its defaults, or planned step by step',
  },

  /* ── Architecture ────────────────────────────────────────── */
  {
    id: 'new-project', title: 'New Project', facet: 'architecture', status: 'stub',
    blurb: 'Start a project: name, kind, and where its files live',
  },
  {
    id: 'base-layout', title: 'Choose a Base Layout', facet: 'architecture', status: 'stub',
    blurb: 'Master-detail, single page, document — the shape everything else hangs on',
  },
  {
    id: 'project-type', title: 'Project Type & Format', facet: 'architecture', status: 'stub',
    blurb: 'What kind of project this is and how it is laid out on disk',
  },
  {
    id: 'choose-arch-pack', title: 'Choose an Architecture Plan Pack', facet: 'architecture', status: 'stub',
    blurb: 'A plan, philosophy, and checkable rules chosen as one set — preview and follow it from the Architecture facet',
  },
  {
    id: 'apply-arch-pack', title: 'Apply Plan Pack to This Codebase', facet: 'architecture', status: 'stub',
    blurb: 'Form a refactor plan that moves this codebase towards a plan pack, step by gated step',
  },
  /* ── Configuration ─────────────────────────────────────── */
  {
    id: 'device-targets', title: 'Device Targets', facet: 'configuration', status: 'stub',
    blurb: 'Phone, tablet, desktop — which devices the project must fit (moved here from Architecture: targets are setup)',
  },
  {
    id: 'connect-provider', title: 'Connect a Provider', facet: 'configuration', status: 'stub',
    blurb: 'Bring your own key and connect an AI provider, step by step',
  },
  {
    id: 'add-configuration', title: 'Add a Configuration', facet: 'configuration', status: 'stub',
    blurb: 'Pick an aspect with no file yet — a lint config, a CI workflow — and scaffold it from the registry',
  },

  /* ── Graphic Design ──────────────────────────────────────── */
  {
    id: 'choose-design-pack', title: 'Choose a Design Pack', facet: 'graphic-design', status: 'stub',
    blurb: 'A premade design system — guide, tokens, type, and icons — chosen as one set',
  },
  {
    id: 'import-graphic-design', title: 'Import Graphic Design', facet: 'graphic-design', status: 'stub',
    blurb: 'Bring a design system in from a folder or zip file and fit it to the design guide form',
  },
  /* ── Tech Stack ──────────────────────────────────────────── */
  {
    id: 'add-package', title: 'Add a Package', facet: 'tech-stack', status: 'stub',
    blurb: 'An agent turn from the Tech Stack facet, with the current stack as its brief — the facet itself runs no npm commands',
  },
  {
    id: 'upgrade-package', title: 'Upgrade a Package', facet: 'tech-stack', status: 'stub',
    blurb: 'An agent turn from the Tech Stack facet, naming the package and its declared and installed versions',
  },
  {
    id: 'remove-package', title: 'Remove a Package', facet: 'tech-stack', status: 'stub',
    blurb: 'An agent turn from the Tech Stack facet — removal is agent work, verified by the gate',
  },

  /* ── Graphic Design (continued) ──────────────────────────── */
  {
    id: 'restyle-app', title: 'Restyle the App', facet: 'graphic-design', status: 'stub',
    blurb: 'Apply the design guide across the whole app, page by page',
  },
  {
    id: 'make-responsive', title: 'Make It Responsive', facet: 'graphic-design', status: 'stub',
    blurb: 'Walk each width — phone, tablet, desktop — against the layout breakpoints and fix what breaks',
  },
]

export function wizardById(id: string): WizardDef | undefined {
  return WIZARDS.find(w => w.id === id)
}

export function wizardsForFacet(facet: WizardDef['facet']): WizardDef[] {
  return WIZARDS.filter(w => w.facet === facet)
}

export const STUB_REASON = 'Wizard not built yet'

/**
 * Shared presentation state for a wizard menu row. Stubs render greyed
 * with the reason (in `title` for the tooltip and `sub` for the row);
 * ready wizards render enabled with their blurb. Every menu that lists
 * a wizard — classic strip, top-bar pops, facet views — reads this so
 * a stub can never look runnable in one menu and greyed in another.
 */
export function wizardRowState(w: WizardDef): { disabled: boolean, title: string, sub: string } {
  const stub = w.status === 'stub'
  return {
    disabled: stub,
    title: stub ? `${w.title} — ${STUB_REASON}` : w.title,
    sub: stub ? STUB_REASON : w.blurb,
  }
}

/**
 * The quick-add turn for a feature pack: the Library's proven install
 * prompt, plus the quick-add contract — the pack's stated defaults
 * are accepted up front, so the turn runs end to end with no
 * questions. The wizard shows those defaults before this is sent.
 */
export function quickAddPrompt(pack: PackSummaryItem): string {
  return `Install the ${pack.name} feature pack (pack id ${pack.id}) into this app, using the pack's stated defaults for every setting — do not stop to ask questions. Plan it as an install: look the pack up in full with find-component (pack: "${pack.id}"), graft it into the project's feature graph with feature-install-pack, and report which of its configures links were wired and which were left unwired. Then build what is missing in the graft's build order, updating node statuses with feature-set-status as work lands.`
}
