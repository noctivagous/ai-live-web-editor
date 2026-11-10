/**
 * Design packs (Facets design §2 envelope, §3.7): skin-like
 * premade packages — a design guide record, a tokens file, and
 * an icon configuration under one pack.json-shaped envelope.
 * Preview runs the §2.2 reconciliation vocabulary against the
 * current guide and tokens; apply is the §2.3 small-apply path
 * (the preview is the confirmation): the guide is written with
 * the pack's provenance stamp and the pack's token file is
 * written to the guide's token source path.
 *
 * Stock packs live in `catalog/design-packs.json` (the Library
 * holds all catalog kinds, §12 decision 4); user packs arrive
 * through the import wizard (§3.8) with the same shape.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getFsRoot } from '../launcher.js'
import { getDesignGuide, saveDesignGuide, sanitizeDesignGuide, type DesignGuide } from './designGuide.js'
import { detectTokenSource, readTokens } from './designGraph.js'

export interface PackEnvelope {
  id: string
  kind: 'feature' | 'architecture' | 'design'
  name: string
  version: string
  author?: string
  description: string
  contents: string[]
}

export interface DesignPack extends PackEnvelope {
  kind: 'design'
  guide: DesignGuide
  /** The pack's token file content and the project-relative
   * path it belongs at (the guide's token pointer names it). */
  tokensFile?: { path: string, content: string }
}

const CATALOG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'catalog')
const DESIGN_PACKS_PATH = path.join(CATALOG_DIR, 'design-packs.json')

let cached: DesignPack[] | null = null

export function sanitizeDesignPack(raw: unknown): DesignPack | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id.trim() : ''
  const name = typeof r.name === 'string' ? r.name.trim() : ''
  if (!id || !name || r.kind !== 'design') return null
  const guide = sanitizeDesignGuide(r.guide)
  if (!guide) return null
  const tf = r.tokensFile as Record<string, unknown> | undefined
  return {
    id,
    kind: 'design',
    name,
    version: typeof r.version === 'string' ? r.version : '1.0.0',
    ...(typeof r.author === 'string' ? { author: r.author } : {}),
    description: typeof r.description === 'string' ? r.description : '',
    contents: Array.isArray(r.contents) ? r.contents.filter((c): c is string => typeof c === 'string') : ['guide', ...(tf ? ['tokens'] : [])],
    guide,
    ...(tf && typeof tf.path === 'string' && typeof tf.content === 'string'
      ? { tokensFile: { path: tf.path, content: tf.content } }
      : {}),
  }
}

export function loadDesignPacks(filePath: string = DESIGN_PACKS_PATH): DesignPack[] {
  if (cached && filePath === DESIGN_PACKS_PATH) return cached
  let packs: DesignPack[] = []
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { packs?: unknown[] }
    packs = (raw.packs ?? []).map(sanitizeDesignPack).filter((p): p is DesignPack => p !== null)
  } catch { /* no manifest: no stock design packs */ }
  if (filePath === DESIGN_PACKS_PATH) cached = packs
  return packs
}

export function resetDesignPacksCache(): void { cached = null }

export function getDesignPack(id: string, packs: DesignPack[] = loadDesignPacks()): DesignPack | undefined {
  return packs.find(p => p.id === id)
}

/* ── Preview: §2.2 reconciliation states ───────────────────── */

export type ReconcileState = 'missing' | 'present' | 'conflicting' | 'extra'
export interface PackPreviewItem { item: string, state: ReconcileState, detail: string }
export interface DesignPackPreview { pack: string, items: PackPreviewItem[] }

export function previewDesignPack(pack: DesignPack, root: string = getFsRoot()): DesignPackPreview {
  const items: PackPreviewItem[] = []
  const guide = getDesignGuide(root)
  if (!guide) {
    items.push({ item: 'design guide', state: 'missing', detail: `No guide yet — the ${pack.name} guide would be written.` })
  } else if (guide.provenance === pack.id) {
    items.push({ item: 'design guide', state: 'present', detail: 'This pack\u2019s guide is already the project guide.' })
  } else {
    items.push({ item: 'design guide', state: 'conflicting', detail: `The project has a different guide (${guide.name ?? 'unnamed'}); applying replaces it and stamps this pack as its source.` })
  }

  const source = detectTokenSource(root, guide)
  const current = new Map((source ? readTokens(root, source) : []).map(t => [t.name, t.value]))
  const packTokens = pack.tokensFile ? parsePackTokens(pack) : []
  for (const t of packTokens) {
    const cur = current.get(t.name)
    if (cur === undefined) items.push({ item: `token ${t.name}`, state: 'missing', detail: `Would be added as ${t.value}.` })
    else if (cur === t.value) items.push({ item: `token ${t.name}`, state: 'present', detail: `Already ${t.value}.` })
    else items.push({ item: `token ${t.name}`, state: 'conflicting', detail: `Project has ${cur}; the pack has ${t.value}.` })
  }
  const packNames = new Set(packTokens.map(t => t.name))
  for (const name of current.keys()) {
    if (!packNames.has(name)) items.push({ item: `token ${name}`, state: 'extra', detail: 'In your project, not in this pack — applying leaves it alone.' })
  }
  if (pack.guide.icons?.sets?.length) {
    const have = new Set((guide?.icons?.sets ?? []).map(s => s.name))
    for (const s of pack.guide.icons.sets) {
      items.push({ item: `icon set ${s.name}`, state: have.has(s.name) ? 'present' : 'missing', detail: have.has(s.name) ? 'Already configured.' : 'Would be added to the guide\u2019s icon sets.' })
    }
  }
  return { pack: pack.id, items }
}

function parsePackTokens(pack: DesignPack): { name: string, value: string }[] {
  if (!pack.tokensFile) return []
  if (pack.tokensFile.path.endsWith('.json')) {
    try {
      const out: { name: string, value: string }[] = []
      const walk = (node: unknown, trail: string[]) => {
        if (!node || typeof node !== 'object') return
        const rec = node as Record<string, unknown>
        const v = rec.$value ?? rec.value
        if (typeof v === 'string' || typeof v === 'number') { out.push({ name: trail.join('-'), value: String(v) }); return }
        for (const [k, val] of Object.entries(rec)) if (!k.startsWith('$')) walk(val, [...trail, k])
      }
      walk(JSON.parse(pack.tokensFile.content), [])
      return out
    } catch { return [] }
  }
  return [...pack.tokensFile.content.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(m => ({ name: m[1], value: m[2].trim() }))
}

/* ── Apply (§2.3 small apply; preview is the confirmation) ── */

export function applyDesignPack(pack: DesignPack, root: string = getFsRoot()): { guide: DesignGuide, tokensFile?: string } {
  const guide = saveDesignGuide({ ...pack.guide, provenance: pack.id }, root)
  let tokensFile: string | undefined
  if (pack.tokensFile) {
    const dest = path.join(root, pack.tokensFile.path)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, pack.tokensFile.content, 'utf-8')
    tokensFile = pack.tokensFile.path
  }
  return { guide, ...(tokensFile ? { tokensFile } : {}) }
}
