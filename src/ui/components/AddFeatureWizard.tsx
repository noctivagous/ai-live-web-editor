import { useEffect, useState } from 'react'
import { askAi, getCatalog, getFeatures, type PackSummaryItem } from '../lib/api'
import { quickAddPrompt } from '../lib/wizards'

/**
 * Add a Feature (slice 3) — the first ready wizard, at both depths
 * the product promises:
 *
 * - Quick add: pick a pack, read its stated defaults, press Add.
 *   One turn is sent with the defaults accepted up front and a
 *   no-questions contract, so something small lands immediately,
 *   with no chat conversation.
 * - Plan it first: the planner opens with the install as its goal —
 *   Questions → Plan → Execute → Review at full depth. (Planning
 *   FROM the graph needs the pack already grafted; for a fresh pack
 *   the planner is the full-depth path, and its questions come
 *   first.)
 *
 * Data is the Library's: the catalog's pack summaries, and the
 * project graph's nodes to tell what is already installed.
 */
export function AddFeatureWizard({ onClose, onNotice }: {
  onClose: () => void
  onNotice: (text: string) => void
}) {
  const [packs, setPacks] = useState<PackSummaryItem[] | null>(null)
  const [installed, setInstalled] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<PackSummaryItem | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const [cat, feats] = await Promise.all([getCatalog(), getFeatures()])
        if (!live) return
        if (!cat.ok) { setError(cat.error || 'Could not load the feature pack catalog'); return }
        setPacks(cat.packs)
        const ids = new Set<string>()
        for (const n of feats.graph?.nodes ?? []) if (n.pack) ids.add(n.pack)
        setInstalled(ids)
      } catch {
        if (live) setError('Could not load the feature pack catalog')
      }
    })()
    return () => { live = false }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function quickAdd(pack: PackSummaryItem) {
    askAi(quickAddPrompt(pack))
    onNotice(`Quick add started — ${pack.name} is being installed with its stated defaults. Watch the chat for its report.`)
    onClose()
  }

  function planFirst(pack: PackSummaryItem) {
    const goal = `Install the ${pack.name} feature pack (pack id ${pack.id}) into this app, with its settings at their defaults unless my answers say otherwise`
    window.dispatchEvent(new CustomEvent('ai-live:plan-open', { detail: { goal } }))
    onClose()
  }

  return (
    <div className="wiz-scrim" onPointerDown={onClose}>
      <div className="wiz" role="dialog" aria-label="Add a Feature" onPointerDown={e => e.stopPropagation()}>
        {!selected ? (
          <>
            <div className="wiz-head">
              <b>Add a Feature</b>
              <span>Pick a feature pack. Small ones can be added on the spot; larger ones can be planned first.</span>
            </div>
            {error && <div className="wiz-error">{error}</div>}
            {!packs && !error && <div className="ap-empty">Loading feature packs…</div>}
            <div className="wiz-packs">
              {(packs ?? []).map(p => {
                const isIn = installed.has(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="wiz-pack"
                    disabled={isIn}
                    title={isIn ? `${p.name} is already installed` : `Add ${p.name}`}
                    onClick={() => setSelected(p)}
                  >
                    <b>{p.name}{isIn && <span className="wiz-badge">Installed</span>}</b>
                    <span>{p.description}</span>
                    <span className="wiz-meta">{p.nodes} nodes · {p.settings} settings{p.configures.length > 0 ? ` · configures ${p.configures.join(', ')}` : ''}</span>
                  </button>
                )
              })}
            </div>
            {packs && packs.length === 0 && !error && <div className="ap-empty">No feature packs in the catalog.</div>}
            <div className="wiz-actions">
              <button type="button" className="wiz-btn" onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div className="wiz-head">
              <b>Add {selected.name}</b>
              <span>{selected.description}</span>
            </div>
            <div className="wiz-defaults">
              <div className="aa-group" style={{ margin: '0 0 5px' }}>Stated defaults</div>
              <span>
                {selected.settings > 0
                  ? `Its ${selected.settings} settings start at the pack\u2019s defaults; you can change them afterwards in the feature graph. `
                  : 'It has no settings to configure. '}
                {selected.configures.length > 0
                  ? `It will try to configure: ${selected.configures.join(', ')} — anything it cannot wire is reported, not silently dropped.`
                  : 'It stands alone: nothing else in the app needs wiring for it.'}
              </span>
            </div>
            <div className="wiz-actions" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <button type="button" className="wiz-btn primary" onClick={() => quickAdd(selected)}>
                Quick add — install with these defaults
              </button>
              <button type="button" className="wiz-btn" onClick={() => planFirst(selected)}>
                Plan it first — questions, then a plan
              </button>
              <button type="button" className="wiz-btn" onClick={() => setSelected(null)}>Back to the pack list</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
