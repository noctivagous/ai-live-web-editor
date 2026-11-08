import React, { useEffect, useMemo, useState } from 'react'
import { readFile, writeFile } from '../lib/api'
import type { PreviewRenderer } from '../lib/previewRender'
import type { DocBlock, TextAdapter, TextAlign } from '../lib/textDoc'
import { FormatActionMenus } from './FormatToolbar'
import { Markdown } from './Markdown'

/**
 * The base text editor: ONE editing surface for every text format,
 * customised by an adapter (lib/textDoc) instead of rewritten per
 * format — markdown today, RTF beside it, .docx when its adapter
 * lands. The file's format decides what the adapter can parse, how
 * an edit writes back, and which toolbar functions it can honestly
 * represent.
 *
 * Two portions, as an editor should have:
 *  1. The NORMAL toolbar — font size, font weight, text alignment
 *     and heading level for the block you're editing. A function
 *     the format can't represent is greyed WITH its reason (the
 *     adapter states it), never silently dead.
 *  2. The AI ACTIONS — the format's menus of prepared AI actions
 *     (the shared FormatActionMenus), under the normal toolbar.
 *     The preview bar's "AI toolbar" checkbox hides this portion.
 *
 * A Preview mode shows the document as readers see it.
 */

const FONT_SIZES = [9, 10, 11, 12, 13, 14, 16, 18, 19, 20, 24, 28, 32]
const inputStyle: React.CSSProperties = { background: 'var(--well)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '3px 6px', fontSize: 'calc(12px * var(--ui-scale, 1))' }
const areaStyle: React.CSSProperties = { ...inputStyle, width: '100%', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.55 }
const noteStyle: React.CSSProperties = { fontSize: 'calc(11px * var(--ui-scale, 1))', color: 'var(--faint)', marginTop: 3 }
const smallBtn = { padding: '2px 8px', fontSize: 'calc(11px * var(--ui-scale, 1))' } as const
const portionLabel: React.CSSProperties = { fontSize: 'calc(10.5px * var(--ui-scale, 1))', fontWeight: 700, letterSpacing: '.06em', color: 'var(--faint)', width: 74, flexShrink: 0 }

function CommitInput({ value, onCommit, style, ariaLabel, mono, onFocus }: {
  value: string
  onCommit: (next: string) => void
  style?: React.CSSProperties
  ariaLabel: string
  mono?: boolean
  onFocus?: () => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      type="text"
      className={mono ? 'mono' : undefined}
      value={draft ?? value}
      aria-label={ariaLabel}
      onFocus={onFocus}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== null) { onCommit(draft); setDraft(null) } }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      style={style}
    />
  )
}

function CommitArea({ value, onCommit, rows, ariaLabel, mono, style, onFocus }: {
  value: string
  onCommit: (next: string) => void
  rows: number
  ariaLabel: string
  mono?: boolean
  style?: React.CSSProperties
  onFocus?: () => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <textarea
      className={mono ? 'mono' : undefined}
      value={draft ?? value}
      rows={rows}
      aria-label={ariaLabel}
      onFocus={onFocus}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== null) { onCommit(draft); setDraft(null) } }}
      style={{ ...(mono ? { ...areaStyle, fontFamily: 'ui-monospace, monospace' } : areaStyle), ...style }}
    />
  )
}

