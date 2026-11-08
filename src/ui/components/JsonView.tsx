import React, { useEffect, useMemo, useState } from 'react'
import { readFile, writeFile } from '../lib/api'
import { countNodes, isScalarNode, lineColAt, parseJsonDocument, replaceScalarValue, type JsonNode, type JsonScalar } from '../lib/jsonDoc'
import { fieldMetaFor, groupTopLevelKeys, profileForJsonPath, type JsonFieldMeta, type JsonProfile } from '../lib/jsonProfiles'
import { addDataValue, parseDataTree, removeDataNode, type DataScalarKind } from '../lib/dataTree'
import { AddRow, RemoveButton } from './StructuralControls'

/**
 * JSON form editor (renderer registry, `json` surface): the marked
 * JSON file shown as a form over its tree — the CSS-boxes idea for
 * config files. Controls follow the value's shape (text for strings,
 * a toggle for booleans, a number field for numbers) unless the
 * file's profile (lib/jsonProfiles) knows better — package.json's
 * `scripts` are name → command rows, tsconfig's `target` is a menu.
 * The file stays canonical: a commit splices the new value into its
 * exact place in the text (lib/jsonDoc) and writes the file back.
 * Adding and removing fields ride the structural core
 * (lib/dataTree) — the same operations the agent's data-add /
 * data-remove tools call.
 */

const MAX_FORM_NODES = 1500

type Commit = (node: JsonNode, value: JsonScalar) => void

/** Structural edits by data address, through lib/dataTree. */
export interface Structural {
  add: (addr: string, key: string | null, value: string, kind?: DataScalarKind) => void
  remove: (addr: string) => void
}

const childAddr = (addr: string, key: string) => (addr === '' ? key : `${addr}.${key}`)

const inputStyle: React.CSSProperties = { background: 'var(--well)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '3px 6px', fontSize: 'calc(12px * var(--ui-scale, 1))' }
const labelStyle: React.CSSProperties = { fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--muted)', width: 150, flexShrink: 0, paddingTop: 4, wordBreak: 'break-word' }
const descStyle: React.CSSProperties = { fontSize: 'calc(11px * var(--ui-scale, 1))', color: 'var(--faint)', lineHeight: 1.45, marginTop: 2 }

function ScalarControl({ node, meta, readOnly, onCommit }: {
  node: JsonNode
  meta: JsonFieldMeta
  readOnly: boolean
  onCommit: Commit
}) {
  const [draft, setDraft] = useState<string | null>(null)
  if (!isScalarNode(node)) return null
  const value = node.value

  if (readOnly) {
    return <span className="mono" style={{ fontSize: 'calc(12px * var(--ui-scale, 1))', color: 'var(--text)', wordBreak: 'break-word' }}>{value === null ? 'null' : String(value)}</span>
  }
  if (node.kind === 'boolean') {
    return (
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'calc(12px * var(--ui-scale, 1))', color: 'var(--text)', cursor: 'pointer' }}>
        <input type="checkbox" checked={value as boolean} aria-label="toggle" onChange={(e) => onCommit(node, e.target.checked)} />
        {value ? 'true' : 'false'}
      </label>
    )
  }
  if (node.kind === 'null') {
    return <span className="mono" style={{ fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--faint)' }}>null</span>
  }
  if (meta.control === 'select' && node.kind === 'string') {
    const options = meta.options ?? []
    const all = options.includes(value as string) ? options : [value as string, ...options]
    return (
      <select value={value as string} aria-label="value" onChange={(e) => onCommit(node, e.target.value)} style={{ ...inputStyle }}>
        {all.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  if (node.kind === 'number') {
    const shown = draft ?? String(value)
    return (
      <input
        type="number"
        value={shown}
        aria-label="number value"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== null) { const n = Number(draft); if (!Number.isNaN(n) && draft.trim() !== '') onCommit(node, n); setDraft(null) } }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        style={{ ...inputStyle, width: 130 }}
      />
    )
  }
  // string
  const shown = draft ?? (value as string)
  if (meta.control === 'longtext') {
    return (
      <textarea
        value={shown}
        aria-label="text value"
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== null) { onCommit(node, draft); setDraft(null) } }}
        style={{ ...inputStyle, flex: 1, minWidth: 180, resize: 'vertical', fontFamily: 'inherit' }}
      />
    )
  }
  return (
    <input
      type="text"
      value={shown}
      aria-label="text value"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== null) { onCommit(node, draft); setDraft(null) } }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      style={{ ...inputStyle, flex: 1, minWidth: 140 }}
    />
  )
}

