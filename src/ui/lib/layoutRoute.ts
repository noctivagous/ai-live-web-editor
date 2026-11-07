/**
 * Layout routes (slice 5). The app has two loadable layouts — the
 * Workbench (files / editor / preview) and the Facets layout — and
 * the Facets layout has one screen per facet. Layouts and facets
 * map to hash routes, exactly as the prototype settled:
 *
 *   #/workbench            the workbench
 *   #/facets/features      the facets layout, Features facet
 *   #/facets/architecture  … Architecture
 *   #/facets/styles        … Styles
 *   #/facets/overview      … Overview
 *
 * Hash routes keep the whole scheme client-side: the launcher and
 * the Vite server need no new path handling, deep links and
 * Back/Forward work, and menus, wizards, and ⌘K stay route-less
 * overlays, as agreed. A bare or unknown hash is the workbench —
 * the app's long-standing default view.
 */

export type FacetId = 'features' | 'architecture' | 'styles' | 'overview'

export const FACET_IDS: FacetId[] = ['features', 'architecture', 'styles', 'overview']

export const FACET_TITLES: Record<FacetId, string> = {
  features: 'Features',
  architecture: 'Architecture',
  styles: 'Styles',
  overview: 'Overview',
}

export const FACET_BLURBS: Record<FacetId, string> = {
  features: 'What the app can do — its feature graph, packs, and build status',
  architecture: 'What kind of project this is — type, format, and device targets',
  styles: 'How the app looks — its style set, theme, and page design',
  overview: 'The whole project at a glance, and where each facet stands',
}

export type AppLayout =
  | { kind: 'workbench' }
  | { kind: 'facets', facet: FacetId }

export const WORKBENCH: AppLayout = { kind: 'workbench' }

export function isFacetId(s: string): s is FacetId {
  return (FACET_IDS as string[]).includes(s)
}

export function parseRoute(hash: string): AppLayout {
  const clean = hash.replace(/^#\/?/, '').replace(/\/+$/, '')
  if (clean === '' || clean === 'workbench') return { kind: 'workbench' }
  const parts = clean.split('/')
  if (parts[0] === 'facets' && parts.length === 2 && isFacetId(parts[1])) {
    return { kind: 'facets', facet: parts[1] }
  }
  if (parts[0] === 'facets') return { kind: 'facets', facet: 'features' }
  return { kind: 'workbench' }
}

export function formatRoute(layout: AppLayout): string {
  return layout.kind === 'workbench' ? '#/workbench' : `#/facets/${layout.facet}`
}
