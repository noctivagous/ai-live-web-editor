/**
 * The graphic-design import mapping (Facets design §3.8): read
 * a picked folder/zip's files and fit what can be fitted into
 * the design guide schema (§3.3). The mapping is the contract —
 * every source file lands in exactly one of: mapped (named
 * schema field), unmapped (kept as a resource, listed, never
 * dropped silently), and the schema fields nothing filled are
 * reported as missing. A root pack.json with kind "design"
 * forks the wizard: the folder is a design pack (§3.7), not a
 * loose design system.
 */
import { sanitizeDesignGuide, type DesignGuide } from './designGuide.js'
import { sanitizeDesignPack, type DesignPack } from './designPacks.js'
import { parseCssVariables } from './designGraph.js'

export interface ImportFile { path: string, content: string }
export interface ImportMapping {
  isPack: boolean
  pack?: DesignPack
  mapped: { field: string, source: string, detail: string }[]
  unmapped: { source: string, keptAs: string }[]
  missing: string[]
  guide: DesignGuide | null
  /** Files to place under ai-design/resources/ on confirm. */
  resources: { path: string, content: string }[]
}

const ALL_FIELDS = ['name', 'description', 'principles', 'tokens', 'typography', 'layout', 'icons', 'voice', 'motion']

export function mapDesignImport(files: ImportFile[]): ImportMapping {
  const mapped: ImportMapping['mapped'] = []
  const unmapped: ImportMapping['unmapped'] = []
  const resources: ImportMapping['resources'] = []
  const filled = new Set<string>()

  const packFile = files.find(f => /(^|\/)pack\.json$/.test(f.path))
  if (packFile) {
    try {
      const parsed = JSON.parse(packFile.content) as Record<string, unknown>
      const sibling = files.find(f => f.path.endsWith('guide.json'))
      const pack = sanitizeDesignPack({ ...parsed, ...(sibling ? { guide: JSON.parse(sibling.content) } : {}) })
      if (pack) {
        return {
          isPack: true, pack,
          mapped: [{ field: 'pack', source: packFile.path, detail: `Design pack "${pack.name}" — apply it from the Design packs section.` }],
          unmapped: files.filter(f => f !== packFile && f !== sibling).map(f => ({ source: f.path, keptAs: 'ai-design/resources/' + f.path })),
          missing: [],
          guide: pack.guide,
          resources: files.filter(f => f !== packFile && f !== sibling).map(f => ({ path: f.path, content: f.content })),
        }
      }
    } catch { /* not a pack: fall through to loose mapping */ }
  }

  const guide: Record<string, unknown> = { version: 1 }
  const iconSets = new Map<string, { name: string, source: string, format: string }>()
  const families: { name: string, role: string }[] = []

  for (const f of files) {
    const p = f.path
    const lower = p.toLowerCase()
    if (/(^|\/)design-tokens\.json$|(^|\/)tokens\.json$/.test(lower)) {
      guide.tokens = { source: 'tokens-json', file: p }
      mapped.push({ field: 'tokens', source: p, detail: 'A tokens JSON file — it becomes the token source.' })
      filled.add('tokens')
      resources.push({ path: p, content: f.content })
    } else if (lower.endsWith('.css')) {
      const vars = parseCssVariables(f.content)
      if (vars.length) {
        guide.tokens = { source: 'css-variables', file: p, groups: [...new Set(vars.map(v => v.group))] }
        mapped.push({ field: 'tokens', source: p, detail: `${vars.length} CSS variables become the token source.` })
        filled.add('tokens')
      } else {
        unmapped.push({ source: p, keptAs: 'ai-design/resources/' + p })
      }
      resources.push({ path: p, content: f.content })
      const fontMatch = /font-family\s*:\s*([^;]+);/.exec(f.content)
      if (fontMatch && !families.length) {
        families.push({ name: fontMatch[1].trim(), role: 'body' })
        mapped.push({ field: 'typography', source: p, detail: `Font stack "${fontMatch[1].trim()}" taken as the body family.` })
        filled.add('typography')
      }
    } else if (/\.(woff2?|ttf|otf)$/i.test(p)) {
      const name = p.split('/').pop()!.replace(/\.(woff2?|ttf|otf)$/i, '')
      families.push({ name, role: 'body' })
      mapped.push({ field: 'typography', source: p, detail: `Font file "${name}" noted as a type family; the file is kept as a resource.` })
      filled.add('typography')
      resources.push({ path: p, content: f.content })
    } else if (/\.(svg|png|ico)$/i.test(p)) {
      const dir = p.split('/').slice(0, -1).join('/') || '.'
      if (!iconSets.has(dir)) iconSets.set(dir, { name: dir.split('/').pop() || 'icons', source: dir, format: p.split('.').pop()!.toLowerCase() })
      resources.push({ path: p, content: f.content })
    } else if (/\.(md|markdown|html?|txt)$/i.test(p) && !filled.has('principles')) {
      const text = f.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000)
      if (text) {
        guide.principles = text
        mapped.push({ field: 'principles', source: p, detail: 'Guide document taken as the principles text.' })
        filled.add('principles')
      }
      resources.push({ path: p, content: f.content })
    } else if (lower.endsWith('guide.json')) {
      try {
        const g = sanitizeDesignGuide(JSON.parse(f.content))
        if (g) {
          Object.assign(guide, g)
          for (const k of ALL_FIELDS) if ((g as unknown as Record<string, unknown>)[k] !== undefined) filled.add(k)
          mapped.push({ field: 'guide', source: p, detail: 'A design guide record — its fields fill the form directly.' })
        }
      } catch { unmapped.push({ source: p, keptAs: 'ai-design/resources/' + p }) }
    } else {
      unmapped.push({ source: p, keptAs: 'ai-design/resources/' + p })
      resources.push({ path: p, content: f.content })
    }
  }

  if (iconSets.size) {
    guide.icons = { sets: [...iconSets.values()] }
    for (const s of iconSets.values()) mapped.push({ field: 'icons', source: s.source, detail: `Icon set "${s.name}" (${s.format}).` })
    filled.add('icons')
  }
  if (families.length && !guide.typography) guide.typography = { families, scale: [] }

  const missing = ALL_FIELDS.filter(f => !filled.has(f))
  return {
    isPack: false,
    mapped, unmapped, missing,
    guide: sanitizeDesignGuide(guide),
    resources,
  }
}
