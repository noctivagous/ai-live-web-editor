/**
 * The design guide record (Facets design §3.3): the keystone of
 * the Graphic Design facet. One schema, three uses — the facet's
 * editing form, the import wizard's target (§3.8), and the design
 * pack payload format (§3.7). It lives at `ai-design/guide.json`
 * in the project root, beside `ai-features/`; sanitized on load
 * the way project.ai.json is, and absence is a first-class state
 * (undesignated — the facet then shows what it detected and
 * suggests a pack, never invents a guide).
 *
 * Every field is optional: a partial guide is a real guide.
 * Tokens are NOT duplicated here — the record points at the
 * project's token source (§3.4); values live in that file.
 */
import fs from 'node:fs'
import path from 'node:path'
import { getFsRoot } from '../launcher.js'

export const DESIGN_DIR = 'ai-design'
export const DESIGN_GUIDE_FILE = 'guide.json'

export type TokenSourceKind = 'css-variables' | 'tokens-json' | 'tailwind'

export interface TypeFamily { name: string, role?: string, source?: string }
export interface TypeStep { step: string, size: string, weight?: string, lineHeight?: string, role?: string }
export interface Breakpoint { name: string, minWidth: number }
export interface IconSet { name: string, source?: string, format?: string }
export interface GuideComponent { name: string, note?: string }

export interface DesignGuide {
  version: 1
  name?: string
  description?: string
  /** Design principles and usage guidance (Markdown). The agent
   * brief carries this prose. */
  principles?: string
  tokens?: {
    source?: TokenSourceKind
    /** Project-relative path of the token source file. */
    file?: string
    /** Group names the source carries (colour, spacing, …). */
    groups?: string[]
  }
  typography?: {
    families: TypeFamily[]
    scale: TypeStep[]
  }
  layout?: {
    grid?: { columns?: number, gutter?: string, margin?: string }
    breakpoints: Breakpoint[]
    spacingBase?: number
  }
  icons?: {
    sets: IconSet[]
    usage?: string
  }
  /** The component inventory the GUI guide previews (§3.6);
   * derived by default (slice 4), notes overridable here. */
  components?: GuideComponent[]
  voice?: string
  motion?: string
  /** The design pack this guide arrived with, if any (§2.3). */
  provenance?: string
}

const str = (v: unknown, max = 500): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

function strList(v: unknown, max = 40): string[] {
  if (!Array.isArray(v)) return []
  return [...new Set(v.map(x => str(x, 120)).filter((x): x is string => Boolean(x)))].slice(0, max)
}

function objList<T>(v: unknown, parse: (item: Record<string, unknown>) => T | undefined, max = 80): T[] {
  if (!Array.isArray(v)) return []
  const out: T[] = []
  for (const item of v) {
    if (item && typeof item === 'object') {
      const parsed = parse(item as Record<string, unknown>)
      if (parsed) out.push(parsed)
    }
    if (out.length >= max) break
  }
  return out
}

export function sanitizeDesignGuide(value: unknown): DesignGuide {
  const guide: DesignGuide = { version: 1 }
  if (!value || typeof value !== 'object') return guide
  const v = value as Record<string, unknown>
  guide.name = str(v.name, 120)
  guide.description = str(v.description, 1000)
  guide.principles = str(v.principles, 8000)
  guide.voice = str(v.voice, 1000)
  guide.motion = str(v.motion, 1000)
  guide.provenance = str(v.provenance, 120)
  if (v.tokens && typeof v.tokens === 'object') {
    const t = v.tokens as Record<string, unknown>
    const source = t.source === 'css-variables' || t.source === 'tokens-json' || t.source === 'tailwind' ? t.source : undefined
    const file = str(t.file, 300)
    const groups = strList(t.groups)
    if (source || file || groups.length) guide.tokens = { ...(source ? { source } : {}), ...(file ? { file } : {}), ...(groups.length ? { groups } : {}) }
  }
  if (v.typography && typeof v.typography === 'object') {
    const t = v.typography as Record<string, unknown>
    const families = objList(t.families, f => {
      const name = str(f.name, 120)
      return name ? { name, ...(str(f.role, 120) ? { role: str(f.role, 120) } : {}), ...(str(f.source, 300) ? { source: str(f.source, 300) } : {}) } : undefined
    })
    const scale = objList(t.scale, s => {
      const step = str(s.step, 60)
      const size = str(s.size, 60)
      return step && size ? { step, size, ...(str(s.weight, 30) ? { weight: str(s.weight, 30) } : {}), ...(str(s.lineHeight, 30) ? { lineHeight: str(s.lineHeight, 30) } : {}), ...(str(s.role, 120) ? { role: str(s.role, 120) } : {}) } : undefined
    })
    if (families.length || scale.length) guide.typography = { families, scale }
  }
  if (v.layout && typeof v.layout === 'object') {
    const l = v.layout as Record<string, unknown>
    const breakpoints = objList(l.breakpoints, b => {
      const name = str(b.name, 60)
      const minWidth = num(b.minWidth)
      return name && minWidth !== undefined ? { name, minWidth } : undefined
    })
    const gridRaw = (l.grid && typeof l.grid === 'object') ? l.grid as Record<string, unknown> : {}
    const grid = {
      ...(num(gridRaw.columns) !== undefined ? { columns: num(gridRaw.columns) } : {}),
      ...(str(gridRaw.gutter, 30) ? { gutter: str(gridRaw.gutter, 30) } : {}),
      ...(str(gridRaw.margin, 30) ? { margin: str(gridRaw.margin, 30) } : {}),
    }
    const spacingBase = num(l.spacingBase)
    if (breakpoints.length || Object.keys(grid).length || spacingBase !== undefined) {
      guide.layout = { ...(Object.keys(grid).length ? { grid } : {}), breakpoints, ...(spacingBase !== undefined ? { spacingBase } : {}) }
    }
  }
  if (v.icons && typeof v.icons === 'object') {
    const i = v.icons as Record<string, unknown>
    const sets = objList(i.sets, s => {
      const name = str(s.name, 120)
      return name ? { name, ...(str(s.source, 300) ? { source: str(s.source, 300) } : {}), ...(str(s.format, 30) ? { format: str(s.format, 30) } : {}) } : undefined
    })
    const usage = str(i.usage, 1000)
    if (sets.length || usage) guide.icons = { sets, ...(usage ? { usage } : {}) }
  }
  const components = objList(v.components, c => {
    const name = str(c.name, 120)
    return name ? { name, ...(str(c.note, 500) ? { note: str(c.note, 500) } : {}) } : undefined
  }, 200)
  if (components.length) guide.components = components
  // Drop keys sanitize left undefined so the stored record stays clean.
  for (const k of Object.keys(guide) as (keyof DesignGuide)[]) {
    if (guide[k] === undefined) delete guide[k]
  }
  return guide
}

