/**
 * Cross-facet links (Facets design §8.1): typed references
 * between facets, living in their OWN store beside the owning
 * facet's data (the feature↔userflow `exercises` precedent —
 * not edges inside either graph). Each link is resolvable or
 * visibly dangling: when its target is renamed or removed, the
 * link lists as broken in both facets' reports and on Overview.
 *
 * v1 link kinds (the §11 slice-10 minimum, plus the two other
 * §8.1 kinds whose targets now exist):
 * - feature     uses-component  → a design-graph component node
 * - feature     requires-package → a tech-stack package
 * - feature     needs-config    → a configuration entry (file)
 * - module      follows-rule    → an architecture checkable rule
 * - component   styled-by       → a design pack or token group
 */
import fs from 'node:fs'
import path from 'node:path'
import { getFsRoot } from '../launcher.js'
import { getFeatureGraph } from '../features/features.js'
import { getDesignGraph } from '../design/designGraph.js'
import { deriveTechStack } from '../techstack/techStack.js'
import { deriveConfigInventory } from '../configregistry/configRegistry.js'
import { getArchitecture } from '../architecture/architecture.js'
import { loadDesignPacks } from '../design/designPacks.js'

export type CrossLinkKind = 'uses-component' | 'requires-package' | 'needs-config' | 'follows-rule' | 'styled-by'
export interface CrossLink {
  id: string
  kind: CrossLinkKind
  /** The owning side, as kind-qualified text: e.g. a feature
   * node name, a module name, or a component name. */
  from: string
  /** The target, as kind-qualified text: a component name, a
   * package name, a config file, a rule id, a pack id. */
  to: string
  note?: string
}
export interface CrossLinkFile { version: 1, links: CrossLink[] }

const KINDS: CrossLinkKind[] = ['uses-component', 'requires-package', 'needs-config', 'follows-rule', 'styled-by']

export function crossLinksPath(root: string): string {
  return path.join(root, 'ai-features', 'cross-links.json')
}

export function sanitizeCrossLinks(raw: unknown): CrossLinkFile {
  const out: CrossLink[] = []
  const arr = (raw as { links?: unknown })?.links
  if (Array.isArray(arr)) {
    for (const l of arr.slice(0, 200)) {
      if (!l || typeof l !== 'object') continue
      const rec = l as Record<string, unknown>
      const kind = KINDS.find(k => k === rec.kind)
      const from = typeof rec.from === 'string' ? rec.from.trim() : ''
      const to = typeof rec.to === 'string' ? rec.to.trim() : ''
      if (!kind || !from || !to) continue
      out.push({
        id: typeof rec.id === 'string' && rec.id ? rec.id : `link-${out.length + 1}`,
        kind, from, to,
        ...(typeof rec.note === 'string' && rec.note.trim() ? { note: rec.note.trim().slice(0, 200) } : {}),
      })
    }
  }
  return { version: 1, links: out }
}

export function getCrossLinks(root: string = getFsRoot()): CrossLinkFile {
  try {
    return sanitizeCrossLinks(JSON.parse(fs.readFileSync(crossLinksPath(root), 'utf-8')))
  } catch {
    return { version: 1, links: [] }
  }
}

export function saveCrossLinks(file: CrossLinkFile, root: string = getFsRoot()): CrossLinkFile {
  const clean = sanitizeCrossLinks(file)
  fs.mkdirSync(path.join(root, 'ai-features'), { recursive: true })
  fs.writeFileSync(crossLinksPath(root), JSON.stringify(clean, null, 2) + '\n', 'utf-8')
  return clean
}

export function addCrossLink(link: Omit<CrossLink, 'id'>, root: string = getFsRoot()): CrossLinkFile {
  const file = getCrossLinks(root)
  const id = `link-${Math.max(0, ...file.links.map(l => parseInt(l.id.replace(/\D/g, ''), 10) || 0)) + 1}`
  return saveCrossLinks({ version: 1, links: [...file.links, { ...link, id }] }, root)
}

export function removeCrossLink(id: string, root: string = getFsRoot()): CrossLinkFile {
  const file = getCrossLinks(root)
  return saveCrossLinks({ version: 1, links: file.links.filter(l => l.id !== id) }, root)
}

/* ── Resolution ────────────────────────────────────────────── */

export interface ResolvedLink extends CrossLink { resolved: boolean, targetLabel: string }

export function resolveCrossLinks(root: string = getFsRoot(), file: CrossLinkFile = getCrossLinks(root)): ResolvedLink[] {
  let featureNames = new Set<string>()
  let componentNames = new Set<string>()
  let tokenGroups = new Set<string>()
  let packageNames = new Set<string>()
  let configFiles = new Set<string>()
  let ruleIds = new Set<string>()
  let packIds = new Set<string>()
  try { const g = getFeatureGraph(root); if (g) featureNames = new Set(g.nodes.map(n => n.name)) } catch { /* unresolved is reported, not hidden */ }
  try {
    const dg = getDesignGraph(root)
    if (dg) {
      componentNames = new Set(dg.nodes.filter(n => n.kind === 'component').map(n => n.name))
      tokenGroups = new Set(dg.nodes.filter(n => n.kind === 'token-group').map(n => n.name))
    }
  } catch { /* as above */ }
  try { packageNames = new Set(deriveTechStack(root).packages.map(p => p.name)) } catch { /* as above */ }
  try { configFiles = new Set(deriveConfigInventory(root).groups.flatMap(g => g.entries.map(e => e.file))) } catch { /* as above */ }
  try { const a = getArchitecture(root); if (a) ruleIds = new Set(a.rules.map(r => r.id)) } catch { /* as above */ }
  try { packIds = new Set(loadDesignPacks().map(p => p.id)) } catch { /* as above */ }

  return file.links.map(l => {
    let resolved = false
    let targetLabel = l.to
    switch (l.kind) {
      case 'uses-component': resolved = componentNames.has(l.to); targetLabel = `component ${l.to}`; break
      case 'requires-package': resolved = packageNames.has(l.to); targetLabel = `package ${l.to}`; break
      case 'needs-config': resolved = configFiles.has(l.to); targetLabel = `config ${l.to}`; break
      case 'follows-rule': resolved = ruleIds.has(l.to); targetLabel = `rule ${l.to}`; break
      case 'styled-by': resolved = packIds.has(l.to) || tokenGroups.has(l.to); targetLabel = `pack/token group ${l.to}`; break
    }
    // The owning side of feature links should also still exist
    // when a feature graph is present.
    if (l.kind !== 'follows-rule' && l.kind !== 'styled-by' && featureNames.size && l.kind !== 'uses-component') {
      // from-side check applies to feature-owned links; component-
      // owned (styled-by) and module-owned (follows-rule) differ.
      if ((l.kind === 'requires-package' || l.kind === 'needs-config') && !featureNames.has(l.from)) resolved = false
    }
    if (l.kind === 'uses-component' && featureNames.size && !featureNames.has(l.from)) resolved = false
    return { ...l, resolved, targetLabel }
  })
}

export function brokenCrossLinks(root: string = getFsRoot()): ResolvedLink[] {
  return resolveCrossLinks(root).filter(l => !l.resolved)
}
