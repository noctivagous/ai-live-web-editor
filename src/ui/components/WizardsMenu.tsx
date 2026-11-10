import React from 'react'
import { STUB_REASON, WIZARD_FACETS, wizardsForFacet } from '../lib/wizards'
import { facetEnabled } from '../lib/facetPrefs'
import { loadUiPrefs } from '../lib/uiPrefs'

/**
 * The Wizards menu (slice 3): two-column pressable cards like the
 * Agent Actions menu, but grouped by facet — wizards live under
 * facets, because each one walks a single aspect of the project.
 * Stub wizards are shown greyed with their reason, so the product's
 * shape is visible before their machinery exists.
 */
export function WizardsMenu({ onOpenWizard, onClose }: {
  onOpenWizard: (id: string) => void
  onClose: () => void
}) {
  return (
    <div className="aa-menu" role="menu" aria-label="Wizards">
      {WIZARD_FACETS.filter(f => facetEnabled(loadUiPrefs(), f.id)).map(f => (
        <React.Fragment key={f.id}>
          <div className="aa-group">{f.title} wizards</div>
          <div className="aa-grid">
            {wizardsForFacet(f.id).map(w => {
              const stub = w.status === 'stub'
              return (
                <button
                  key={w.id}
                  type="button"
                  role="menuitem"
                  className="aa-card"
                  disabled={stub}
                  title={stub ? `${w.title} — ${STUB_REASON}` : w.title}
                  onClick={() => { onOpenWizard(w.id); onClose() }}
                >
                  <b>{w.title}</b>
                  <span>{w.blurb}</span>
                  {stub && <span className="aa-reason">{STUB_REASON}</span>}
                </button>
              )
            })}
          </div>
        </React.Fragment>
      ))}
      <div className="aa-foot">A wizard walks one change from questions to done. Add a Feature is ready; the rest are placed as stubs.</div>
    </div>
  )
}