function NodeValue({ node, path, addr, profile, readOnly, onCommit, structural }: {
  node: JsonNode
  path: string[]
  addr: string
  profile: JsonProfile
  readOnly: boolean
  onCommit: Commit
  structural?: Structural
}) {
  const meta = fieldMetaFor(profile, path)

  if (isScalarNode(node)) {
    return (
      <div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <ScalarControl node={node} meta={meta} readOnly={readOnly} onCommit={onCommit} />
        </div>
        {meta.description && <div style={descStyle}>{meta.description}</div>}
      </div>
    )
  }

  if (node.kind === 'object') {
    if (meta.control === 'stringMap') {
      return (
        <div style={{ flex: 1 }}>
          {meta.description && <div style={{ ...descStyle, marginBottom: 6 }}>{meta.description}</div>}
          {node.entries.length === 0 && <div style={{ fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--faint)' }}>Empty.</div>}
          {node.entries.map((e) => (
            <div key={e.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '3px 0' }}>
              <div className="mono" style={{ ...labelStyle, width: 170 }}>{e.key}</div>
              <div style={{ flex: 1 }}>
                {isScalarNode(e.value)
                  ? <ScalarControl node={e.value} meta={{}} readOnly={readOnly} onCommit={onCommit} />
                  : <span style={{ fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--faint)' }}>Not a plain value — edit it as text.</span>}
              </div>
              {structural && <RemoveButton onRemove={() => structural.remove(childAddr(addr, e.key))} />}
            </div>
          ))}
          {structural && <AddRow needsKey onAdd={(k, v, kind) => structural.add(addr, k, v, kind)} />}
        </div>
      )
    }
    return (
      <div style={{ flex: 1, borderLeft: '2px solid var(--border-soft)', paddingLeft: 12 }}>
        {meta.description && <div style={{ ...descStyle, marginBottom: 4 }}>{meta.description}</div>}
        {node.entries.length === 0 && <div style={{ fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--faint)' }}>Empty object.</div>}
        {node.entries.map((e) => (
          <FieldRow key={[...path, e.key].join('.')} label={e.key} node={e.value} path={[...path, e.key]} addr={childAddr(addr, e.key)} profile={profile} readOnly={readOnly} onCommit={onCommit} structural={structural} />
        ))}
        {structural && <AddRow needsKey onAdd={(k, v, kind) => structural.add(addr, k, v, kind)} />}
      </div>
    )
  }

  // array
  if (meta.control === 'stringList' || node.items.every((it) => it.kind === 'string')) {
    return (
      <div style={{ flex: 1 }}>
        {meta.description && <div style={{ ...descStyle, marginBottom: 6 }}>{meta.description}</div>}
        {node.items.length === 0 && <div style={{ fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--faint)' }}>Empty list.</div>}
        {node.items.map((it, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '3px 0' }}>
            <div style={{ fontSize: 'calc(11px * var(--ui-scale, 1))', color: 'var(--faint)', width: 22, textAlign: 'right' }}>{idx + 1}</div>
            <div style={{ flex: 1 }}>
              {isScalarNode(it)
                ? <ScalarControl node={it} meta={{}} readOnly={readOnly} onCommit={onCommit} />
                : <NodeValue node={it} path={path} addr={`${addr}[${idx}]`} profile={profile} readOnly={readOnly} onCommit={onCommit} structural={structural} />}
            </div>
            {structural && <RemoveButton onRemove={() => structural.remove(`${addr}[${idx}]`)} />}
          </div>
        ))}
        {structural && <AddRow needsKey={false} onAdd={(k, v, kind) => structural.add(addr, k, v, kind)} />}
      </div>
    )
  }
  return (
    <div style={{ flex: 1, borderLeft: '2px solid var(--border-soft)', paddingLeft: 12 }}>
      {node.items.length === 0 && <div style={{ fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--faint)' }}>Empty list.</div>}
      {node.items.map((it, idx) => (
        <FieldRow key={idx} label={String(idx + 1)} node={it} path={path} addr={`${addr}[${idx}]`} profile={profile} readOnly={readOnly} onCommit={onCommit} structural={structural} />
      ))}
      {structural && <AddRow needsKey={false} onAdd={(k, v, kind) => structural.add(addr, k, v, kind)} />}
    </div>
  )
}

function FieldRow({ label, node, path, addr, profile, readOnly, onCommit, structural }: {
  label: string
  node: JsonNode
  path: string[]
  addr: string
  profile: JsonProfile
  readOnly: boolean
  onCommit: Commit
  structural?: Structural
}) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '5px 0' }}>
      <div className="mono" style={labelStyle}>{label}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <NodeValue node={node} path={path} addr={addr} profile={profile} readOnly={readOnly} onCommit={onCommit} structural={structural} />
      </div>
      {structural && addr !== '' && <RemoveButton onRemove={() => structural.remove(addr)} />}
    </div>
  )
}

export function JsonView({ path, onSaved }: { path: string; onSaved: () => void }) {
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

  const profile = useMemo(() => profileForJsonPath(path), [path])
  const parsed = useMemo(() => (source === null ? null : parseJsonDocument(source)), [source])
  const readOnly = Boolean(profile.generated)

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

  const commit: Commit = (node, value) => {
    if (source === null || readOnly) return
    if (isScalarNode(node) && node.value === value) return
    let next: string
    try {
      next = replaceScalarValue(source, node, value)
    } catch {
      return
    }
    save(next)
  }

  const structural: Structural | undefined = readOnly ? undefined : {
    add: (addr, key, value, kind) => {
      if (source === null) return
      const tree = parseDataTree('json', source)
      if (tree.ok === false) { setError(tree.error); return }
      const r = addDataValue('json', source, tree.root, addr, key, value, kind)
      if (r.ok === false) { setError(r.error); return }
      save(r.source)
    },
    remove: (addr) => {
      if (source === null) return
      const tree = parseDataTree('json', source)
      if (tree.ok === false) { setError(tree.error); return }
      const r = removeDataNode('json', source, tree.root, addr)
      if (r.ok === false) { setError(r.error); return }
      save(r.source)
    },
  }

  const wrap: React.CSSProperties = { flex: 1, overflow: 'auto', background: 'var(--panel)', padding: '16px 20px', minHeight: 0 }
  if (failed) return <div style={wrap}><div style={{ color: 'var(--muted)', fontSize: 'calc(12.5px * var(--ui-scale, 1))' }}>Could not read {path}.</div></div>
  if (source === null || parsed === null) return <div style={wrap}><div style={{ color: 'var(--muted)', fontSize: 'calc(12.5px * var(--ui-scale, 1))' }}>Loading {path}…</div></div>

  if (parsed.ok === false) {
    const at = lineColAt(source, parsed.offset)
    return (
      <div style={wrap}>
        <div style={{ maxWidth: 560, color: 'var(--muted)', fontSize: 'calc(12.5px * var(--ui-scale, 1))', lineHeight: 1.6 }}>
          <div style={{ color: 'var(--text)', fontWeight: 600, marginBottom: 6 }}>This file isn&rsquo;t valid JSON yet</div>
          {parsed.error} (line {at.line}, column {at.col}). The form view can&rsquo;t open it until it parses — the file is unchanged, and you can fix it as text in the editor.
        </div>
      </div>
    )
  }

  const nodes = countNodes(parsed.root)
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
  return (
    <div style={wrap}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ fontSize: 'calc(13px * var(--ui-scale, 1))', fontWeight: 600, color: 'var(--text)' }}>{profile.title}</div>
        <div style={{ fontSize: 'calc(12.5px * var(--ui-scale, 1))', color: 'var(--muted)', lineHeight: 1.6, marginTop: 2 }}>
          {readOnly ? profile.description : <>Editing a field rewrites that value in <span className="mono">{path}</span>. Everything else in the file stays as it is.</>}
        </div>
        {parsed.comments > 0 && (
          <div style={{ fontSize: 'calc(11.5px * var(--ui-scale, 1))', color: 'var(--muted)', marginTop: 4 }}>
            This file has comments (JSONC). They aren&rsquo;t shown as fields, and edits leave them untouched.
          </div>
        )}
        {error && <div style={{ fontSize: 'calc(12px * var(--ui-scale, 1))', color: 'var(--red-text)', margin: '6px 0' }}>{error}</div>}

        {root.kind === 'object' ? (
          groupTopLevelKeys(profile, root.entries.map((e) => e.key)).map((group) => {
            const byKey = new Map(root.entries.map((e) => [e.key, e]))
            return (
              <div key={group.title || 'fields'} style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', background: 'var(--card)' }}>
                {group.title && <div style={{ fontSize: 'calc(12.5px * var(--ui-scale, 1))', fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>{group.title}</div>}
                {group.keys.map((key) => {
                  const entry = byKey.get(key)!
                  return <FieldRow key={key} label={fieldMetaFor(profile, [key]).label ?? key} node={entry.value} path={[key]} addr={key} profile={profile} readOnly={readOnly} onCommit={commit} structural={structural} />
                })}
              </div>
            )
          })
        ) : (
          <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', background: 'var(--card)' }}>
            <NodeValue node={root} path={[]} addr="" profile={profile} readOnly={readOnly} onCommit={commit} structural={structural} />
          </div>
        )}
        {root.kind === 'object' && structural && (
          <div style={{ marginTop: 12, border: '1px dashed var(--border)', borderRadius: 10, padding: '6px 12px' }}>
            <AddRow needsKey onAdd={(k, v, kind) => structural.add('', k, v, kind)} />
          </div>
        )}
        {root.kind === 'object' && root.entries.length === 0 && (
          <div style={{ fontSize: 'calc(12.5px * var(--ui-scale, 1))', color: 'var(--muted)', marginTop: 12 }}>This file is an empty object.</div>
        )}
      </div>
    </div>
  )
}
