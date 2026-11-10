/**
 * Architecture plan packs (Facets design §4.3, §2 envelope):
 * a pack bundles a plan structure, philosophy/guide prose, its
 * checkable rules, and a refactor outline. Following a pack
 * writes the declaration after preview; applying it to an
 * existing codebase forms a refactor plan in the plan system —
 * the plan is the deliverable, execution is the plan system's
 * existing road, never a one-shot rewrite.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getFsRoot, listProjectFiles } from '../launcher.js'
import { createPlan, addTask, savePlan, type PlanDoc } from '../plans/plans.js'
import {
  getArchitecture, saveArchitecture, saveArchitectureGuide, sanitizeArchitecture,
  type ArchitectureDeclaration,
} from './architecture.js'
import type { PackEnvelope } from '../design/designPacks.js'

export interface ArchPack extends PackEnvelope {
  kind: 'architecture'
  declaration: ArchitectureDeclaration
  guide: string
  refactorOutline: string[]
}

const CATALOG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'catalog')
const ARCH_PACKS_PATH = path.join(CATALOG_DIR, 'architecture-packs.json')

let cached: ArchPack[] | null = null

export function loadArchPacks(filePath: string = ARCH_PACKS_PATH): ArchPack[] {
  if (cached && filePath === ARCH_PACKS_PATH) return cached
  let packs: ArchPack[] = []
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { packs?: Record<string, unknown>[] }
    for (const r of raw.packs ?? []) {
      if (r.kind !== 'architecture' || typeof r.id !== 'string' || typeof r.name !== 'string') continue
      const declaration = sanitizeArchitecture({ ...(r.declaration as object), provenance: r.id })
      if (!declaration) continue
      packs.push({
        id: r.id,
        kind: 'architecture',
        name: r.name,
        version: typeof r.version === 'string' ? r.version : '1.0.0',
        ...(typeof r.author === 'string' ? { author: r.author } : {}),
        description: typeof r.description === 'string' ? r.description : '',
        contents: Array.isArray(r.contents) ? r.contents.filter((c): c is string => typeof c === 'string') : ['plan', 'guide', 'rules', 'refactor outline'],
        declaration,
        guide: typeof r.guide === 'string' ? r.guide : '',
        refactorOutline: Array.isArray(r.refactorOutline) ? r.refactorOutline.filter((s): s is string => typeof s === 'string') : [],
      })
    }
  } catch { /* no manifest: no stock architecture packs */ }
  if (filePath === ARCH_PACKS_PATH) cached = packs
  return packs
}

export function resetArchPacksCache(): void { cached = null }

export function getArchPack(id: string, packs: ArchPack[] = loadArchPacks()): ArchPack | undefined {
  return packs.find(p => p.id === id)
}

export interface ArchPackPreviewItem { item: string, state: 'missing' | 'present' | 'conflicting' | 'extra', detail: string }

/** Reconciliation (§2.2) of the pack's modules against disk. */
export function previewArchPack(pack: ArchPack, root: string = getFsRoot()): ArchPackPreviewItem[] {
  const items: ArchPackPreviewItem[] = []
  const current = getArchitecture(root)
  if (!current) items.push({ item: 'architecture declaration', state: 'missing', detail: `No declaration yet — the ${pack.name} plan would be written.` })
  else if (current.provenance === pack.id) items.push({ item: 'architecture declaration', state: 'present', detail: 'This pack\u2019s declaration is already in place.' })
  else items.push({ item: 'architecture declaration', state: 'conflicting', detail: 'A different declaration is in place; following this pack replaces it.' })

  const entries = listProjectFiles(root).map(e => e.path.replace(/^\//, ''))
  for (const m of pack.declaration.modules) {
    const onDisk = entries.some(f => f === m.path || f.startsWith(m.path.replace(/\/?$/, '/')))
    items.push({
      item: `module ${m.name}`,
      state: onDisk ? 'present' : 'missing',
      detail: onDisk ? `${m.path} exists.` : `${m.path} does not exist yet — the refactor plan would create it.`,
    })
  }
  const packDirs = new Set(pack.declaration.modules.map(m => m.path.split('/')[0]))
  const topDirs = new Set(entries.filter(f => f.includes('/')).map(f => f.split('/')[0]))
  for (const d of topDirs) {
    if (!packDirs.has(d) && !d.startsWith('.') && !d.startsWith('ai-')) {
      items.push({ item: `folder ${d}`, state: 'extra', detail: 'In your project, not in this plan — left alone, listed for information.' })
    }
  }
  return items
}

/** Follow a pack: write its declaration + guide (§4.3). */
export function followArchPack(pack: ArchPack, root: string = getFsRoot()): ArchitectureDeclaration | null {
  const saved = saveArchitecture(pack.declaration, root)
  if (pack.guide) saveArchitectureGuide(pack.guide, root)
  return saved
}

/** Apply to this codebase: form the refactor plan (§4.3). */
export function archPackRefactorPlan(pack: ArchPack, root: string = getFsRoot()): PlanDoc {
  const doc = createPlan({
    title: `Move this codebase to ${pack.name}`,
    kind: 'refactor',
    level: 2,
    goal: `Bring the codebase in line with the ${pack.name} architecture plan pack, step by step, re-running the pack's checkable rules as steps land.`,
  }, root)
  for (const step of pack.refactorOutline) addTask(doc, { text: step })
  for (const rule of pack.declaration.rules) {
    addTask(doc, { text: `Check rule "${rule.id}" passes: ${rule.say}`, detail: 'Run architecture-check and record the evidence in the plan.' })
  }
  return savePlan(doc, root)
}
