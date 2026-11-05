/** Turn a page-bridge layout capture into a snapshot with overlap analysis. */
export type PageLayoutCapture = {
  ok?: boolean
  error?: string
  schemaVersion?: number
  coordinateSpace?: 'viewport' | 'document'
  page?: {
    url: string
    viewport: { width: number, height: number, devicePixelRatio?: number }
    scroll: { x: number, y: number }
  }
  computedStyleWhitelist?: string[]
  elements?: Array<{
    tagName: string
    id?: string
    classList?: string[]
    textSnippet?: string
    rect: { x: number, y: number, width: number, height: number, left: number, top: number, right: number, bottom: number }
    computedStyles?: Record<string, string>
    stableId: string
    parentStableId?: string
  }>
  truncated?: boolean
}

function area(r: { width: number, height: number }) {
  return Math.max(0, r.width) * Math.max(0, r.height)
}

function intersection(a: PageLayoutCapture['elements'][number]['rect'], b: PageLayoutCapture['elements'][number]['rect']) {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.right, b.right)
  const bottom = Math.min(a.bottom, b.bottom)
  const width = right - left
  const height = bottom - top
  if (width <= 0 || height <= 0) return null
  return { x: left, y: top, width, height, left, top, right, bottom }
}

export function finishPageLayout(raw: PageLayoutCapture, opts: { includeOverlapAnalysis?: boolean, analysisMaxFindings?: number } = {}) {
  if (!raw || raw.error) return raw
  const elements = raw.elements || []
  const output: any = {
    schemaVersion: raw.schemaVersion ?? 2,
    coordinateSpace: raw.coordinateSpace ?? 'viewport',
    page: raw.page,
    computedStyleWhitelist: raw.computedStyleWhitelist || [],
    elements,
    truncated: Boolean(raw.truncated),
    via: 'vite-page',
  }
  if (opts.includeOverlapAnalysis === false) return output
  const overlaps: any[] = []
  const maxFindings = Math.min(100, Math.max(1, opts.analysisMaxFindings ?? 40))
  const parent = new Set(elements.map((e) => e.stableId + '>' + (e.parentStableId || '')))
  const isChild = (a: string, b: string) => parent.has(a + '>' + b) || parent.has(b + '>' + a)
  outer: for (let i = 0; i < elements.length; i++) {
    const a = elements[i]
    const aArea = area(a.rect)
    if (!a.stableId || aArea <= 0) continue
    for (let j = i + 1; j < elements.length; j++) {
      const b = elements[j]
      const bArea = area(b.rect)
      if (!b.stableId || bArea <= 0) continue
      if (a.parentStableId === b.stableId || b.parentStableId === a.stableId || isChild(a.stableId, b.stableId)) continue
      const hit = intersection(a.rect, b.rect)
      if (!hit) continue
      const ov = area(hit)
      if (ov < 16) continue
      overlaps.push({
        a: a.stableId,
        b: b.stableId,
        area: ov,
        rect: hit,
        overlapRatioA: ov / aArea,
        overlapRatioB: ov / bArea,
      })
      if (overlaps.length >= maxFindings) break outer
    }
  }
  overlaps.sort((x, y) => y.area - x.area)
  output.analysis = { overlaps, meta: { overlapCount: overlaps.length } }
  return output
}
