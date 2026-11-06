/**
 * Pure annotation analysis, ported from `update_from_user_changes` in
 * `wireframe-chrome-devtools-mcp/src/tools/live-editing.ts`.
 * No MCP or browser dependencies — usable from the submit endpoint.
 */

export interface PageAnnotation {
  id?: string
  type?: string
  text?: string
  selector?: string
  targetSelector?: string
  source?: string
  /** Agentation fields (optional; overlay notes leave them unset). */
  kind?: 'feedback' | 'placement' | 'rearrange'
  element?: string
  selectedText?: string
  sourceFile?: string
  boundingBox?: { x: number, y: number, width: number, height: number }
  computedStyles?: string
  placement?: { componentType: string, width: number, height: number, text?: string }
  rearrange?: { selector: string, label: string, originalRect: { x: number, y: number, width: number, height: number }, currentRect: { x: number, y: number, width: number, height: number } }
  intentTag?: string
}

export function classifyIntent(annotation: PageAnnotation): string {
  if (annotation?.type === 'move') return 'move'
  if (annotation?.kind === 'rearrange') return 'move'
  if (annotation?.kind === 'placement') return 'layout'
  if (annotation?.intentTag === 'fix') return 'bug'
  const text = String(annotation?.text ?? '').toLowerCase()
  if (/\b(bug|broken|issue|fix|error)\b/.test(text)) return 'bug'
  if (/\b(copy|text|wording|typo|label)\b/.test(text)) return 'copy'
  if (/\b(layout|align|spacing|margin|padding|gap|grid|flex|position|width|height)\b/.test(text)) return 'layout'
  if (/\b(color|typography|font|size|weight|style)\b/.test(text)) return 'style'
  return 'note'
}

export function parseStyleHint(annotation: PageAnnotation): { selector: string; properties: Record<string, string> } | null {
  const selector = annotation?.selector
  if (!selector) return null
  const text = String(annotation?.text ?? '').toLowerCase()
  const properties: Record<string, string> = {}
  const matchValue = (keyword: string): string | null => {
    const m = text.match(new RegExp(`${keyword}\\s+(-?\\d+(?:\\.\\d+)?)`, 'i'))
    return m?.[1] ? `${m[1]}px` : null
  }
  for (const key of ['padding', 'margin', 'gap', 'width', 'height']) {
    const v = matchValue(key)
    if (v) properties[key] = v
  }
  return Object.keys(properties).length ? { selector, properties } : null
}

export interface AnnotationSummary {
  insights: Array<{ id?: string; type?: string; selector?: string; text?: string; intent: string; sourceFile?: string; kind?: string }>
  prioritizedIds: string[]
  moveLinks: Array<{ id?: string; text?: string; sourceSelector: string; targetSelector: string }>
  styleHints: Array<{ selector: string; properties: Record<string, string> }>
}

export function summarizeAnnotations(annotations: PageAnnotation[]): AnnotationSummary {
  const insights = annotations.map(a => ({ id: a?.id, type: a?.type, selector: a?.selector, text: a?.text, intent: classifyIntent(a), sourceFile: a?.sourceFile, kind: a?.kind }))
  const priorityOrder = ['bug', 'move', 'layout', 'style', 'copy', 'note']
  const prioritizedIds = insights
    .slice()
    .sort((a, b) => priorityOrder.indexOf(a.intent) - priorityOrder.indexOf(b.intent))
    .map(i => i.id)
    .filter((id): id is string => Boolean(id))
  const moveLinks = annotations
    .filter(a => a?.type === 'move' && a?.selector && a?.targetSelector)
    .map(a => ({ id: a.id, text: a.text, sourceSelector: a.selector!, targetSelector: a.targetSelector! }))
  const styleHints = annotations
    .filter(a => classifyIntent(a) === 'layout' || classifyIntent(a) === 'style')
    .map(parseStyleHint)
    .filter((h): h is { selector: string; properties: Record<string, string> } => Boolean(h))
  return { insights, prioritizedIds, moveLinks, styleHints }
}

export interface AnnotationResolution {
  selector?: string
  file?: string
  component?: string
  startLine?: number
  endLine?: number
  confidence?: string
}

/** The subset of an Agentation annotation this pipeline consumes. */
export interface AgentationAnnotation {
  id?: string
  comment?: string
  element?: string
  elementPath?: string
  fullPath?: string
  selectedText?: string
  sourceFile?: string
  boundingBox?: { x: number, y: number, width: number, height: number }
  computedStyles?: string
  kind?: 'feedback' | 'placement' | 'rearrange'
  intent?: string
  placement?: { componentType: string, width: number, height: number, text?: string }
  rearrange?: { selector: string, label: string, originalRect: { x: number, y: number, width: number, height: number }, currentRect: { x: number, y: number, width: number, height: number } }
}

