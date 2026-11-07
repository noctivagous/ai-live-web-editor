import React, { useEffect, useMemo, useState } from 'react'
import { readFile, writeFile } from '../lib/api'
import { controlFor, parseStylesheet, replaceDeclValue, type CssDecl } from '../lib/cssBoxes'

/**
 * CSS boxes (Open slice D): the marked stylesheet shown as editable
 * controls over its declarations. The file is canonical — a commit
 * splices the new value into the declaration's exact place in the
 * text (lib/cssBoxes) and writes the whole file back; formatting,
 * comments and @-blocks are preserved because they were never
 * regenerated. Controls by value shape: a color picker for colors, a
 * slider for single lengths, a menu for known keyword properties, a
 * text field for everything else (which still edits in place).
 */
export function CssBoxes({ path, onSaved }: {
  path: string
  /** Called after a successful write so the parent can refresh. */
  onSaved: () => void
}) {
  const [source, setSource] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<number, string>>({})

  useEffect(() => {
    let live = true
    setSource(null)
    setFailed(false)
    readFile(path)
      .then((data) => { if (live) setSource(typeof data?.content === 'string' ? data.content : '') })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [path])

  const parsed = useMemo(() => (source === null ? null : parseStylesheet(source)), [source])

  async function commit(decl: CssDecl, newValue: string) {
    if (source === null || newValue === decl.value) return
    const next = replaceDeclValue(source, decl, newValue)
    setSource(next)
    setError(null)
    try {
      await writeFile(path, next)
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const wrap: React.CSSProperties = { flex: 1, overflow: 'auto', background: 'var(--panel)', padding: '16px 20px', minHeight: 0 }
  if (failed) return <div style={wrap}><div style={{ color: 'var(--muted)', fontSize: 'calc(12.5px * var(--ui-scale, 1))' }}>Could not read {path}.</div></div>
  if (source === null || parsed === null) return <div style={wrap}><div style={{ color: 'var(--muted)', fontSize: 'calc(12.5px * var(--ui-scale, 1))' }}>Loading {path}…</div></div>
  if (parsed.rules.length === 0) {
    return (
      <div style={wrap}>
        <div style={{ maxWidth: 460, color: 'var(--muted)', fontSize: 'calc(12.5px * var(--ui-scale, 1))', lineHeight: 1.6 }}>
          This stylesheet has no rules the box view can show{parsed.atBlocks > 0 ? ' outside its @-blocks' : ''}.
          The file is unchanged — edit it as text in the editor.
        </div>
      </div>
    )
  }

  const propStyle: React.CSSProperties = { fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--muted)', width: 130, flexShrink: 0, paddingTop: 3 }
  const inputStyle: React.CSSProperties = { background: 'var(--well)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '3px 6px', fontSize: 'calc(12px * var(--ui-scale, 1))' }

  return (
    <div style={wrap}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        <div style={{ fontSize: 'calc(12.5px * var(--ui-scale, 1))', color: 'var(--text)', lineHeight: 1.6, marginBottom: 4 }}>
          Editing a box rewrites that value in <span className="mono">{path}</span>. Everything else in the file stays as it is.
        </div>
        {parsed.atBlocks > 0 && (
          <div style={{ fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--muted)', lineHeight: 1.55, marginBottom: 4 }}>
            Rules inside @-blocks (like @media) aren&rsquo;t shown as boxes — they&rsquo;re left as they are in the file.
          </div>
        )}
        {error && <div style={{ fontSize: 'calc(12px * var(--ui-scale, 1))', color: 'var(--red-text)', margin: '6px 0' }}>{error}</div>}
        {parsed.rules.map((rule, ri) => (
          <div key={ri} style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', background: 'var(--card)' }}>
            <div className="mono" style={{ fontSize: 'calc(12.5px * var(--ui-scale, 1))', color: 'var(--text)', marginBottom: 8 }}>{rule.selector}</div>
            {rule.declarations.length === 0 && <div style={{ fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--faint)' }}>No declarations the box view can edit.</div>}
            {rule.declarations.map((decl) => {
              const control = controlFor(decl)
              const key = decl.valueStart
              return (
                <div key={key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '4px 0' }}>
                  <div className="mono" style={propStyle}>{decl.property}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
                    {control.kind === 'color' && (
                      <>
                        <input
                          type="color"
                          value={control.hex}
                          aria-label={`${decl.property} color`}
                          onChange={(e) => void commit(decl, e.target.value)}
                          style={{ width: 34, height: 24, padding: 0, border: '1px solid var(--border-strong)', borderRadius: 6, background: 'none', cursor: 'pointer' }}
                        />
                        <span className="mono" style={{ fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--muted)' }}>{decl.value}</span>
                      </>
                    )}
                    {control.kind === 'length' && (
                      <>
                        <input
                          type="range"
                          min={control.min}
                          max={control.max}
                          step={control.step}
                          value={drafts[key] !== undefined ? parseFloat(drafts[key]) || 0 : control.amount}
                          aria-label={`${decl.property} slider`}
                          onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                          onPointerUp={(e) => { const v = (e.target as HTMLInputElement).value; void commit(decl, `${parseFloat(v)}${control.unit}`) }}
                          onKeyUp={(e) => { const v = (e.target as HTMLInputElement).value; void commit(decl, `${parseFloat(v)}${control.unit}`) }}
                          style={{ width: 130 }}
                        />
                        <input
                          type="number"
                          style={{ ...inputStyle, width: 64 }}
                          value={drafts[key] ?? String(control.amount)}
                          aria-label={`${decl.property} amount`}
                          onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                          onBlur={(e) => { const n = parseFloat(e.target.value); if (!Number.isNaN(n)) void commit(decl, `${n}${control.unit}`) }}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        />
                        <span style={{ fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--muted)' }}>{control.unit}</span>
                      </>
                    )}
                    {control.kind === 'keyword' && (
                      <select
                        value={decl.value}
                        aria-label={`${decl.property} value`}
                        onChange={(e) => void commit(decl, e.target.value)}
                        style={inputStyle}
                      >
                        {control.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    )}
                    {control.kind === 'text' && (
                      <input
                        type="text"
                        defaultValue={decl.value}
                        key={decl.value}
                        aria-label={`${decl.property} value`}
                        spellCheck={false}
                        className="mono"
                        style={{ ...inputStyle, minWidth: 180, flex: 1 }}
                        onBlur={(e) => void commit(decl, e.target.value.trim())}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
