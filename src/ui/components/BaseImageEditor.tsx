import React, { useEffect, useRef, useState } from 'react'
import { binaryFileUrl, writeBinaryFile } from '../lib/api'
import { DEFAULT_IMAGE_EDIT, filterFor, isIdentityEdit, outputDims, outputForPath, type ImageEditState } from '../lib/imageEdit'
import { FormatActionMenus } from './FormatToolbar'

/**
 * The base image editor: ONE editing surface for every raster
 * image format, the way BaseTextEditor serves the text formats.
 * Two portions:
 *  1. The NORMAL toolbar — rotate, flip, brightness / contrast /
 *     saturation, output size, Reset, and Save (which encodes the
 *     canvas in the file's own format and writes it back whole,
 *     through the binary write path).
 *  2. The AI ACTIONS for the file (shared FormatActionMenus),
 *     hidden by the preview bar's "AI toolbar" checkbox.
 *
 * SVG is vector text: it is shown with its AI actions and a plain
 * note, never rasterised — a vector editor is a different base.
 */

const inputStyle: React.CSSProperties = { background: 'var(--well)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '3px 6px', fontSize: 'calc(12px * var(--ui-scale, 1))' }
const smallBtn = { padding: '2px 8px', fontSize: 'calc(11px * var(--ui-scale, 1))' } as const
const portionLabel: React.CSSProperties = { fontSize: 'calc(10.5px * var(--ui-scale, 1))', fontWeight: 700, letterSpacing: '.06em', color: 'var(--faint)', width: 74, flexShrink: 0 }

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = String(reader.result || '')
      resolve(s.slice(s.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('could not read the edited image'))
    reader.readAsDataURL(blob)
  })
}

