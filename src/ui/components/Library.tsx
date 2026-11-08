import { useEffect, useState } from 'react'
import { Plus, WandSparkles } from 'lucide-react'
import {
  askAi, getCatalog, installCatalogComponent, placeTemplate,
  type CatalogSummaryItem, type PackSummaryItem, type TemplateItem,
} from '../lib/api'

/**
 * Library panel (§3): the catalog in the left panel beside Files —
 * feature packs (tier 3) first, then components and layout
 * templates, top-down like the search. Pack rows carry one action
 * (Ask AI to install: grafting is a planned job, not a file copy);
 * component and template rows carry the two actions the tiering is
 * built around:
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
  const [packs, setPacks] = useState<PackSummaryItem[]>([])
  const [components, setComponents] = useState<CatalogSummaryItem[]>([])
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    getCatalog(q).then(d => {
      if (!live) return
      if (d.ok) { setPacks(d.packs || []); setComponents(d.components || []); setTemplates(d.templates || []); setError('') }
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

  const rowStyle: React.CSSProperties = { padding: '9px 10px', borderBottom: '1px solid var(--border-soft)', display: 'flex', flexDirection: 'column', gap: 4 }
  const nameStyle: React.CSSProperties = { fontWeight: 600, fontSize: 'calc(13px * var(--ui-scale, 1))', display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }
  const chipStyle: React.CSSProperties = { fontSize: 'calc(10.5px * var(--ui-scale, 1))', fontWeight: 500, opacity: 0.6, border: '1px solid var(--border-strong)', borderRadius: 8, padding: '0 6px' }
  const descStyle: React.CSSProperties = { fontSize: 'calc(12px * var(--ui-scale, 1))', opacity: 0.75, lineHeight: 1.45 }
  const propsStyle: React.CSSProperties = { fontSize: 'calc(11px * var(--ui-scale, 1))', opacity: 0.55, fontFamily: 'monospace' }
  const btnRow: React.CSSProperties = { display: 'flex', gap: 6, marginTop: 2 }

  return (
    <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-soft)' }}>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search the catalog…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 'calc(12.5px * var(--ui-scale, 1))' }}
        />
        {error && <div style={{ color: 'var(--red-text)', fontSize: 'calc(12px * var(--ui-scale, 1))', marginTop: 6 }}>{error}</div>}
      </div>

      <div className="panel-head">Feature packs <span className="sub">{packs.length}</span></div>
      {packs.map(item => (
        <div key={item.id} style={rowStyle}>
          <div style={nameStyle}>
            <span>{item.name}</span>
            <span style={chipStyle}>pack</span>
            <span style={{ ...chipStyle, fontFamily: 'monospace' }}>{item.id}</span>
          </div>
          <div style={descStyle}>{item.description}</div>
          <div style={propsStyle}>{item.nodes} nodes · {item.settings} settings{item.configures.length ? ` · configures ${item.configures.join(', ')}` : ''}</div>
          <div style={btnRow}>
            <button
              type="button" className="deck-btn"
              onClick={() => askAi(`Install the ${item.name} feature pack (pack id ${item.id}) into this app. Plan it as an install: look the pack up in full with find-component (pack: "${item.id}"), graft it into the project's feature graph with feature-install-pack, and report which of its configures links were wired and which were left unwired. Then build what is missing in the graft's build order, updating node statuses with feature-set-status as work lands.`)}
            >
              <WandSparkles size={13} />Ask AI to install it
            </button>
          </div>
        </div>
      ))}
      {!packs.length && !error && <div style={{ padding: '10px', fontSize: 'calc(12px * var(--ui-scale, 1))', opacity: 0.6 }}>No feature packs match.</div>}

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
              <Plus size={13} />{busy === item.tag ? 'Inserting…' : 'Insert'}
            </button>
            <button
              type="button" className="deck-btn"
              onClick={() => askAi(`Use the catalog component ${item.tag} (${item.description}) in this project. If it is not installed yet, install it with install-catalog-component first, then import it by name where it fits instead of hand-rolling an equivalent.`)}
            >
              <WandSparkles size={13} />Ask AI to use it
            </button>
          </div>
        </div>
      ))}
      {!components.length && !error && <div style={{ padding: '10px', fontSize: 'calc(12px * var(--ui-scale, 1))', opacity: 0.6 }}>No components match.</div>}

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
              <Plus size={13} />{busy === item.id ? 'Placing…' : 'Insert'}
            </button>
            <button
              type="button" className="deck-btn"
              onClick={() => askAi(`Use the layout template ${item.id} (${item.name}, ${item.kind}) in this project. Place it with place-template, customise the constants at the top of the placed file with str-replace for this project's content, and import it where it belongs.`)}
            >
              <WandSparkles size={13} />Ask AI to use it
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
