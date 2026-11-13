/**
 * The facet registry (Facets design v0.1 §1, §10.1): the single
 * source every facet surface reads — the facet bar and hash routes
 * (layoutRoute), the Actions palette chips (agentActions), the
 * Wizards menu grouping (wizards), the facet screens (FacetView),
 * and Settings → Facets. A facet declares its id, title, one-line
 * blurb, and its sections; a section declared here is a section
 * the facet screen renders and Settings can switch off (§10) —
 * the two can never drift apart because both read this list.
 *
 * Overview is the project home, not a facet: it owns no data, has
 * no wizards, and cannot be turned off (§9, §10.2). The six
 * facets are Features, Architecture, Graphic Design (renamed from
 * Styles — a clean rename in code, no migration), Tech Stack,
 * Configuration, and Delivery (§13: what happens to the project —
 * Git, Tests, CI, Deployment — added after the five, in pipeline
 * order at the end of the bar).
 */

export type FacetId = 'overview' | 'features' | 'architecture' | 'graphic-design' | 'tech-stack' | 'configuration' | 'delivery'

/** The facets proper — everything except the Overview home. */
export type ProjectFacetId = Exclude<FacetId, 'overview'>

export interface FacetSectionDef {
  id: string
  title: string
}

export interface FacetDef {
  id: FacetId
  title: string
  blurb: string
  /** The project home: not a facet, never toggleable (§9, §10.2). */
  home?: boolean
  sections: FacetSectionDef[]
}

const ACTIONS: FacetSectionDef = { id: 'actions', title: 'Actions' }
const WIZARDS: FacetSectionDef = { id: 'wizards', title: 'Wizards' }

export const FACETS: FacetDef[] = [
  {
    id: 'overview', title: 'Overview', home: true,
    blurb: 'The whole project at a glance, and where each facet stands',
    sections: [
      { id: 'facets', title: 'Facets' },
      ACTIONS,
    ],
  },
  {
    id: 'features', title: 'Features',
    blurb: 'What the app can do — its feature graph, packs, and build status',
    sections: [
      { id: 'graph', title: 'Feature graph' },
      { id: 'packs', title: 'Feature packs' },
      ACTIONS, WIZARDS,
    ],
  },
  {
    id: 'architecture', title: 'Architecture',
    blurb: 'How the app is built — its architecture plan, philosophy, and guide',
    sections: [
      { id: 'state', title: 'Current state' },
      { id: 'plan', title: 'Architecture plan' },
      { id: 'guide', title: 'Philosophy & guide' },
      { id: 'report', title: 'Report' },
      { id: 'packs', title: 'Architecture plan packs' },
      ACTIONS, WIZARDS,
    ],
  },
  {
    id: 'graphic-design', title: 'Graphic Design',
    blurb: 'How the app looks — its design system: guide, tokens, type, icons, and controls',
    sections: [
      { id: 'guide', title: 'Style guide' },
      { id: 'tokens', title: 'Design tokens' },
      { id: 'typography', title: 'Typography scale' },
      { id: 'layout', title: 'Layout' },
      { id: 'icons', title: 'Icons' },
      { id: 'gui-guide', title: 'GUI guide' },
      { id: 'graph', title: 'Design graph & report' },
      { id: 'packs', title: 'Design packs' },
      ACTIONS, WIZARDS,
    ],
  },
  {
    id: 'tech-stack', title: 'Tech Stack',
    blurb: 'What the app is built with — languages, packages, and the files that define them',
    sections: [
      { id: 'state', title: 'Stack summary' },
      { id: 'packages', title: 'Packages' },
      { id: 'files', title: 'Files of note' },
      { id: 'report', title: 'Report' },
      ACTIONS, WIZARDS,
    ],
  },
  {
    id: 'configuration', title: 'Configuration',
    blurb: 'How the project is set up — every config file, recognised and in one place',
    sections: [
      { id: 'state', title: 'Current state' },
      { id: 'entries', title: 'Configuration files' },
      { id: 'project', title: 'Project record' },
      { id: 'report', title: 'Report' },
      ACTIONS, WIZARDS,
    ],
  },
  {
    id: 'delivery', title: 'Delivery',
    blurb: 'What happens to the project — change it, check it, ship it',
    sections: [
      { id: 'git', title: 'Git' },
      { id: 'tests', title: 'Tests' },
      { id: 'ci', title: 'CI' },
      { id: 'deployment', title: 'Deployment' },
      ACTIONS, WIZARDS,
    ],
  },
]

/** Facet order everywhere: Overview (the home) first, then the facets. */
export const FACET_IDS: FacetId[] = FACETS.map(f => f.id)

export const FACET_TITLES: Record<FacetId, string> = Object.fromEntries(
  FACETS.map(f => [f.id, f.title]),
) as Record<FacetId, string>

export const FACET_BLURBS: Record<FacetId, string> = Object.fromEntries(
  FACETS.map(f => [f.id, f.blurb]),
) as Record<FacetId, string>

export function facetById(id: FacetId): FacetDef {
  return FACETS.find(f => f.id === id) ?? FACETS[0]
}

export function isFacetId(s: string): s is FacetId {
  return FACETS.some(f => f.id === s)
}

/** The facets proper (no Overview), in registry order. */
export function projectFacets(): FacetDef[] {
  return FACETS.filter(f => !f.home)
}

export function sectionsForFacet(id: FacetId): FacetSectionDef[] {
  return facetById(id).sections
}
