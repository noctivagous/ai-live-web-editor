/**
 * Rung 0 (P0): DOM ↔ source identity — heuristic join.
 *
 * Maps a live-DOM selector (overlay `buildSelector` chains, snapshot cssPaths,
 * bridge `stableId`s) back to the source file/component that renders it.
 * Works on our generated code with no build change: id / data-* anchors first,
 * then class tokens, then text-snippet words, then structural tag fallback.
 *
 * Pure module (no fs): the caller supplies `{ path, content }` files.
 * Forward-compatible with the exact join (spike option b): when the Vite
 * plugin stamps `data-ai-loc="file:line"`, the bridge can pass it as
 * `sourceLoc` and resolution short-circuits to exact.
 */

export type ResolveInput = {
  selector: string
  stableId?: string
  textSnippet?: string
  classList?: string[]
  tagName?: string
  /** Exact join (Vite transform stamp), when the bridge supplies it. */
  sourceLoc?: { file: string, line?: number }
}

export type SourceFile = { path: string, content: string }

export type ResolveCandidate = { file: string, score: number, anchorHits: string[] }

export type ResolvedSource = {
  ok: boolean
  file?: string
  component?: string
  jsxRange?: { startLine: number, endLine: number }
  props?: string[]
  confidence?: 'exact' | 'heuristic' | 'ambiguous' | 'unresolved'
  candidates?: ResolveCandidate[]
  error?: string
}

export const TESTID_KEYS = ['data-testid', 'data-test', 'data-cy', 'data-qa', 'data-ai-loc']

type Anchors = {
  id?: string
  testIds: Array<{ key: string, value: string }>
  classes: string[]
  tags: string[]
  textWords: string[]
}

function wordsOf(text: string | undefined): string[] {
  if (!text) return []
  return String(text)
    .split(/[\s_]+/)
    .map((w) => w.replace(/[^\w$-]/g, ''))
    .filter((w) => w.length >= 3)
    .slice(0, 8)
}

