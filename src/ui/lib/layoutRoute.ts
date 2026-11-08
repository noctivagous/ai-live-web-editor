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
 *   #/facets/features/graph/report   the feature graph, report (tree) view
 *   #/facets/features/graph/diagram  the feature graph, diagram view
 *
 * A backdrop modal rides the query string on any route:
 *   ?globalModal=settings&tab=providers  Settings over the current route
 *
 * Hash routes keep the whole scheme client-side: the launcher and
 * the Vite server need no new path handling, deep links and
 * Back/Forward work, and menus, wizards, the plan overlay, and ⌘K
 * stay route-less overlays, as agreed. A bare or unknown hash is
 * the workbench — the app's long-standing default view. Unknown
 * graph sub-views and unknown modals fall back to the plain route.
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

export type GraphView = 'graph-report' | 'graph-diagram'

export interface RouteModal {
  name: 'settings'
  tab: string
}

export type AppLayout =
  | { kind: 'workbench', modal?: RouteModal }
  | { kind: 'facets', facet: FacetId, view?: GraphView, modal?: RouteModal }

export const WORKBENCH: AppLayout = { kind: 'workbench' }

export function isFacetId(s: string): s is FacetId {
  return (FACET_IDS as string[]).includes(s)
}

function parseModal(params: URLSearchParams): RouteModal | undefined {
  if (params.get('globalModal') !== 'settings') return undefined
  return { name: 'settings', tab: params.get('tab') ?? '' }
}

function withModal<T extends AppLayout>(layout: T, modal: RouteModal | undefined): T {
  return modal ? { ...layout, modal } : layout
}

export function parseRoute(hash: string): AppLayout {
  const withoutHash = hash.replace(/^#\/?/, '')
  const q = withoutHash.indexOf('?')
  const pathPart = q < 0 ? withoutHash : withoutHash.slice(0, q)
  const modal = parseModal(new URLSearchParams(q < 0 ? '' : withoutHash.slice(q + 1)))
  const clean = pathPart.replace(/\/+$/, '')
  if (clean === '' || clean === 'workbench') return withModal({ kind: 'workbench' }, modal)
  const parts = clean.split('/')
  if (parts[0] === 'facets') {
    const facet = isFacetId(parts[1]) ? parts[1] : 'features'
    let view: GraphView | undefined
    if (facet === 'features' && parts[2] === 'graph' && parts.length <= 4) {
      if (parts[3] === 'diagram') view = 'graph-diagram'
      else if (parts[3] === 'report' || parts[3] === undefined) view = 'graph-report'
      // Unknown graph sub-views fall through to the facet screen.
    }
    const layout: AppLayout = view
      ? { kind: 'facets', facet, view }
      : { kind: 'facets', facet }
    return withModal(layout, modal)
  }
  return withModal({ kind: 'workbench' }, modal)
}

export function formatRoute(layout: AppLayout): string {
  let base = layout.kind === 'workbench' ? '#/workbench' : `#/facets/${layout.facet}`
  if (layout.kind === 'facets' && layout.facet === 'features' && layout.view) {
    base += layout.view === 'graph-diagram' ? '/graph/diagram' : '/graph/report'
  }
  if (layout.modal) base += `?globalModal=${layout.modal.name}&tab=${encodeURIComponent(layout.modal.tab)}`
  return base
}
