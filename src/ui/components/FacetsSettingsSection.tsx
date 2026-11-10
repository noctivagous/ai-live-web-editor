import { useState } from 'react'
import { FACETS } from '../lib/facets'
import { facetEnabled, facetTogglePatch, sectionEnabled, sectionTogglePatch } from '../lib/facetPrefs'
import { loadUiPrefs, saveUiPrefs, type UiPrefs } from '../lib/uiPrefs'

/**
 * Settings → Facets (Facets design §10): turn a facet — or one
 * section inside a facet — on or off. The facet and section lists
 * come from the facet registry (lib/facets), the same list the
 * facet screens render from, so a section can never be listed
 * here but missing on screen, or the reverse. The state is a
 * device-scope UI pref (uiPrefs): the facet screens, menus, the
 * agent brief, and the facet-gated tools all read it.
 *
 * The two levels mean different things, and the section says so
 * in plain words on its face: facet-off is the level that changes
 * what the agent is briefed and offered; section-off only hides
 * that section on the facet's screen. Nothing here touches the
 * project's data — a facet or section turned back on is exactly
 * as it was.
 */
export function FacetsSettingsSection() {
  const [prefs, setPrefs] = useState<UiPrefs>(() => loadUiPrefs())
  const [open, setOpen] = useState<string | null>(null)

  const apply = (patch: Partial<UiPrefs>) => setPrefs(saveUiPrefs(patch))

  return (
    <div>
      <div className="field-hint" style={{ marginBottom: 10 }}>
        Turn a facet off and it leaves the facet bar, the menus, and the agent's brief, and its
        tools are no longer offered. Its data stays exactly as it is — turn it back on and it is
        all there again. Turning a section off only hides that section on the facet's screen;
        the agent still sees it. Overview is the project home and stays on.
      </div>
      {FACETS.map(f => {
        const on = facetEnabled(prefs, f.id)
        const expanded = open === f.id
        return (
          <div key={f.id}>
            <div className="set-row">
              <div className="set-row-text">
                <label className="set-row-label" htmlFor={`set-facet-${f.id}`}>{f.title}</label>
                <div className="field-hint">{f.blurb}</div>
              </div>
              <div className="set-row-control" style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                <button
                  type="button" className="wiz-btn"
                  onClick={() => setOpen(expanded ? null : f.id)}
                  aria-expanded={expanded}
                >
                  {expanded ? 'Hide sections' : 'Sections'}
                </button>
                <input
                  id={`set-facet-${f.id}`} type="checkbox"
                  checked={on}
                  disabled={!!f.home}
                  title={f.home ? 'Overview is the project home and stays on' : undefined}
                  onChange={e => apply(facetTogglePatch(prefs, f.id, e.target.checked))}
                />
              </div>
            </div>
            {expanded && f.sections.map(sec => (
              <div className="set-row" key={sec.id} style={{ paddingLeft: 22 }}>
                <div className="set-row-text">
                  <label className="set-row-label" htmlFor={`set-facet-${f.id}-${sec.id}`}>{sec.title}</label>
                  <div className="field-hint">
                    {on ? `Shown on the ${f.title} screen` : `${f.title} is off, so this has no effect until you turn it back on`}
                  </div>
                </div>
                <div className="set-row-control">
                  <input
                    id={`set-facet-${f.id}-${sec.id}`} type="checkbox"
                    checked={sectionEnabled(prefs, f.id, sec.id)}
                    onChange={e => apply(sectionTogglePatch(prefs, f.id, sec.id, e.target.checked))}
                  />
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
