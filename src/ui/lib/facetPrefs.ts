/**
 * Facet on/off state (Facets design §10): which facets the user
 * has turned off, and which sections inside a facet are hidden.
 * The values live in the device-scope UI prefs (uiPrefs.ts —
 * validated there against the facet registry); this module is the
 * pure read/write logic both sides use: the Settings → Facets
 * section and facet surfaces on the client, and the brief / tool
 * gating on the server (which reads the same validated record
 * back from the app-settings store).
 *
 * The two levels mean different things (§10.2): a facet off also
 * leaves the agent brief and loses its facet-gated tools; a
 * section off is display-only. Overview is the project home and
 * can never be off.
 */
import { facetById, isFacetId, type FacetId, type ProjectFacetId } from './facets.js'
import type { UiPrefs } from './uiPrefs.js'

/** The slice of the prefs record the facet state lives in. */
export type FacetPrefsSlice = Pick<UiPrefs, 'facetsOff' | 'facetSectionsOff'>

export function facetEnabled(prefs: FacetPrefsSlice, id: FacetId): boolean {
  if (id === 'overview') return true
  return !prefs.facetsOff.includes(id as ProjectFacetId)
}

export function sectionEnabled(prefs: FacetPrefsSlice, facet: FacetId, section: string): boolean {
  return !(prefs.facetSectionsOff[facet] ?? []).includes(section)
}

/** The off facets as a set, for brief/tool gating. */
export function facetsOffSet(prefs: FacetPrefsSlice | null | undefined): Set<ProjectFacetId> {
  return new Set(prefs?.facetsOff ?? [])
}

/** A uiPrefs patch that turns a facet on or off (Overview: no-op). */
export function facetTogglePatch(prefs: FacetPrefsSlice, id: FacetId, on: boolean): Partial<UiPrefs> {
  if (id === 'overview') return {}
  const pid = id as ProjectFacetId
  const off = new Set(prefs.facetsOff)
  if (on) off.delete(pid)
  else off.add(pid)
  return { facetsOff: [...off] }
}

/** A uiPrefs patch that shows or hides one section of a facet. */
export function sectionTogglePatch(prefs: FacetPrefsSlice, facet: FacetId, section: string, on: boolean): Partial<UiPrefs> {
  const current = new Set(prefs.facetSectionsOff[facet] ?? [])
  if (on) current.delete(section)
  else current.add(section)
  const next: Record<string, string[]> = { ...prefs.facetSectionsOff }
  if (current.size) next[facet] = [...current]
  else delete next[facet]
  return { facetSectionsOff: next }
}

/** Validate a raw facetsOff value against the registry (uiPrefs uses this). */
export function sanitizeFacetsOff(value: unknown): ProjectFacetId[] {
  if (!Array.isArray(value)) return []
  const out: ProjectFacetId[] = []
  for (const v of value) {
    if (typeof v === 'string' && isFacetId(v) && v !== 'overview' && !out.includes(v as ProjectFacetId)) {
      out.push(v as ProjectFacetId)
    }
  }
  return out
}

/** Validate a raw facetSectionsOff value: known facets, known sections only. */
export function sanitizeFacetSectionsOff(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, string[]> = {}
  for (const [facet, sections] of Object.entries(value as Record<string, unknown>)) {
    if (!isFacetId(facet) || !Array.isArray(sections)) continue
    const known = new Set(facetById(facet).sections.map(s => s.id))
    const clean = [...new Set(sections.filter((s): s is string => typeof s === 'string' && known.has(s)))]
    if (clean.length) out[facet] = clean
  }
  return out
}
