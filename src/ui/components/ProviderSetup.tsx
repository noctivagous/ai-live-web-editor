import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  MODALITIES, MODALITY_LABELS, PROVIDER_PRESETS, PROVIDER_SECTIONS,
  presetById, suggestedModel,
  type Modality, type ProviderPreset,
} from '../../providerPresets'
import {
  activateConnection, deleteConnection, getConnections, probeConnection,
  saveConnection, saveModalityDefaults, testConnection,
  type ConnectionInfo, type ConnectionPricing, type ConnectionsPayload, type ProbeErrorKind, type TaggedModel,
} from '../lib/api'
import { PROVIDER_LOGOS } from '../lib/logos'

/* ── Shared state ──────────────────────────────────────────────────────── */

export function useConnections() {
  const [payload, setPayload] = useState<ConnectionsPayload | null>(null)
  const reload = useCallback(async () => {
    try {
      setPayload(await getConnections())
    } catch {
      setPayload(null)
    }
  }, [])
  useEffect(() => { void reload() }, [reload])
  return { payload, setPayload, reload }
}

/** The wizard gate: a saved connection whose chosen model a probe
 *  verified as a text model, with a key on file (or none needed). */
export function hasValidConnection(payload: ConnectionsPayload | null): boolean {
  if (!payload) return false
  return payload.connections.some(c =>
    c.hasKey && c.model &&
    c.verifiedModels.some(m => m.id === c.model && m.modalities.includes('text')))
}

const PROBE_ERROR_TEXT: Record<ProbeErrorKind, string> = {
  invalid_key: 'That key was rejected by the provider. Check it and try again.',
  no_credit: 'The key works, but the account is out of credit with this provider.',
  unreachable: 'Could not reach the provider. Check the base URL and your connection.',
  no_models: 'The key validated, but the provider returned no models for it.',
  unknown: 'Something went wrong while contacting the provider.',
}

function Logo({ preset, size = 30 }: { preset: ProviderPreset, size?: number }) {
  const src = PROVIDER_LOGOS[preset.slotId]
  if (src) {
    return (
      <span className="plogo" style={{ width: size, height: size }}>
        <img src={src} alt="" width={size - 8} height={size - 8} />
      </span>
    )
  }
  return (
    <span className="plogo letter" style={{ width: size, height: size }}>
      {preset.name.replace(/[^A-Za-z]/g, '').slice(0, 1) || 'C'}
    </span>
  )
}

function ModalityChips({ models, declared }: { models?: TaggedModel[], declared: Modality[] }) {
  const counts = new Map<Modality, number>()
  for (const m of models || []) for (const mod of m.modalities) counts.set(mod, (counts.get(mod) || 0) + 1)
  const list = models ? MODALITIES.filter(m => counts.has(m)) : declared
  if (!list.length) return null
  return (
    <span className="pchips">
      {list.map(m => (
        <span key={m} className="pchip">{MODALITY_LABELS[m]}{models ? ` ${counts.get(m)}` : ''}</span>
      ))}
    </span>
  )
}

/* ── Card editor (compact ⇄ expanded, one shared implementation) ─────── */

interface EditorProps {
  preset: ProviderPreset
  conn?: ConnectionInfo
  onClose: () => void
  onSaved: () => void
}