/**
 * Adapt Agentation annotations onto the live-edit pipeline. The prize
 * field is `sourceFile` (absolute path:line:col from React's fiber
 * debug source): relativised against the project root, it lets the
 * agent skip the grep-for-the-rendering-file step entirely.
 */
export function agentationToAnnotations(list: unknown, fsRoot = ''): PageAnnotation[] {
  if (!Array.isArray(list)) return []
  const root = fsRoot.replace(/\/+$/, '')
  return list.map((raw): PageAnnotation => {
    const a = (raw || {}) as AgentationAnnotation
    let sourceFile = a.sourceFile || undefined
    if (sourceFile && root && sourceFile.startsWith(root + '/')) {
      sourceFile = '/' + sourceFile.slice(root.length + 1)
    }
    const placementText = a.placement
      ? `Place a ${a.placement.componentType} here (${Math.round(a.placement.width)}x${Math.round(a.placement.height)}).${a.placement.text ? ' ' + a.placement.text : ''}`
      : ''
    const rearrangeText = a.rearrange
      ? `Move ${a.rearrange.label || a.rearrange.selector} from (${Math.round(a.rearrange.originalRect.x)}, ${Math.round(a.rearrange.originalRect.y)}) to (${Math.round(a.rearrange.currentRect.x)}, ${Math.round(a.rearrange.currentRect.y)}).`
      : ''
    return {
      id: a.id,
      kind: a.kind,
      element: a.element,
      selector: a.fullPath || a.elementPath || a.rearrange?.selector || '',
      text: a.comment?.trim() || placementText || rearrangeText,
      selectedText: a.selectedText,
      sourceFile,
      boundingBox: a.boundingBox,
      computedStyles: a.computedStyles,
      placement: a.placement,
      rearrange: a.rearrange,
      intentTag: a.intent,
    }
  }).filter(a => a.text || a.selector)
}

/** Build the agent prompt for a submit: annotations first, verification last. */
export function buildLiveEditPrompt(input: {
  annotations: PageAnnotation[]
  summary: AnnotationSummary
  pageNotes: string
  pageUrl: string
  resolutions?: AnnotationResolution[]
}): string {
  const { annotations, summary, pageNotes, pageUrl, resolutions } = input
  const resolvedBySelector = new Map<string, AnnotationResolution>()
  for (const r of resolutions || []) {
    if (r.selector) resolvedBySelector.set(r.selector, r)
  }
  const lines = annotations.map((a, i) => {
    const intent = summary.insights[i]?.intent ?? 'note'
    const target = a.targetSelector ? ` -> move target ${a.targetSelector}` : ''
    const r = resolvedBySelector.get(String(a.selector || ''))
    const where = r?.file
      ? ` (≈ ${r.file}${r.component ? ` ${r.component}` : ''}${r.startLine ? `:${r.startLine}${r.endLine && r.endLine !== r.startLine ? `-${r.endLine}` : ''}` : ''})`
      : a.sourceFile ? '' : ' (≈ source unresolved — call resolve-source first)'
    const parts = [`${i + 1}. [${intent}] ${a.selector}${target}${where}: ${a.text}`]
    if (a.element) parts.push(`   Element: ${a.element}`)
    if (a.selectedText) parts.push(`   Selected text: "${a.selectedText}"`)
    if (a.sourceFile) parts.push(`   Source: ${a.sourceFile} — this is the exact file and line that renders it; read that range and edit there.`)
    if (a.boundingBox) parts.push(`   Box: x=${Math.round(a.boundingBox.x)} y=${Math.round(a.boundingBox.y)} ${Math.round(a.boundingBox.width)}x${Math.round(a.boundingBox.height)}`)
    if (a.computedStyles) parts.push(`   Current styles: ${a.computedStyles.slice(0, 300)}`)
    return parts.join('\n')
  })
  const hints = summary.styleHints.map(h => `- ${h.selector}: ${JSON.stringify(h.properties)}`)
  const out = [
    'Live-edit request: the user annotated the page at ' + pageUrl + '.',
    'Apply each annotation to the real files under the active project. Vite HMR will show the change.',
    'Annotations (priority: bug, move, layout, style, copy, note):',
    ...lines,
  ]
  if (pageNotes) out.push(`Page notes: ${pageNotes}`)
  for (const m of summary.moveLinks) out.push(`Move: relocate ${m.sourceSelector} before ${m.targetSelector} (${m.text})`)
  if (hints.length) out.push('Style hints parsed from the notes (verify before applying):', ...hints)
  out.push(
    annotations.some(a => a.sourceFile)
      ? 'Workflow: annotations with a Source line name the exact rendering file — ranged read-real-file there, then str-replace the fix. For the rest, resolve-source each selector first. write-real-file only if the file is new. Never placeholder-full-write on a replace miss.'
      : 'Workflow: resolve-source each selector (hints above are best-effort — verify), then ranged read-real-file and str-replace the fix. write-real-file only if the file is new. Never placeholder-full-write on a replace miss.',
  )
  return out.join('\n')
}