export function BaseImageEditor({ path, showAi, onSaved, onDispatched }: {
  path: string
  showAi: boolean
  onSaved: () => void
  onDispatched?: (title: string) => void
}) {
  const output = outputForPath(path)
  const [state, setState] = useState<ImageEditState>(DEFAULT_IMAGE_EDIT)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [bust, setBust] = useState(0)
  const src = `${binaryFileUrl(path)}&v=${bust}`

  useEffect(() => {
    setState(DEFAULT_IMAGE_EDIT)
    setNatural(null)
    setLoadFailed(false)
    setNotice(null)
    setError(null)
  }, [path])

  // (Re)draw the canvas whenever the edit or the loaded image changes.
  useEffect(() => {
    const img = imgRef.current
    const canvas = canvasRef.current
    if (!img || !canvas || !natural) return
    const dims = outputDims(natural.w, natural.h, state)
    canvas.width = dims.width
    canvas.height = dims.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.filter = filterFor(state)
    ctx.save()
    ctx.translate(dims.width / 2, dims.height / 2)
    ctx.rotate((state.rotate * Math.PI) / 180)
    ctx.scale((state.flipH ? -1 : 1) * (dims.width / (state.rotate === 90 || state.rotate === 270 ? natural.h : natural.w)), (state.flipV ? -1 : 1) * (dims.height / (state.rotate === 90 || state.rotate === 270 ? natural.w : natural.h)))
    ctx.drawImage(img, -natural.w / 2, -natural.h / 2)
    ctx.restore()
  }, [state, natural])

  async function save() {
    const canvas = canvasRef.current
    if (!canvas || !output.mime) return
    setSaving(true)
    setError(null)
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, output.mime!, output.mime === 'image/jpeg' || output.mime === 'image/webp' ? 0.92 : undefined))
      if (!blob) throw new Error('the browser could not encode this image')
      await writeBinaryFile(path, await blobToBase64(blob))
      setState(DEFAULT_IMAGE_EDIT)
      setNatural(null)
      setBust((b) => b + 1) // reload the saved file, not the cached pre-edit image
      setNotice('Saved. The file on disk now holds the edited image.')
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const wrap: React.CSSProperties = { flex: 1, overflow: 'auto', background: 'var(--panel)', padding: '16px 20px', minHeight: 0 }

  // Vector: show it, say why the raster tools are absent.
  if (output.vector) {
    return (
      <div style={wrap}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          {showAi && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', padding: '7px 10px', marginBottom: 12, position: 'relative', zIndex: 5 }}>
              <span style={portionLabel}>AI ACTIONS</span>
              <FormatActionMenus renderer="image" path={path} onDispatched={onDispatched} />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <img src={src} alt={path} style={{ maxWidth: '100%', maxHeight: 420, objectFit: 'contain' }} />
          </div>
          <div style={{ fontSize: 'calc(12.5px * var(--ui-scale, 1))', color: 'var(--muted)', lineHeight: 1.6, textAlign: 'center' }}>{output.reason}</div>
        </div>
      </div>
    )
  }

  const dims = natural ? outputDims(natural.w, natural.h, state) : null
  const slider = (label: string, key: 'brightness' | 'contrast' | 'saturation') => (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--muted)' }}>
      {label}
      <input type="range" min={0} max={200} step={1} value={state[key]} aria-label={label} onChange={(e) => setState((s) => ({ ...s, [key]: Number(e.target.value) }))} style={{ width: 90 }} />
      <span className="mono" style={{ width: 34 }}>{state[key]}%</span>
    </label>
  )

  return (
    <div style={wrap}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div style={{ fontSize: 'calc(13px * var(--ui-scale, 1))', fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Image editor</div>

        {/* Portion 1: the normal toolbar functions */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', padding: '7px 10px', marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={portionLabel}>IMAGE</span>
            <button type="button" className="deck-btn" style={smallBtn} title="Rotate 90° counter-clockwise" onClick={() => setState((s) => ({ ...s, rotate: (s.rotate + 270) % 360 }))}>⟲ Rotate</button>
            <button type="button" className="deck-btn" style={smallBtn} title="Rotate 90° clockwise" onClick={() => setState((s) => ({ ...s, rotate: (s.rotate + 90) % 360 }))}>Rotate ⟳</button>
            <button type="button" className="deck-btn" style={smallBtn} aria-pressed={state.flipH} title="Flip horizontal" onClick={() => setState((s) => ({ ...s, flipH: !s.flipH }))}>Flip ↔</button>
            <button type="button" className="deck-btn" style={smallBtn} aria-pressed={state.flipV} title="Flip vertical" onClick={() => setState((s) => ({ ...s, flipV: !s.flipV }))}>Flip ↕</button>
            {slider('Brightness', 'brightness')}
            {slider('Contrast', 'contrast')}
            {slider('Saturation', 'saturation')}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 7 }}>
            <span style={portionLabel}>SIZE</span>
            <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--muted)' }}>
              Width
              <input type="number" min={1} placeholder={dims ? String(dims.width) : ''} value={state.width ?? ''} aria-label="Output width" onChange={(e) => setState((s) => ({ ...s, width: e.target.value === '' ? null : Math.max(1, Number(e.target.value)) }))} style={{ ...inputStyle, width: 76 }} />
            </label>
            <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--muted)' }}>
              Height
              <input type="number" min={1} placeholder={dims ? String(dims.height) : ''} value={state.height ?? ''} aria-label="Output height" onChange={(e) => setState((s) => ({ ...s, height: e.target.value === '' ? null : Math.max(1, Number(e.target.value)) }))} style={{ ...inputStyle, width: 76 }} />
            </label>
            {natural && <span style={{ fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--faint)' }}>Original {natural.w} × {natural.h}{dims && (state.width !== null || state.height !== null || state.rotate !== 0) ? ` · output ${dims.width} × ${dims.height}` : ''}</span>}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button type="button" className="deck-btn" style={smallBtn} disabled={isIdentityEdit(state)} onClick={() => setState(DEFAULT_IMAGE_EDIT)}>Reset</button>
              <button type="button" className="deck-btn primary" style={smallBtn} disabled={!output.canSave || isIdentityEdit(state) || saving} title={output.canSave ? 'Write the edited image back to the file' : output.reason} onClick={() => void save()}>
                {saving ? 'Saving…' : 'Save image'}
              </button>
            </span>
          </div>
          {!output.canSave && <div style={{ fontSize: 'calc(11px * var(--ui-scale, 1))', color: 'var(--faint)', marginTop: 5, marginLeft: 82 }}>{output.reason}</div>}
          {/* Portion 2: the AI actions for this file */}
          {showAi && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 7, borderTop: '1px solid var(--border-soft)', paddingTop: 7, position: 'relative', zIndex: 5 }}>
              <span style={portionLabel}>AI ACTIONS</span>
              <FormatActionMenus renderer="image" path={path} onDispatched={onDispatched} />
            </div>
          )}
        </div>

        {notice && <div style={{ fontSize: 'calc(12px * var(--ui-scale, 1))', color: 'var(--green-text)', marginBottom: 6 }}>{notice}</div>}
        {error && <div style={{ fontSize: 'calc(12px * var(--ui-scale, 1))', color: 'var(--red-text)', marginBottom: 6 }}>{error}</div>}
        {loadFailed && <div style={{ fontSize: 'calc(12.5px * var(--ui-scale, 1))', color: 'var(--muted)' }}>Could not load {path}.</div>}

        <img
          ref={imgRef}
          src={src}
          alt=""
          style={{ display: 'none' }}
          onLoad={(e) => { const el = e.currentTarget; setNatural({ w: el.naturalWidth, h: el.naturalHeight }) }}
          onError={() => setLoadFailed(true)}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}>
          <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: 520, objectFit: 'contain', background: 'repeating-conic-gradient(var(--well) 0% 25%, var(--card) 0% 50%) 0 0 / 16px 16px', border: '1px solid var(--border)' }} />
        </div>
        {!isIdentityEdit(state) && <div style={{ fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--muted)', textAlign: 'center' }}>Unsaved edits — the file changes only when you press Save image.</div>}
      </div>
    </div>
  )
}
