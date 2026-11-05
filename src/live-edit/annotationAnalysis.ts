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
}

export function classifyIntent(annotation: PageAnnotation): string {
  if (annotation?.type === 'move') return 'move'
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
  insights: Array<{ id?: string; type?: string; selector?: string; text?: string; intent: string }>
  prioritizedIds: string[]
  moveLinks: Array<{ id?: string; text?: string; sourceSelector: string; targetSelector: string }>
  styleHints: Array<{ selector: string; properties: Record<string, string> }>
}

export function summarizeAnnotations(annotations: PageAnnotation[]): AnnotationSummary {
  const insights = annotations.map(a => ({ id: a?.id, type: a?.type, selector: a?.selector, text: a?.text, intent: classifyIntent(a) }))
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

/** Build the agent prompt for a submit: annotations first, verification last. */
export function buildLiveEditPrompt(input: {
  annotations: PageAnnotation[]
  summary: AnnotationSummary
  pageNotes: string
  pageUrl: string
}): string {
  const { annotations, summary, pageNotes, pageUrl } = input
  const lines = annotations.map((a, i) => {
    const intent = summary.insights[i]?.intent ?? 'note'
    const target = a.targetSelector ? ` -> move target ${a.targetSelector}` : ''
    return `${i + 1}. [${intent}] ${a.selector}${target}: ${a.text}`
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
    'Workflow: grep / ranged read-real-file the file that renders each selector, then str-replace the fix. write-real-file only if the file is new. Never placeholder-full-write on a replace miss.',
  )
  return out.join('\n')
}