export function BaseTextEditor({ path, adapter, aiRenderer, showAi, onSaved, onDispatched }: {
  path: string
  adapter: TextAdapter
  /** The format's AI-action menus (usually the renderer's own id). */
  aiRenderer: PreviewRenderer
  /** The preview bar's "AI toolbar" choice: portion 2 shows or not. */
  showAi: boolean
  onSaved: () => void
  onDispatched?: (title: string) => void
}) {
  const [source, setSource] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'blocks' | 'preview'>('blocks')
  const [active, setActive] = useState(0)

  useEffect(() => {
    let live = true
    setSource(null)
    setFailed(false)
    setError(null)
    setActive(0)
    readFile(path)
      .then((data) => { if (live) setSource(typeof data?.content === 'string' ? data.content : '') })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [path])

  const blocks = useMemo(() => (source === null ? [] : adapter.parse(source)), [source, adapter])
  const activeBlock: DocBlock | undefined = blocks[Math.min(active, Math.max(0, blocks.length - 1))]
  const support = activeBlock ? adapter.support(activeBlock) : null

  async function apply(next: string) {
    if (source === null || next === source) return
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
  if (source === null) return <div style={wrap}><div style={{ color: 'var(--muted)', fontSize: 'calc(12.5px * var(--ui-scale, 1))' }}>Loading {path}…</div></div>

  const greyed = (s: boolean | string | undefined) => s !== true
  const reason = (s: boolean | string | undefined) => (typeof s === 'string' ? s : undefined)
  const reasons = support ? [reason(support.fontSize), reason(support.fontWeight), reason(support.align)].filter(Boolean) : []

  function blockView(block: DocBlock, idx: number) {
    const focus = () => setActive(idx)
    const del = (
      <button type="button" className="deck-btn" style={{ ...smallBtn, color: 'var(--muted)' }} title="Delete this block" onClick={() => void apply(adapter.deleteBlock(source!, block))}>Delete</button>
    )
    const textCss: React.CSSProperties = {
      fontSize: block.style.fontSizePt ? `calc(${block.style.fontSizePt}px * var(--ui-scale, 1))` : undefined,
      fontWeight: block.style.bold ? 700 : undefined,
      textAlign: block.style.align,
    }
    switch (block.kind) {
      case 'frontmatter':
        return (
          <div key={idx} style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: '8px 12px', marginBottom: 12 }}>
            <pre className="mono" style={{ margin: 0, fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>{block.raw}</pre>
            <div style={noteStyle}>Frontmatter — shown as it is; edit it as text in the editor.</div>
          </div>
        )
      case 'heading':
        return (
          <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0 6px' }} onFocus={focus}>
            {adapter.setLevel && (
              <select value={block.level ?? 1} aria-label="Heading level" onChange={(e) => void apply(adapter.setLevel!(source!, block, Number(e.target.value)))} style={{ ...inputStyle, padding: '2px 4px' }}>
                {[1, 2, 3, 4, 5, 6].map((l) => <option key={l} value={l}>H{l}</option>)}
              </select>
            )}
            <CommitInput value={block.text} ariaLabel="Heading text" onFocus={focus} onCommit={(t) => { if (t.trim()) void apply(adapter.setText(source!, block, t)) }} style={{ ...inputStyle, flex: 1, fontWeight: 700, ...textCss }} />
            {del}
          </div>
        )
      case 'paragraph':
        return (
          <div key={idx} style={{ margin: '6px 0' }}>
            <CommitArea value={block.text} rows={Math.min(8, Math.max(1, Math.ceil(block.text.length / 90) + block.text.split('\n').length - 1))} ariaLabel="Paragraph text" onFocus={focus} style={textCss} onCommit={(t) => void apply(adapter.setText(source!, block, t))} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 3 }}>{del}</div>
          </div>
        )
      case 'list':
        return (
          <div key={idx} style={{ margin: '6px 0', borderLeft: '2px solid var(--border-soft)', paddingLeft: 12 }} onFocus={focus}>
            {(block.items ?? []).map((item, ii) => (
              <div key={ii} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
                <span style={{ fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--faint)', width: 18, textAlign: 'right', flexShrink: 0 }}>{block.ordered ? `${ii + 1}.` : '•'}</span>
                {item.checked !== null && adapter.toggleTask && (
                  <input type="checkbox" checked={item.checked} aria-label="Task done" onChange={() => void apply(adapter.toggleTask!(source!, block, ii))} />
                )}
                <CommitInput value={item.text} ariaLabel="List item text" onFocus={focus} onCommit={(t) => { if (adapter.setItemText) void apply(adapter.setItemText(source!, block, ii, t)) }} style={{ ...inputStyle, flex: 1 }} />
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 3 }}>{del}</div>
          </div>
        )
      case 'quote':
        return (
          <div key={idx} style={{ margin: '6px 0', borderLeft: '3px solid var(--border-strong)', paddingLeft: 12 }}>
            <CommitArea value={block.text} rows={Math.min(6, block.text.split('\n').length + 1)} ariaLabel="Quote text" onFocus={focus} style={textCss} onCommit={(t) => void apply(adapter.setText(source!, block, t))} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 3 }}>{del}</div>
          </div>
        )
      case 'code':
        return (
          <div key={idx} style={{ margin: '6px 0', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px', background: 'var(--card)' }} onFocus={focus}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--muted)' }}>Code</span>
              <CommitInput value={block.lang ?? ''} ariaLabel="Code language" mono onFocus={focus} onCommit={(t) => { if (adapter.setCode) void apply(adapter.setCode(source!, block, { lang: t.trim() })) }} style={{ ...inputStyle, width: 110 }} />
              <span style={{ marginLeft: 'auto' }}>{del}</span>
            </div>
            <CommitArea value={block.text} rows={Math.min(12, block.text.split('\n').length + 1)} ariaLabel="Code content" mono onFocus={focus} onCommit={(t) => { if (adapter.setCode) void apply(adapter.setCode(source!, block, { code: t })) }} />
          </div>
        )
      case 'table':
        return (
          <div key={idx} style={{ margin: '6px 0' }}>
            <Markdown text={block.raw ?? block.text} />
            <div style={noteStyle}>Table — shown rendered; edit it as text in the editor for now.</div>
          </div>
        )
      case 'hr':
        return <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0' }}><hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border-strong)' }} />{del}</div>
      case 'raw':
        return (
          <div key={idx} style={{ margin: '6px 0' }}>
            <Markdown text={block.raw ?? block.text} />
            <div style={noteStyle}>Raw content — shown rendered; edit it as text in the editor.</div>
          </div>
        )
    }
  }

  return (
    <div style={wrap}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 'calc(13px * var(--ui-scale, 1))', fontWeight: 600, color: 'var(--text)' }}>{adapter.label}</div>
          <span className="seg" role="group" aria-label="Editor mode" style={{ marginLeft: 'auto' }}>
            <button type="button" className={mode === 'blocks' ? 'on' : ''} style={smallBtn} onClick={() => setMode('blocks')}>Edit</button>
            <button type="button" className={mode === 'preview' ? 'on' : ''} style={smallBtn} onClick={() => setMode('preview')}>Preview</button>
          </span>
        </div>

        {/* Portion 1: the normal toolbar functions */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', padding: '7px 10px', marginBottom: showAi ? 6 : 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={portionLabel}>FORMAT</span>
            <select
              aria-label="Font size"
              value={activeBlock?.style.fontSizePt ?? 12}
              disabled={!activeBlock || greyed(support?.fontSize)}
              title={reason(support?.fontSize) ?? 'Font size for the block you are editing'}
              onChange={(e) => { if (activeBlock) void apply(adapter.setStyle(source, activeBlock, { fontSizePt: Number(e.target.value) })) }}
              style={{ ...inputStyle, padding: '2px 4px' }}
            >
              {FONT_SIZES.map((s) => <option key={s} value={s}>{s} pt</option>)}
              {activeBlock?.style.fontSizePt && !FONT_SIZES.includes(activeBlock.style.fontSizePt) && <option value={activeBlock.style.fontSizePt}>{activeBlock.style.fontSizePt} pt</option>}
            </select>
            <button
              type="button"
              aria-label="Bold"
              aria-pressed={Boolean(activeBlock?.style.bold)}
              disabled={!activeBlock || greyed(support?.fontWeight)}
              title={reason(support?.fontWeight) ?? 'Bold for the block you are editing'}
              onClick={() => { if (activeBlock) void apply(adapter.setStyle(source, activeBlock, { bold: !activeBlock.style.bold })) }}
              style={{ ...smallBtn, fontWeight: 800, ...(activeBlock?.style.bold ? { borderColor: 'var(--border-strong)', background: 'var(--well)' } : {}) }}
              className="deck-btn"
            >B</button>
            <span className="seg" role="group" aria-label="Text alignment">
              {(['left', 'center', 'right', 'justify'] as TextAlign[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  aria-label={`Align ${a}`}
                  className={(activeBlock?.style.align ?? 'left') === a ? 'on' : ''}
                  disabled={!activeBlock || greyed(support?.align)}
                  title={reason(support?.align) ?? `Align ${a}`}
                  onClick={() => { if (activeBlock) void apply(adapter.setStyle(source, activeBlock, { align: a })) }}
                  style={smallBtn}
                >{a === 'left' ? '⯇' : a === 'center' ? '≡' : a === 'right' ? '⯈' : '☰'}</button>
              ))}
            </span>
            {activeBlock?.kind === 'heading' && adapter.setLevel && (
              <select aria-label="Heading level (toolbar)" value={activeBlock.level ?? 1} onChange={(e) => void apply(adapter.setLevel!(source, activeBlock, Number(e.target.value)))} style={{ ...inputStyle, padding: '2px 4px' }}>
                {[1, 2, 3, 4, 5, 6].map((l) => <option key={l} value={l}>Heading {l}</option>)}
              </select>
            )}
          </div>
          {reasons.length > 0 && mode === 'blocks' && (
            <div style={{ ...noteStyle, marginLeft: 82 }}>{reasons[0]}</div>
          )}
          {/* Portion 2: the AI actions for this file */}
          {showAi && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 7, borderTop: '1px solid var(--border-soft)', paddingTop: 7, position: 'relative', zIndex: 5 }}>
              <span style={portionLabel}>AI ACTIONS</span>
              <FormatActionMenus renderer={aiRenderer} path={path} onDispatched={onDispatched} />
            </div>
          )}
        </div>

        <div style={{ fontSize: 'calc(12.5px * var(--ui-scale, 1))', color: 'var(--muted)', lineHeight: 1.6 }}>
          {mode === 'blocks'
            ? <>{adapter.editNote}</>
            : <>The document as readers see it. Switch to Edit to change it.</>}
        </div>
        {error && <div style={{ fontSize: 'calc(12px * var(--ui-scale, 1))', color: 'var(--red-text)', margin: '6px 0' }}>{error}</div>}

        {mode === 'preview' ? (
          <div style={{ marginTop: 10, color: 'var(--text)', fontSize: 'calc(13.5px * var(--ui-scale, 1))', lineHeight: 1.65 }}>
            {adapter.id === 'markdown'
              ? <Markdown text={source} />
              : blocks.map((b, i) => (
                <p key={i} style={{ fontSize: b.style.fontSizePt ? `calc(${b.style.fontSizePt}px * var(--ui-scale, 1))` : undefined, fontWeight: b.style.bold ? 700 : undefined, textAlign: b.style.align, whiteSpace: 'pre-wrap', margin: '0 0 10px' }}>{b.text}</p>
              ))}
          </div>
        ) : (
          <>
            {blocks.length === 0 && <div style={{ fontSize: 'calc(12.5px * var(--ui-scale, 1))', color: 'var(--muted)', marginTop: 12 }}>This file is empty.</div>}
            {blocks.map((b, i) => blockView(b, i))}
            <div style={{ display: 'flex', gap: 6, marginTop: 14, borderTop: '1px solid var(--border-soft)', paddingTop: 10 }}>
              <span style={{ fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--muted)', paddingTop: 3 }}>Add:</span>
              <button type="button" className="deck-btn" style={smallBtn} onClick={() => void apply(adapter.appendBlock(source, 'heading'))}>Heading</button>
              <button type="button" className="deck-btn" style={smallBtn} onClick={() => void apply(adapter.appendBlock(source, 'paragraph'))}>Paragraph</button>
              <button type="button" className="deck-btn" style={smallBtn} onClick={() => void apply(adapter.appendBlock(source, 'list'))}>List item</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