function CardEditor({ preset, conn, onClose, onSaved }: EditorProps) {
  const [expanded, setExpanded] = useState(false)
  const [key, setKey] = useState('')
  const [name, setName] = useState(conn?.name || preset.name)
  const [baseUrl, setBaseUrl] = useState(conn?.baseUrl || preset.defaultBaseUrl)
  const [model, setModel] = useState(conn?.model || '')
  const [tagged, setTagged] = useState<TaggedModel[]>(conn?.verifiedModels || [])
  const [priceIn, setPriceIn] = useState(conn?.pricing ? String(conn.pricing.input) : '')
  const [priceOut, setPriceOut] = useState(conn?.pricing ? String(conn.pricing.output) : '')
  const [probe, setProbe] = useState<'idle' | 'probing' | 'ok' | 'error'>('idle')
  const [probeError, setProbeError] = useState<{ kind: ProbeErrorKind, message: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const probeSeq = useRef(0)

  const runProbe = useCallback(async (input: { key?: string, baseUrl?: string, connectionId?: string }) => {
    const seq = ++probeSeq.current
    setProbe('probing')
    setProbeError(null)
    try {
      const r = await probeConnection({ presetId: preset.slotId, ...input })
      if (seq !== probeSeq.current) return
      if (!r.ok) {
        setProbe('error')
        setProbeError({ kind: r.errorKind || 'unknown', message: r.error || '' })
        return
      }
      const models = r.tagged || []
      setTagged(models)
      setProbe('ok')
      if (r.baseUrl) setBaseUrl(r.baseUrl)
      setModel(prev => {
        if (prev && models.some(m => m.id === prev && m.modalities.includes('text'))) return prev
        return suggestedModel(preset, models, 'text')
      })
    } catch (e: unknown) {
      if (seq !== probeSeq.current) return
      setProbe('error')
      setProbeError({ kind: 'unknown', message: e instanceof Error ? e.message : String(e) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset.slotId])

  // Opening a saved connection reloads its model list with the stored key.
  useEffect(() => {
    if (conn) void runProbe({ connectionId: conn.id, baseUrl: conn.baseUrl })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.id])

  // Paste a key → validate automatically. For a custom endpoint the
  // base URL is part of the probe, so editing it re-validates too.
  useEffect(() => {
    const k = key.trim()
    if (!preset.noKey && k.length < 8) return
    if (!preset.noKey && !k && !conn) return
    const t = setTimeout(() => {
      void runProbe(conn && !k ? { connectionId: conn.id, baseUrl } : { key: k, baseUrl })
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, baseUrl])

  const keyReady = preset.noKey || Boolean(key.trim()) || Boolean(conn?.hasKey)
  const canSave = Boolean(model) && keyReady && probe !== 'probing' &&
    (probe === 'ok' || (conn && !key.trim()))

  async function save() {
    if (!canSave) return
    setSaving(true)
    setSaveError(null)
    try {
      let pricing: ConnectionPricing | null | undefined
      if (priceIn.trim() || priceOut.trim()) {
        const input = Number(priceIn)
        const output = Number(priceOut)
        if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) {
          throw new Error('Pricing must be two non-negative numbers (USD per 1M tokens)')
        }
        pricing = { input, output }
      } else if (conn?.pricing) {
        pricing = null
      }
      await saveConnection({
        id: conn?.id,
        presetId: preset.slotId,
        name: name.trim() || preset.name,
        baseUrl,
        model,
        key: key.trim() || undefined,
        verifiedModels: tagged.length ? tagged : undefined,
        pricing,
      })
      onSaved()
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function clear() {
    if (conn) {
      try {
        await deleteConnection(conn.id)
        onSaved()
      } catch (e: unknown) {
        setSaveError(e instanceof Error ? e.message : String(e))
      }
    } else {
      setKey('')
      setTagged([])
      setModel('')
      setProbe('idle')
    }
  }

  const grouped = MODALITIES
    .map(m => ({ modality: m, models: tagged.filter(t => t.modalities.includes(m)) }))
    .filter(g => g.models.length)

  return (
    <div className="peditor">
      {!preset.noKey && (
        <>
          <label className="field-label" htmlFor={`key-${preset.slotId}`}>API key</label>
          <input
            id={`key-${preset.slotId}`}
            type="password"
            autoComplete="off"
            className="deck-input"
            value={key}
            onChange={e => { setKey(e.target.value); setSaveError(null) }}
            placeholder={conn?.hasKey ? `Saved (…${conn.keyLast4})` : 'Paste your key'}
          />
        </>
      )}
      {preset.slotId === 'custom' && (
        <>
          <label className="field-label">Base URL</label>
          <input
            className="deck-input"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="https://…/v1"
          />
        </>
      )}

      {probe === 'probing' && <div className="field-hint">Validating…</div>}
      {probe === 'error' && probeError && (
        <div className="field-hint" style={{ color: 'var(--red-text)' }}>
          {PROBE_ERROR_TEXT[probeError.kind]}
          {probeError.kind === 'unknown' && probeError.message ? ` (${probeError.message})` : ''}
        </div>
      )}

      {tagged.length > 0 && (
        <div className="pmodels">
          {grouped.map(g => (
            <div key={g.modality} className="pmodel-group">
              <div className="pmodel-head">{MODALITY_LABELS[g.modality]} · {g.models.length}</div>
              <div className="pmodel-list">
                {g.models.map(m => {
                  const selectable = g.modality === 'text'
                  const selected = model === m.id
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`pmodel ${selected ? 'sel' : ''}`}
                      disabled={!selectable}
                      title={selectable ? 'Use as this connection’s model' : m.id}
                      onClick={() => selectable && setModel(m.id)}
                    >
                      {m.id}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {expanded && (
        <div className="pexpanded">
          <label className="field-label">Connection name</label>
          <input className="deck-input" value={name} onChange={e => setName(e.target.value)} />
          {preset.slotId !== 'custom' && (
            <>
              <label className="field-label">Base URL</label>
              <input className="deck-input" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
            </>
          )}
          <label className="field-label">Price per 1M tokens, USD (optional, for cost estimates)</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="deck-input"
              value={priceIn}
              onChange={e => setPriceIn(e.target.value)}
              placeholder="Input, e.g. 3"
              inputMode="decimal"
              style={{ width: '50%' }}
            />
            <input
              className="deck-input"
              value={priceOut}
              onChange={e => setPriceOut(e.target.value)}
              placeholder="Output, e.g. 15"
              inputMode="decimal"
              style={{ width: '50%' }}
            />
          </div>
          <div className="field-hint">
            {preset.getKeyUrl && (
              <>Need a key? <a href={preset.getKeyUrl} target="_blank" rel="noreferrer">Get one from {preset.name}</a>. </>
            )}
            Keys are stored on this machine and never shown back.
          </div>
          {conn && (
            <button className="deck-btn danger" onClick={() => void clear()}>Remove connection</button>
          )}
        </div>
      )}

      {saveError && <div className="field-hint" style={{ color: 'var(--red-text)' }}>{saveError}</div>}

      <div className="peditor-actions">
        <button className="deck-btn primary" disabled={!canSave || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="deck-btn" onClick={() => void clear()}>{conn ? 'Clear' : 'Clear'}</button>
        <button
          className="deck-btn"
          disabled={probe === 'probing'}
          onClick={() => void runProbe(conn && !key.trim() ? { connectionId: conn.id, baseUrl } : { key: key.trim(), baseUrl })}
        >
          Reload
        </button>
        <button className="deck-btn" onClick={onClose}>Cancel</button>
        <button className="deck-btn ghost" style={{ marginLeft: 'auto' }} onClick={() => setExpanded(e => !e)}>
          {expanded ? '⤡ Show less' : '⤢ Expand'}
        </button>
      </div>
    </div>
  )
}

/* ── Provider cards + sections ─────────────────────────────────────────── */

export function ProviderSetup({ payload, reload, onChanged }: {
  payload: ConnectionsPayload | null
  reload: () => Promise<void>
  onChanged?: () => void
}) {
  const [tab, setTab] = useState<string>('frontier')
  const [openSlot, setOpenSlot] = useState<string | null>(null)
  const connections = payload?.connections || []

  const connFor = (preset: ProviderPreset) => connections.find(c => c.presetId === preset.slotId)
  const countIn = (section: string) => connections.filter(c => {
    const p = presetById(c.presetId)
    return (p?.section || 'local') === section
  }).length

  function afterChange() {
    setOpenSlot(null)
    void reload()
    onChanged?.()
  }

  const customPreset = presetById('custom')!
  const customConns = connections.filter(c => c.presetId === 'custom')

  return (
    <div>
      <div className="ptabs" role="tablist">
        {PROVIDER_SECTIONS.map(s => (
          <button
            key={s.id}
            role="tab"
            aria-selected={tab === s.id}
            className={`ptab ${tab === s.id ? 'on' : ''}`}
            onClick={() => setTab(s.id)}
          >
            {s.label}
            {countIn(s.id) > 0 && <span className="ptab-count">{countIn(s.id)}</span>}
          </button>
        ))}
      </div>

      <div className="pgrid">
        {PROVIDER_PRESETS.filter(p => p.section === tab && p.slotId !== 'custom').map(preset => {
          const conn = connFor(preset)
          const open = openSlot === preset.slotId
          return (
            <div key={preset.slotId} className={`pcard ${conn ? 'has' : ''} ${open ? 'open' : ''}`}>
              <div className="pcard-head">
                <Logo preset={preset} />
                <div style={{ minWidth: 0 }}>
                  <div className="pcard-name">
                    {preset.name}
                    {conn?.active && <span className="pbadge">Active</span>}
                    {conn && !conn.active && <span className="pbadge dim">Saved</span>}
                  </div>
                  <div className="pcard-blurb">{preset.blurb}</div>
                </div>
              </div>
              <div className="pcard-meta">
                <ModalityChips models={conn?.verifiedModels} declared={preset.modalities} />
                {preset.webSearch && (
                  <span className="pchips">
                    <span className="pchip" title="This provider searches the web itself — no separate search key needed. Pick it as the source in the chat header's Search setting.">Web search</span>
                  </span>
                )}
                {conn && (
                  <span className="pcard-model mono" title={conn.model}>{conn.model}</span>
                )}
              </div>
              {conn && (
                <div className="field-hint" style={{ margin: 0 }}>
                  {preset.noKey ? 'Local server — no key' : conn.hasKey ? `Saved (…${conn.keyLast4})` : 'No key on file'}
                  {' · '}{conn.status}
                </div>
              )}
              {!open && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="deck-btn" onClick={() => setOpenSlot(preset.slotId)}>
                    {conn ? 'Edit' : 'Add key'}
                  </button>
                  {conn && !conn.active && (
                    <button
                      className="deck-btn"
                      onClick={() => { void activateConnection(conn.id).then(() => afterChange()) }}
                    >
                      Set active
                    </button>
                  )}
                  {conn && (
                    <button
                      className="deck-btn"
                      onClick={() => { void testConnection(conn.id).then(() => afterChange()) }}
                    >
                      Test
                    </button>
                  )}
                </div>
              )}
              {open && (
                <CardEditor preset={preset} conn={conn} onClose={() => setOpenSlot(null)} onSaved={afterChange} />
              )}
            </div>
          )
        })}
      </div>

      <div className="pcustom">
        <div className="pcustom-head">
          <Logo preset={customPreset} size={26} />
          <div>
            <div className="pcard-name">Custom endpoint</div>
            <div className="pcard-blurb">Any other OpenAI-compatible service, by base URL.</div>
          </div>
          <button
            className="deck-btn"
            style={{ marginLeft: 'auto' }}
            onClick={() => setOpenSlot(openSlot === 'custom-new' ? null : 'custom-new')}
          >
            Add custom
          </button>
        </div>
        {customConns.map(conn => (
          <div key={conn.id} className="pcustom-row">
            <span className="mono" style={{ fontWeight: 550 }}>{conn.name}</span>
            <span className="mono" style={{ color: 'var(--muted)' }}>{conn.baseUrl}</span>
            <span className="mono" style={{ color: 'var(--muted)' }}>{conn.model}</span>
            {conn.active && <span className="pbadge">Active</span>}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {!conn.active && (
                <button className="deck-btn" onClick={() => { void activateConnection(conn.id).then(() => afterChange()) }}>Set active</button>
              )}
              <button className="deck-btn" onClick={() => setOpenSlot(`custom-${conn.id}`)}>Edit</button>
            </span>
            {openSlot === `custom-${conn.id}` && (
              <div style={{ flexBasis: '100%' }}>
                <CardEditor preset={customPreset} conn={conn} onClose={() => setOpenSlot(null)} onSaved={afterChange} />
              </div>
            )}
          </div>
        ))}
        {openSlot === 'custom-new' && (
          <CardEditor preset={customPreset} onClose={() => setOpenSlot(null)} onSaved={afterChange} />
        )}
      </div>
    </div>
  )
}

/* ── Models by type (per-modality defaults) ────────────────────────────── */

export function ModalityPanel({ payload, reload, onChanged }: {
  payload: ConnectionsPayload | null
  reload: () => Promise<void>
  onChanged?: () => void
}) {
  const [draft, setDraft] = useState<ConnectionsPayload['modalityDefaults']>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(payload?.modalityDefaults || {})
  }, [payload])

  const connections = payload?.connections || []

  function optionsFor(modality: Modality) {
    const out: { conn: ConnectionInfo, model: string }[] = []
    for (const conn of connections) {
      for (const m of conn.verifiedModels) {
        if (m.modalities.includes(modality)) out.push({ conn, model: m.id })
      }
    }
    return out
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await saveModalityDefaults(draft)
      await reload()
      onChanged?.()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {MODALITIES.map(modality => {
        const options = optionsFor(modality)
        const value = draft[modality] ? `${draft[modality]!.connectionId}|${draft[modality]!.model}` : ''
        return (
          <div key={modality} style={{ marginBottom: 10 }}>
            <label className="field-label">
              {MODALITY_LABELS[modality]}
              {modality === 'text' && <span style={{ color: 'var(--muted)', fontWeight: 400 }}> — used by the editor agent</span>}
            </label>
            <select
              className="deck-select"
              value={value}
              disabled={!options.length}
              onChange={e => {
                const [connectionId, model] = e.target.value.split('|')
                setDraft(d => ({ ...d, [modality]: connectionId ? { connectionId, model } : undefined }))
              }}
            >
              <option value="">{options.length ? 'Choose a model' : `No verified ${MODALITY_LABELS[modality].toLowerCase()} models yet`}</option>
              {options.map(o => (
                <option key={`${o.conn.id}|${o.model}`} value={`${o.conn.id}|${o.model}`}>
                  {o.model} — {o.conn.name}
                </option>
              ))}
            </select>
          </div>
        )
      })}
      {error && <div className="field-hint" style={{ color: 'var(--red-text)' }}>{error}</div>}
      <button className="deck-btn primary" disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save defaults'}
      </button>
    </div>
  )
}
