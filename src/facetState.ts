/**
 * Server-side read of the facet on/off state (Facets design §10):
 * the device-scope UI prefs, read back from the app-settings store
 * (the same validated record the client writes). Facet-off is the
 * level that changes agent behaviour — summaries leave the brief
 * and facet-gated tools stop being offered. Reads never throw:
 * no stored prefs means every facet is on.
 */
import { appSettings } from './appSettings.js'
import { facetsOffSet } from './ui/lib/facetPrefs.js'
import type { ProjectFacetId } from './ui/lib/facets.js'

export function facetsOff(): Set<ProjectFacetId> {
  try {
    return facetsOffSet(appSettings().get().uiPrefs)
  } catch {
    return new Set()
  }
}

export function facetOff(id: ProjectFacetId): boolean {
  return facetsOff().has(id)
}
