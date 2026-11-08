import React, { useEffect, useMemo, useState } from 'react'
import { readFile, writeFile } from '../lib/api'
import { countConfigNodes, parseConfig, replaceConfigScalar, type ConfigFormat, type ConfigNode } from '../lib/configDoc'
import { fieldMetaFor, groupTopLevelKeys, profileForConfigPath, type ConfigProfile } from '../lib/configProfiles'
import type { JsonFieldMeta } from '../lib/jsonProfiles'
import { addDataValue, parseDataTree, removeDataNode } from '../lib/dataTree'
import { AddRow, RemoveButton } from './StructuralControls'
import type { Structural } from './JsonView'

/**
 * Config form editor for YAML, TOML and .env (renderer registry):
 * the JSON form's idea extended to the other config formats — one
 * component over lib/configDoc's neutral tree, typed controls by
 * value shape, sections and field metadata from the file's profile
 * (lib/configProfiles). A commit serialises the new value in the
 * format's own syntax and splices it into its exact place in the
 * file; comments, ordering and anything the form cannot model
 * (raw nodes: anchors, inline tables, block scalars…) are shown
 * but never touched. Adding and removing fields ride the
 * structural core (lib/dataTree) — the same operations the
 * agent's data-add / data-remove tools call.
 */

const MAX_FORM_NODES = 1500

const inputStyle: React.CSSProperties = { background: 'var(--well)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '3px 6px', fontSize: 'calc(12px * var(--ui-scale, 1))' }
const labelStyle: React.CSSProperties = { fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--muted)', width: 150, flexShrink: 0, paddingTop: 4, wordBreak: 'break-word' }
const descStyle: React.CSSProperties = { fontSize: 'calc(11px * var(--ui-scale, 1))', color: 'var(--faint)', lineHeight: 1.45, marginTop: 2 }

type Commit = (node: ConfigNode, text: string) => void

function ScalarControl({ node, meta, onCommit }: { node: ConfigNode; meta: JsonFieldMeta; onCommit: Commit }) {
  const [draft, setDraft] = useState<string | null>(null)
  const value = node.value ?? ''

  if (node.scalarKind === 'boolean') {
    return (
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'calc(12px * var(--ui-scale, 1))', color: 'var(--text)', cursor: 'pointer' }}>
        <input type="checkbox" checked={value === 'true'} aria-label="toggle" onChange={(e) => onCommit(node, e.target.checked ? 'true' : 'false')} />
        {value === 'true' ? 'true' : 'false'}
      </label>
    )
  }
  if (meta.control === 'select') {
    const options = meta.options ?? []
    const all = options.includes(value) ? options : [value, ...options]
    return (
      <select value={value} aria-label="value" onChange={(e) => onCommit(node, e.target.value)} style={{ ...inputStyle }}>
        {all.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  if (node.scalarKind === 'number') {
    const shown = draft ?? value
    return (
      <input
        type="number"
        value={shown}
        aria-label="number value"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== null) { const n = Number(draft); if (!Number.isNaN(n) && draft.trim() !== '') onCommit(node, draft.trim()); setDraft(null) } }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        style={{ ...inputStyle, width: 130 }}
      />
    )
  }
  const shown = draft ?? value
  const commitDraft = () => { if (draft !== null) { onCommit(node, draft); setDraft(null) } }
  if (meta.control === 'longtext') {
    return (
      <textarea
        value={shown}
        aria-label="text value"
        rows={2}
        placeholder={node.scalarKind === 'null' ? '(empty)' : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        style={{ ...inputStyle, flex: 1, minWidth: 180, resize: 'vertical', fontFamily: 'inherit' }}
      />
    )
  }
  return (
    <input
      type="text"
      value={shown}
      aria-label="text value"
      placeholder={node.scalarKind === 'null' ? '(empty)' : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitDraft}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      style={{ ...inputStyle, flex: 1, minWidth: 140 }}
    />
  )
}

function NodeValue({ node, path, addr, profile, onCommit, structural }: {
  node: ConfigNode
  /** Named path segments only (array indices skipped) for profile lookup. */
  path: string[]
  /** The true data address (indices included) for structural edits. */
  addr: string
  profile: ConfigProfile
  onCommit: Commit
  structural?: Structural
}) {
  const meta = fieldMetaFor(profile, path)
  if (node.kind === 'scalar') {
    return (
      <div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <ScalarControl node={node} meta={meta} onCommit={onCommit} />
        </div>
        {meta.description && <div style={descStyle}>{meta.description}</div>}
      </div>
    )
  }
  if (node.kind === 'raw') {
    return (
      <div>
        <span className="mono" style={{ fontSize: 'calc(12px * var(--ui-scale, 1))', color: 'var(--text)', wordBreak: 'break-word' }}>{node.raw}</span>
        <div style={descStyle}>Not a plain value in this form — edit it as text in the editor.</div>
      </div>
    )
  }
  const kids = node.children ?? []
  return (
    <div style={{ flex: 1, borderLeft: '2px solid var(--border-soft)', paddingLeft: 12 }}>
      {meta.description && <div style={{ ...descStyle, marginBottom: 4 }}>{meta.description}</div>}
      {kids.length === 0 && <div style={{ fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--faint)' }}>{node.kind === 'array' ? 'Empty list.' : 'Empty.'}</div>}
      {kids.map((child) => (
        <FieldRow
          key={`${child.key}-${child.start}`}
          label={node.kind === 'array' ? String(Number(child.key) + 1) : child.key}
          node={child}
          path={node.kind === 'array' ? path : [...path, child.key]}
          addr={node.kind === 'array' ? `${addr}[${child.key}]` : (addr === '' ? child.key : `${addr}.${child.key}`)}
          profile={profile}
          onCommit={onCommit}
          structural={structural}
        />
      ))}
      {structural && node.kind === 'object' && <AddRow needsKey onAdd={(k, v, kind) => structural.add(addr, k, v, kind)} />}
      {structural && node.kind === 'array' && <AddRow needsKey={false} onAdd={(k, v, kind) => structural.add(addr, k, v, kind)} />}
    </div>
  )
}

function FieldRow({ label, node, path, addr, profile, onCommit, structural }: {
  label: string
  node: ConfigNode
  path: string[]
  addr: string
  profile: ConfigProfile
  onCommit: Commit
  structural?: Structural
}) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '5px 0' }}>
      <div className="mono" style={labelStyle}>{label}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <NodeValue node={node} path={path} addr={addr} profile={profile} onCommit={onCommit} structural={structural} />
      </div>
      {structural && addr !== '' && <RemoveButton onRemove={() => structural.remove(addr)} />}
    </div>
  )
}

