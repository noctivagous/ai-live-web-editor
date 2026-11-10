/**
 * Layout routes (slice 5). The app has two loadable layouts — the
 * Workbench (files / editor / preview) and the Facets layout — and
 * the Facets layout has one screen per facet. Layouts and facets
 * map to hash routes, exactly as the prototype settled:
 *
 *   #/workbench            the workbench
 *   #/facets/overview      … Overview (the project home)
 *   #/facets/features      the facets layout, Features facet
 *   #/facets/architecture  … Architecture
 *   #/facets/graphic-design … Graphic Design
 *   #/facets/features/graph/report   the feature graph, report (tree) view
 *   #/facets/features/graph/diagram  the feature graph, diagram view
 *
 * A backdrop modal rides the query string on any route:
 *   ?globalModal=settings&tab=providers  Settings over the current route
 * The open file in the main preview rides the same query string:
 *   ?file=%2Fnotes%2Fxyz.txt     that file open in the preview
 * (combined: ?file=…&globalModal=settings&tab=…)
 *
 * Hash routes keep the whole scheme client-side: the launcher and
 * the Vite server need no new path handling, deep links and
 * Back/Forward work, and menus, wizards, the plan overlay, and ⌘K
 * stay route-less overlays, as agreed. A bare or unknown hash is
 * the workbench — the app's long-standing default view. Unknown
 * graph sub-views and unknown modals fall back to the plain route.
 */

/**
 * Facet ids, titles, and blurbs live in the facet registry
 * (lib/facets) — the single source routes, menus, facet screens,
 * and Settings → Facets all read. Re-exported here because the
 * route module is where facet consumers already look.
 */
import { FACET_BLURBS, FACET_IDS, FACET_TITLES, isFacetId, type FacetId } from './facets.js'

export { FACET_BLURBS, FACET_IDS, FACET_TITLES, type FacetId }

export type GraphView = 'graph-report' | 'graph-diagram'

export interface RouteModal {
  name: 'settings'
  tab: string
}

export type AppLayout =
  | { kind: 'workbench', modal?: RouteModal, file?: string }
  | { kind: 'facets', facet: FacetId, view?: GraphView, modal?: RouteModal, file?: string }

export const WORKBENCH: AppLayout = { kind: 'workbench' }

function parseModal(params: URLSearchParams): RouteModal | undefined {
  if (params.get('globalModal') !== 'settings') return undefined
  return { name: 'settings', tab: params.get('tab') ?? '' }
}

function withQuery<T extends AppLayout>(layout: T, modal: RouteModal | undefined, file: string | undefined): T {
  return {
    ...layout,
    ...(modal ? { modal } : {}),
    ...(file ? { file } : {}),
  }
}

export function parseRoute(hash: string): AppLayout {
  const withoutHash = hash.replace(/^#\/?/, '')
  const q = withoutHash.indexOf('?')
  const pathPart = q < 0 ? withoutHash : withoutHash.slice(0, q)
  const params = new URLSearchParams(q < 0 ? '' : withoutHash.slice(q + 1))
  const modal = parseModal(params)
  const file = params.get('file') || undefined
  const clean = pathPart.replace(/\/+$/, '')
  if (clean === '' || clean === 'workbench') return withQuery({ kind: 'workbench' }, modal, file)
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
    return withQuery(layout, modal, file)
  }
  return withQuery({ kind: 'workbench' }, modal, file)
}

export function formatRoute(layout: AppLayout): string {
  let base = layout.kind === 'workbench' ? '#/workbench' : `#/facets/${layout.facet}`
  if (layout.kind === 'facets' && layout.facet === 'features' && layout.view) {
    base += layout.view === 'graph-diagram' ? '/graph/diagram' : '/graph/report'
  }
  const query = new URLSearchParams()
  if (layout.file) query.set('file', layout.file)
  if (layout.modal) {
    query.set('globalModal', layout.modal.name)
    query.set('tab', layout.modal.tab)
  }
  const qs = query.toString()
  return qs ? `${base}?${qs}` : base
}
