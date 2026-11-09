import React, { useEffect, useMemo, useState } from 'react'
import { bundleJsx, readFile, writeFile } from '../lib/api'
import { lineColAt } from '../lib/jsonDoc'
import { parseJsxDocument, renameComponentInText, setPropDefaultInText, type JsDocKind, type JsxDoc } from '../lib/jsxDoc'

/**
 * The base viewer for js-based component files — the Component tab
 * renders the file's component live in an isolated iframe (bundled
 * server-side with its relative imports), and the Code tab reads the
 * file as a nested document: imports, components with editable prop
 * defaults, hooks, helpers. An edit rewrites that value in the file.
 *
 * `kind` selects the language (`jsx` today; `tsx` and plain `js`
 * parse through the same model). A future WebComponent viewer
 * inherits this shell with its own doc provider.
 */

const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0' }
const inputStyle: React.CSSProperties = { background: 'var(--well)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '2px 6px', fontSize: 'calc(12px * var(--ui-scale, 1))', fontFamily: 'var(--mono)', minWidth: 0 }

function frameHtml(code: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:12px;font-family:system-ui,sans-serif;background:white;color:#111}</style></head><body><div id="root"></div><script>${code.replace(/<\/script>/g, '<\\/script>')}<\/script></body></html>`
}

export function JsBasedComponentView({ path, kind, onSaved }: { path: string, kind: JsDocKind, onSaved: () => void }) {
  const [tab, setTab] = useState<'component' | 'code'>('component')
  const [bundle, setBundle] = useState<{ state: 'loading' | 'ok' | 'error', code?: string, error?: string }>({ state: 'loading' })
  const [content, setContent] = useState<string | null>(null)
  const [doc, setDoc] = useState<JsxDoc | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [defaultEdits, setDefaultEdits] = useState<Record<string, string>>({})

  useEffect(() => {
    let live = true
    setBundle({ state: 'loading' })
    void (async () => {
      try {
        const r = await bundleJsx(path)
        if (!live) return
        setBundle(r.ok && r.code ? { state: 'ok', code: r.code } : { state: 'error', error: r.error ?? 'Bundle failed' })
      } catch (e) {
        if (live) setBundle({ state: 'error', error: e instanceof Error ? e.message : String(e) })
      }
    })()
    return () => { live = false }
  }, [path])

  useEffect(() => {
    let live = true
    setContent(null)
    setDoc(null)
    setParseError(null)
    void (async () => {
      try {
        const data = await readFile(path)
        if (!live || typeof data?.content !== 'string') return
        setContent(data.content)
        try {
          setDoc(await parseJsxDocument(data.content, kind))
        } catch (e) {
          setParseError(e instanceof Error ? e.message : String(e))
        }
      } catch { /* read errors surface as empty */ }
    })()
    return () => { live = false }
  }, [path])

  const srcDoc = useMemo(() => (bundle.state === 'ok' && bundle.code ? frameHtml(bundle.code) : null), [bundle])

  const applyEdit = async (next: string, what: string) => {
    const r = await writeFile(path, next)
    if (r?.error) {
      setNotice(`Save failed: ${r.error}`)
      return
    }
    setContent(next)
    try {
      setDoc(await parseJsxDocument(next, kind))
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e))
    }
    // Re-bundle so the Component tab shows the edit.
    try {
      const b = await bundleJsx(path)
      setBundle(b.ok && b.code ? { state: 'ok', code: b.code } : { state: 'error', error: b.error ?? 'Bundle failed' })
    } catch { /* bundle errors show on the Component tab */ }
    setNotice(`Saved ${what}`)
    onSaved()
  }

  const commitRename = async (oldName: string) => {
    const next = renameValue.trim()
    if (!next || next === oldName || content === null) return
    setRenaming(null)
    await applyEdit(await renameComponentInText(content, oldName, next), `rename ${oldName} → ${next}`)
  }

  const commitDefault = async (componentName: string, propName: string) => {
    const expr = (defaultEdits[`${componentName}.${propName}`] ?? '').trim()
    if (!expr || content === null) return
    try {
      await applyEdit(await setPropDefaultInText(content, componentName, propName, expr, kind), `default of ${propName}`)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--panel)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--border-soft)' }}>
        <div className="segf ctl-sm" role="group" aria-label="Component file view">
          <button type="button" className={tab === 'component' ? 'on' : ''} onClick={() => setTab('component')} aria-pressed={tab === 'component'}>Component</button>
          <button type="button" className={tab === 'code' ? 'on' : ''} onClick={() => setTab('code')} aria-pressed={tab === 'code'}>Code</button>
        </div>
        <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 'calc(11.5px * var(--ui-scale, 1))' }}>{path}</span>
        {notice && <span style={{ marginLeft: 'auto', fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--muted)' }}>{notice}</span>}
      </div>
      {tab === 'component' ? (
        bundle.state === 'loading' ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>Bundling {path}…</div>
        ) : bundle.state === 'error' ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div style={{ maxWidth: 480, color: 'var(--text)', fontSize: 'calc(13px * var(--ui-scale, 1))' }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Couldn't render this component in isolation</div>
              <div className="mono" style={{ color: 'var(--muted)', whiteSpace: 'pre-wrap', marginBottom: 12 }}>{bundle.error}</div>
              <button type="button" className="deck-btn" onClick={() => setTab('code')}>Inspect the nested code view instead</button>
            </div>
          </div>
        ) : (
          <iframe title={`component-${path}`} srcDoc={srcDoc ?? undefined} style={{ flex: 1, width: '100%', minHeight: 0, border: 'none', background: 'white' }} />
        )
      ) : content === null ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>Loading {path}…</div>
      ) : parseError || !doc ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ maxWidth: 480, color: 'var(--muted)', fontSize: 'calc(13px * var(--ui-scale, 1))' }}>
            Couldn't parse this file as a component ({parseError ?? 'unknown error'}). It still opens in the editor.
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px', color: 'var(--text)', fontSize: 'calc(13px * var(--ui-scale, 1))' }}>
          <div className="aa-group">Imports</div>
          {doc.imports.length === 0 && <div style={{ color: 'var(--muted)' }}>No imports.</div>}
          {doc.imports.map((imp, i) => (
            <div key={i} style={rowStyle}>
              <span className="mono" style={{ color: 'var(--accent-soft-text)' }}>{imp.source}</span>
              <span style={{ color: 'var(--muted)' }}>{imp.names.join(', ')}</span>
            </div>
          ))}
          <div className="aa-group">Components</div>
          {doc.components.length === 0 && <div style={{ color: 'var(--muted)' }}>No components found.</div>}
          {doc.components.map(comp => (
            <div key={comp.name} style={{ border: '1px solid var(--border-soft)', borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                {renaming === comp.name ? (
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input aria-label={`Rename ${comp.name}`} value={renameValue} onChange={e => setRenameValue(e.target.value)} style={inputStyle} />
                    <button type="button" className="deck-btn" style={{ padding: '2px 8px' }} onClick={() => void commitRename(comp.name)}>Apply</button>
                    <button type="button" className="deck-btn" style={{ padding: '2px 8px' }} onClick={() => setRenaming(null)}>Cancel</button>
                  </span>
                ) : (
                  <>
                    <b>{comp.name}</b>
                    <button type="button" className="deck-btn" style={{ padding: '0 6px', fontSize: 'calc(11px * var(--ui-scale, 1))' }} title={`Rename ${comp.name}`} onClick={() => { setRenaming(comp.name); setRenameValue(comp.name) }}>Rename</button>
                  </>
                )}
                {comp.exported && <span className="ms-tag">exported</span>}
                <span className="mono" style={{ marginLeft: 'auto', color: 'var(--faint)', fontSize: 'calc(11px * var(--ui-scale, 1))' }}>line {lineColAt(content, comp.range.start).line}</span>
              </div>
              <div style={{ marginTop: 6 }}>
                {comp.props.length === 0 && <div style={{ color: 'var(--muted)' }}>No props.</div>}
                {comp.props.map(prop => {
                  const key = `${comp.name}.${prop.name}`
                  return (
                    <div key={prop.name} style={rowStyle}>
                      <span className="mono">{prop.name}</span>
                      <input
                        aria-label={`Default for ${prop.name}`}
                        placeholder={prop.defaultSrc ?? 'no default'}
                        value={defaultEdits[key] ?? prop.defaultSrc ?? ''}
                        onChange={e => setDefaultEdits(prev => ({ ...prev, [key]: e.target.value }))}
                        style={{ ...inputStyle, width: 140 }}
                      />
                      <button type="button" className="deck-btn" style={{ padding: '2px 8px' }} onClick={() => void commitDefault(comp.name, prop.name)}>Set</button>
                    </div>
                  )
                })}
              </div>
              {comp.hooks.length > 0 && (
                <div style={{ marginTop: 6, color: 'var(--muted)' }}>
                  Hooks: {comp.hooks.map(h => h.bound.length > 0 ? `${h.name} (${h.bound.join(', ')})` : h.name).join(' · ')}
                </div>
              )}
              {comp.outline.length > 0 && (
                <div className="mono" style={{ marginTop: 6, color: 'var(--muted)', fontSize: 'calc(11.5px * var(--ui-scale, 1))' }}>
                  {comp.outline.join(' › ')}
                </div>
              )}
            </div>
          ))}
          {doc.helpers.length > 0 && (
            <>
              <div className="aa-group">Helpers</div>
              {doc.helpers.map(h => (
                <div key={h.name} style={rowStyle}>
                  <span className="mono">{h.name}</span>
                  {h.exported && <span className="ms-tag">exported</span>}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