export function ConfigView({ path, format, onSaved }: {
  path: string
  format: ConfigFormat
  onSaved: () => void
}) {
  const [source, setSource] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setSource(null)
    setFailed(false)
    setError(null)
    readFile(path)
      .then((data) => { if (live) setSource(typeof data?.content === 'string' ? data.content : '') })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [path])

  const profile = useMemo(() => profileForConfigPath(path, format), [path, format])
  const parsed = useMemo(() => (source === null ? null : parseConfig(format, source)), [source, format])

  const save = (next: string) => {
    setSource(next)
    setError(null)
    void (async () => {
      try {
        await writeFile(path, next)
        onSaved()
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }

  const commit: Commit = (node, text) => {
    if (source === null) return
    const next = replaceConfigScalar(source, format, node, text)
    if (next === source) return
    save(next)
  }

  const structural: Structural = {
    add: (addr, key, value, kind) => {
      if (source === null) return
      const tree = parseDataTree(format, source)
      if (tree.ok === false) { setError(tree.error); return }
      const r = addDataValue(format, source, tree.root, addr, key, value, kind)
      if (r.ok === false) { setError(r.error); return }
      save(r.source)
    },
    remove: (addr) => {
      if (source === null) return
      const tree = parseDataTree(format, source)
      if (tree.ok === false) { setError(tree.error); return }
      const r = removeDataNode(format, source, tree.root, addr)
      if (r.ok === false) { setError(r.error); return }
      save(r.source)
    },
  }

  const wrap: React.CSSProperties = { flex: 1, overflow: 'auto', background: 'var(--panel)', padding: '16px 20px', minHeight: 0 }
  if (failed) return <div style={wrap}><div style={{ color: 'var(--muted)', fontSize: 'calc(12.5px * var(--ui-scale, 1))' }}>Could not read {path}.</div></div>
  if (source === null || parsed === null) return <div style={wrap}><div style={{ color: 'var(--muted)', fontSize: 'calc(12.5px * var(--ui-scale, 1))' }}>Loading {path}…</div></div>

  if (parsed.ok === false) {
    return (
      <div style={wrap}>
        <div style={{ maxWidth: 560, color: 'var(--muted)', fontSize: 'calc(12.5px * var(--ui-scale, 1))', lineHeight: 1.6 }}>
          <div style={{ color: 'var(--text)', fontWeight: 600, marginBottom: 6 }}>This file doesn&rsquo;t fit the form&rsquo;s model yet</div>
          {parsed.error} The file is unchanged, and you can edit it as text in the editor.
        </div>
      </div>
    )
  }

  const nodes = countConfigNodes(parsed.root)
  if (nodes > MAX_FORM_NODES) {
    return (
      <div style={wrap}>
        <div style={{ maxWidth: 560, color: 'var(--muted)', fontSize: 'calc(12.5px * var(--ui-scale, 1))', lineHeight: 1.6 }}>
          <div style={{ color: 'var(--text)', fontWeight: 600, marginBottom: 6 }}>{profile.title}</div>
          This file has {nodes.toLocaleString()} values — too many to show as a form. The file is unchanged; edit it as text in the editor.
        </div>
      </div>
    )
  }

  const root = parsed.root
  const topKeys = (root.children ?? []).map((c) => c.key)
  return (
    <div style={wrap}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ fontSize: 'calc(13px * var(--ui-scale, 1))', fontWeight: 600, color: 'var(--text)' }}>{profile.title}</div>
        <div style={{ fontSize: 'calc(12.5px * var(--ui-scale, 1))', color: 'var(--muted)', lineHeight: 1.6, marginTop: 2 }}>
          Editing a field rewrites that value in <span className="mono">{path}</span>. Everything else in the file stays as it is.
        </div>
        {error && <div style={{ fontSize: 'calc(12px * var(--ui-scale, 1))', color: 'var(--red-text)', margin: '6px 0' }}>{error}</div>}

        {groupTopLevelKeys(profile, topKeys).map((group) => {
          const byKey = new Map((root.children ?? []).map((c) => [c.key, c]))
          return (
            <div key={group.title || 'fields'} style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', background: 'var(--card)' }}>
              {group.title && <div style={{ fontSize: 'calc(12.5px * var(--ui-scale, 1))', fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>{group.title}</div>}
              {group.keys.map((key) => {
                const child = byKey.get(key)!
                return <FieldRow key={`${key}-${child.start}`} label={fieldMetaFor(profile, [key]).label ?? key} node={child} path={[key]} addr={key} profile={profile} onCommit={commit} structural={structural} />
              })}
            </div>
          )
        })}
        <div style={{ marginTop: 12, border: '1px dashed var(--border)', borderRadius: 10, padding: '6px 12px' }}>
          <AddRow needsKey onAdd={(k, v, kind) => structural.add('', k, v, kind)} />
        </div>
      </div>
    </div>
  )
}
