import { useEffect, useState } from 'react'
import {
  askAi, getCatalog, installCatalogComponent, placeTemplate,
  type CatalogSummaryItem, type TemplateItem,
} from '../lib/api'

/**
 * Library panel (§3): the component catalog and the layout
 * templates, in the left panel beside Files. Every row carries the
 * two actions the tiering is built around:
 * - Insert: copy-own the file into the project (it lands in the
 *   project registry/map, so later turns import it by name).
 * - Ask AI: seed a chat turn naming the component/template.
 * Rows show the tier-1 summary (name, one-liner, prop names) — the
 * same compact shape the agent's find-component search returns.
 */
export function Library({ onOpenPath, onNotice }: {
  onOpenPath: (path: string) => void
  onNotice: (text: string) => void
}) {
  const [q, setQ] = useState('')
  const [components, setComponents] = useState<CatalogSummaryItem[]>([])
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    getCatalog(q).then(d => {
      if (!live) return
      if (d.ok) { setComponents(d.components || []); setTemplates(d.templates || []); setError('') }
      else setError(d.error || 'Catalog failed to load')
    }).catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [q])

  async function insertComponent(item: CatalogSummaryItem) {
    setBusy(item.tag)
    const r = await installCatalogComponent(item.tag)
    setBusy('')
    if (r.ok && r.dest) {
      onNotice(`${item.tag} copied into the project at ${r.dest} — it is in the project registry now, so the agent will import it by name.`)
      onOpenPath(r.dest)
    } else {
      onNotice(r.error || `Could not insert ${item.tag}`)
    }
  }

  async function insertTemplate(item: TemplateItem) {
    setBusy(item.id)
    const r = await placeTemplate(item.id)
    setBusy('')
    if (r.ok && r.dest) {
      onNotice(`${item.name} placed at ${r.dest} — customise the constants at the top of the file.`)
      onOpenPath(r.dest)
    } else {
      onNotice(r.error || `Could not place ${item.name}`)
    }
  }

  const rowStyle: React.CSSProperties = { padding: '9px 10px', borderBottom: '1px solid #232329', display: 'flex', flexDirection: 'column', gap: 4 }
  const nameStyle: React.CSSProperties = { fontWeight: 600, fontSize: 13, display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }
  const chipStyle: React.CSSProperties = { fontSize: 10.5, fontWeight: 500, opacity: 0.6, border: '1px solid #3a3a42', borderRadius: 8, padding: '0 6px' }
  const descStyle: React.CSSProperties = { fontSize: 12, opacity: 0.75, lineHeight: 1.45 }
  const propsStyle: React.CSSProperties = { fontSize: 11, opacity: 0.55, fontFamily: 'monospace' }
  const btnRow: React.CSSProperties = { display: 'flex', gap: 6, marginTop: 2 }

  return (
    <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #232329' }}>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search the catalog…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 12.5 }}
        />
        {error && <div style={{ color: '#e5534b', fontSize: 12, marginTop: 6 }}>{error}</div>}
      </div>

      <div className="panel-head">Components <span className="sub">{components.length}</span></div>
      {components.map(item => (
        <div key={item.tag} style={rowStyle}>
          <div style={nameStyle}>
            <span className="mono">{item.tag}</span>
            <span style={chipStyle}>{item.category}</span>
            <span style={chipStyle}>{item.stock === 'shadcn' ? 'shadcn · React' : 'AppKit · Lit'}</span>
          </div>
          <div style={descStyle}>{item.description}</div>
          {item.props.length > 0 && <div style={propsStyle}>{item.props.join(' · ')}</div>}
          <div style={btnRow}>
            <button type="button" className="deck-btn" disabled={busy === item.tag} onClick={() => void insertComponent(item)}>
              {busy === item.tag ? 'Inserting…' : 'Insert'}
            </button>
            <button
              type="button" className="deck-btn"
              onClick={() => askAi(`Use the catalog component ${item.tag} (${item.description}) in this project. If it is not installed yet, install it with install-catalog-component first, then import it by name where it fits instead of hand-rolling an equivalent.`)}
            >
              Ask AI to use it
            </button>
          </div>
        </div>
      ))}
      {!components.length && !error && <div style={{ padding: '10px', fontSize: 12, opacity: 0.6 }}>No components match.</div>}

      <div className="panel-head">Templates <span className="sub">{templates.length}</span></div>
      {templates.map(item => (
        <div key={item.id} style={rowStyle}>
          <div style={nameStyle}>
            <span>{item.name}</span>
            <span style={chipStyle}>{item.kind}</span>
            <span style={{ ...chipStyle, fontFamily: 'monospace' }}>{item.id}</span>
          </div>
          <div style={descStyle}>{item.description}</div>
          <div style={propsStyle}>lands at {item.target}</div>
          <div style={btnRow}>
            <button type="button" className="deck-btn" disabled={busy === item.id} onClick={() => void insertTemplate(item)}>
              {busy === item.id ? 'Placing…' : 'Insert'}
            </button>
            <button
              type="button" className="deck-btn"
              onClick={() => askAi(`Use the layout template ${item.id} (${item.name}, ${item.kind}) in this project. Place it with place-template, customise the constants at the top of the placed file with str-replace for this project's content, and import it where it belongs.`)}
            >
              Ask AI to use it
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