/** Parse the selector/stableId surface into weighted anchors. */
export function parseAnchors(input: ResolveInput): Anchors {
  const raw = `${input.stableId || ''} ${input.selector || ''}`
  const testIds: Array<{ key: string, value: string }> = []
  const idAttr = raw.match(/#([\w-]+)/)
  for (const key of TESTID_KEYS) {
    const m = raw.match(new RegExp(`\\[${key}=["']?([^"'\\]]+)["']?\\]`))
    if (m) testIds.push({ key, value: m[1] })
  }
  // id:foo stableIds
  const stableId = (input.stableId || '').match(/^id:(.+)$/)
  const id = stableId ? stableId[1] : idAttr ? idAttr[1] : undefined
  const classes = [...(input.classList || [])]
  for (const m of raw.matchAll(/\.([\w-]+)/g)) {
    if (!classes.includes(m[1])) classes.push(m[1])
  }
  const tags = [...raw.matchAll(/(^|[\s>])([a-z][a-z0-9]*)(?=[\s>.:#[,]|$)/gi)]
    .map((m) => m[2].toLowerCase())
    .filter((t) => !['html', 'body'].includes(t))
  if (input.tagName && !tags.includes(input.tagName.toLowerCase())) {
    tags.push(input.tagName.toLowerCase())
  }
  return { id, testIds, classes: classes.slice(0, 8), tags, textWords: wordsOf(input.textSnippet) }
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function countHits(content: string, re: RegExp): number {
  let n = 0
  const lines = content.split('\n')
  for (const line of lines) {
    re.lastIndex = 0
    if (re.test(line)) n++
  }
  return n
}

/** Component definition enclosing `line` (1-based): nearest `function Name` / `const Name =` above it. */
export function enclosingComponent(content: string, line: number): { name: string, defLine: number, props: string[] } | null {
  const lines = content.split('\n')
  for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
    const t = lines[i]
    const m = t.match(/(?:function\s+([A-Z]\w*)|(?:const|let|var)\s+([A-Z]\w*)\s*=)/)
    if (!m) continue
    const name = m[1] || m[2]
    const params = t.match(/\(\s*\{([^}]*)\}/)
    const props = params
      ? params[1].split(',').map((p) => p.trim().split(/[:=]/)[0].trim()).filter(Boolean)
      : []
    return { name, defLine: i + 1, props }
  }
  return null
}

function scoreFile(content: string, anchors: Anchors): { score: number, anchorHits: string[], bestLine: number } {
  let score = 0
  const anchorHits: string[] = []
  let bestLine = 0
  const lines = content.split('\n')

  const findLine = (re: RegExp): number => {
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0
      if (re.test(lines[i])) return i + 1
    }
    return 0
  }

  if (anchors.id) {
    const re = new RegExp(`id\\s*=\\s*["'{]*${escapeReg(anchors.id)}["'}]*`)
    const hits = countHits(content, re)
    if (hits > 0) {
      score += 10
      anchorHits.push(`id:${anchors.id}`)
      bestLine = bestLine || findLine(re)
    }
  }
  for (const { key, value } of anchors.testIds) {
    const re = new RegExp(`${escapeReg(key)}\\s*=\\s*["']${escapeReg(value)}["']`)
    const hits = countHits(content, re)
    if (hits > 0) {
      score += 8
      anchorHits.push(`${key}:${value}`)
      bestLine = bestLine || findLine(re)
    }
  }
  for (const cls of anchors.classes) {
    const re = new RegExp(`\\b${escapeReg(cls)}\\b`)
    if (countHits(content, re) > 0) {
      score += 2
      anchorHits.push(`class:${cls}`)
      if (!bestLine) bestLine = findLine(re)
    }
  }
  for (const w of anchors.textWords) {
    const re = new RegExp(`\\b${escapeReg(w)}\\b`)
    if (countHits(content, re) > 0) {
      score += 1
      anchorHits.push(`text:${w}`)
      if (!bestLine) bestLine = findLine(re)
    }
  }
  if (score === 0 && anchors.tags.length > 0) {
    // Structural fallback: no anchors hit; rank by distinct selector tags present as JSX.
    let tagHits = 0
    for (const tag of new Set(anchors.tags)) {
      const re = new RegExp(`<${escapeReg(tag)}[\\s>]`)
      if (countHits(content, re) > 0) tagHits++
    }
    if (tagHits > 0) {
      score += tagHits * 0.5
      anchorHits.push(`tags:${tagHits}/${new Set(anchors.tags).size}`)
      for (const tag of new Set(anchors.tags)) {
        const ln = findLine(new RegExp(`<${escapeReg(tag)}[\\s>]`))
        if (ln) { bestLine = ln; break }
      }
    }
  }
  return { score, anchorHits, bestLine }
}

/**
 * One resolver: selector → { file, component, jsxRange?, props? }.
 * Fail-closed: ambiguous top scores and zero scores return ok:false.
 */
export function resolveSelector(input: ResolveInput, files: SourceFile[]): ResolvedSource {
  if (input.sourceLoc?.file) {
    const target = files.find((f) => f.path === input.sourceLoc!.file || f.path.endsWith('/' + input.sourceLoc!.file))
    if (!target) return { ok: false, confidence: 'unresolved', error: `sourceLoc file not in project: ${input.sourceLoc.file}` }
    const line = input.sourceLoc.line || 1
    const comp = enclosingComponent(target.content, line)
    return {
      ok: true,
      file: target.path,
      component: comp?.name,
      jsxRange: comp ? { startLine: comp.defLine, endLine: Math.max(comp.defLine, line) } : { startLine: line, endLine: line },
      props: comp?.props,
      confidence: 'exact',
    }
  }
  if (!input.selector && !input.stableId) {
    return { ok: false, confidence: 'unresolved', error: 'selector or stableId required' }
  }
  const anchors = parseAnchors(input)
  const ranked = files
    .map((f) => ({ file: f.path, ...scoreFile(f.content, anchors) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
  if (!ranked.length) {
    return { ok: false, confidence: 'unresolved', error: `no source anchors match: ${input.selector || input.stableId}` }
  }
  const structuralOnly = ranked.every((r) => r.anchorHits.every((h) => h.startsWith('tags:')))
  if (ranked.length > 1 && ranked[0].score === ranked[1].score && !structuralOnly) {
    return {
      ok: false,
      confidence: 'ambiguous',
      error: `selector matches ${ranked[0].file} and ${ranked[1].file} equally`,
      candidates: ranked.slice(0, 3).map(({ file, score, anchorHits }) => ({ file, score, anchorHits })),
    }
  }
  const top = ranked[0]
  const content = files.find((f) => f.path === top.file)!.content
  const anchorLine = top.bestLine || 1
  const comp = enclosingComponent(content, anchorLine)
  return {
    ok: true,
    file: top.file,
    component: comp?.name,
    jsxRange: comp
      ? { startLine: comp.defLine, endLine: Math.max(comp.defLine, anchorLine) }
      : { startLine: anchorLine, endLine: anchorLine },
    props: comp?.props,
    confidence: 'heuristic',
    candidates: ranked.length > 1 ? ranked.slice(1, 3).map(({ file, score, anchorHits }) => ({ file, score, anchorHits })) : undefined,
  }
}