/** True when the guide carries anything beyond its version stamp. */
export function guideDesignated(guide: DesignGuide | null): boolean {
  if (!guide) return false
  return Object.keys(guide).length > 1
}

export function designGuidePath(root: string): string {
  return path.join(root, DESIGN_DIR, DESIGN_GUIDE_FILE)
}

/** Read the guide under `root` (default: the active project). Null when undesignated. */
export function getDesignGuide(root: string = getFsRoot()): DesignGuide | null {
  try {
    const guide = sanitizeDesignGuide(JSON.parse(fs.readFileSync(designGuidePath(root), 'utf-8')))
    return guideDesignated(guide) ? guide : null
  } catch {
    return null
  }
}

/** Write the guide (sanitized); returns the stored record. */
export function saveDesignGuide(guide: unknown, root: string = getFsRoot()): DesignGuide {
  const clean = sanitizeDesignGuide(guide)
  fs.mkdirSync(path.join(root, DESIGN_DIR), { recursive: true })
  fs.writeFileSync(designGuidePath(root), JSON.stringify(clean, null, 2) + '\n', 'utf-8')
  return clean
}

/**
 * The compact design brief injected into agent turns: the guide's
 * name and principles digest, and where the tokens live — the
 * instruction the styleSet line pioneered, now naming the full
 * record. Empty string when undesignated.
 */
export function designGuideSummary(guide: DesignGuide | null): string {
  if (!guide) return ''
  const parts: string[] = []
  parts.push(`Design guide: ${guide.name ?? 'unnamed'}${guide.description ? ` — ${guide.description}` : ''}`)
  if (guide.tokens?.file) {
    parts.push(`Design tokens live in ${guide.tokens.file} (${guide.tokens.source ?? 'token source'}) — use its tokens for new UI; do not hard-code colours or sizes.`)
  } else if (guide.tokens?.source) {
    parts.push(`Design token source: ${guide.tokens.source} — use its tokens for new UI.`)
  }
  if (guide.principles) {
    const digest = guide.principles.replace(/\s+/g, ' ').trim()
    parts.push(`Design principles: ${digest.length > 400 ? `${digest.slice(0, 397)}…` : digest}`)
  }
  if (guide.typography?.families?.length) {
    parts.push(`Type families: ${guide.typography.families.map(f => f.name).join(', ')}.`)
  }
  if (guide.icons?.sets?.length) {
    parts.push(`Icon sets: ${guide.icons.sets.map(s => s.name).join(', ')}.`)
  }
  if (guide.provenance) parts.push(`(This guide arrived with the ${guide.provenance} design pack.)`)
  return parts.join(' ')
}

/**
 * The §3.3 schema as JSON Schema, so imported guides and design
 * packs can be validated outside the facet's form too (§3.8).
 */
export const DESIGN_GUIDE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'DesignGuide',
  type: 'object',
  properties: {
    version: { const: 1 },
    name: { type: 'string' },
    description: { type: 'string' },
    principles: { type: 'string' },
    tokens: {
      type: 'object',
      properties: {
        source: { enum: ['css-variables', 'tokens-json', 'tailwind'] },
        file: { type: 'string' },
        groups: { type: 'array', items: { type: 'string' } },
      },
    },
    typography: {
      type: 'object',
      properties: {
        families: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string' }, source: { type: 'string' } }, required: ['name'] } },
        scale: { type: 'array', items: { type: 'object', properties: { step: { type: 'string' }, size: { type: 'string' }, weight: { type: 'string' }, lineHeight: { type: 'string' }, role: { type: 'string' } }, required: ['step', 'size'] } },
      },
    },
    layout: {
      type: 'object',
      properties: {
        grid: { type: 'object', properties: { columns: { type: 'number' }, gutter: { type: 'string' }, margin: { type: 'string' } } },
        breakpoints: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, minWidth: { type: 'number' } }, required: ['name', 'minWidth'] } },
        spacingBase: { type: 'number' },
      },
    },
    icons: {
      type: 'object',
      properties: {
        sets: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, source: { type: 'string' }, format: { type: 'string' } }, required: ['name'] } },
        usage: { type: 'string' },
      },
    },
    components: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, note: { type: 'string' } }, required: ['name'] } },
    voice: { type: 'string' },
    motion: { type: 'string' },
    provenance: { type: 'string' },
  },
} as const
