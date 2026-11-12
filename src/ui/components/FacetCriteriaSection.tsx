import { useState } from 'react'
import { getFacetCriteria, type FacetCriteriaRunItem } from '../lib/api'

/**
 * The per-facet criteria runner (Facets design §8.3): one
 * button per facet runs its criteria set against the facet's
 * own reports and shows pass / fail / couldn't-check with
 * evidence. Shared by every facet screen (extracted from
 * FacetView when the Delivery facet needed it too).
 */
export type CriteriaFacet = 'architecture' | 'graphic-design' | 'configuration' | 'tech-stack' | 'delivery'

export function FacetCriteriaSection({ facet }: { facet: CriteriaFacet }) {
  const [run, setRun] = useState<FacetCriteriaRunItem | null>(null)
  const [note, setNote] = useState('')
  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button" className="wiz-btn"
        onClick={() => { void getFacetCriteria(facet).then(r => setRun(r.run)).catch(e => setNote(e instanceof Error ? e.message : 'Could not run the criteria')) }}
      >
        Run this facet's criteria
      </button>
      {note && <span className="field-hint" style={{ marginLeft: 7 }}>{note}</span>}
      {run && run.results.map(r => (
        <div className="fs-row" key={r.id}><span>{`${r.verdict} — ${r.id}`}</span><b>{`${r.say} · ${r.evidence}`}</b></div>
      ))}
    </div>
  )
}
