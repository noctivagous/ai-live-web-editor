import React, { useState } from 'react'
import type { DataScalarKind } from '../lib/dataTree'

/**
 * The form surfaces' structural controls: a remove button for a
 * field row and an add row for a section or list. Both views
 * (JsonView, ConfigView) render these; the action itself runs
 * through lib/dataTree's add/remove — the same core the agent's
 * data-add / data-remove tools call, so a person and the agent
 * make identical edits.
 */

const inputStyle: React.CSSProperties = { background: 'var(--well)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '3px 6px', fontSize: 'calc(12px * var(--ui-scale, 1))' }

export function RemoveButton({ onRemove }: { onRemove: () => void }) {
  return (
    <button
      type="button"
      aria-label="Remove this field"
      title="Remove this field"
      onClick={onRemove}
      style={{
        background: 'transparent', border: '1px solid transparent', borderRadius: 6,
        color: 'var(--faint)', cursor: 'pointer', fontSize: 'calc(13px * var(--ui-scale, 1))',
        lineHeight: 1, padding: '3px 6px', flexShrink: 0,
      }}
    >
      ✕
    </button>
  )
}

export function AddRow({ needsKey, onAdd }: {
  needsKey: boolean
  onAdd: (key: string | null, value: string, kind?: DataScalarKind) => void
}) {
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [type, setType] = useState<'auto' | 'string' | 'number'>('auto')
  const ready = value.trim() !== '' && (!needsKey || key.trim() !== '')
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0 2px' }}>
      {needsKey && (
        <input
          type="text"
          value={key}
          aria-label="New field name"
          placeholder="new field"
          onChange={(e) => setKey(e.target.value)}
          style={{ ...inputStyle, width: 130 }}
        />
      )}
      <input
        type="text"
        value={value}
        aria-label="New field value"
        placeholder="value"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && ready) {
            onAdd(needsKey ? key.trim() : null, value, type === 'auto' ? undefined : type)
            setKey('')
            setValue('')
          }
        }}
        style={{ ...inputStyle, flex: 1, minWidth: 120 }}
      />
      <select
        value={type}
        aria-label="New field type"
        title="How the value is typed: Auto reads it as it looks (true, numbers, null become those types)"
        onChange={(e) => setType(e.target.value as 'auto' | 'string' | 'number')}
        style={{ ...inputStyle }}
      >
        <option value="auto">Auto</option>
        <option value="string">Text</option>
        <option value="number">Number</option>
      </select>
      <button
        type="button"
        disabled={!ready}
        onClick={() => {
          onAdd(needsKey ? key.trim() : null, value, type === 'auto' ? undefined : type)
          setKey('')
          setValue('')
        }}
        style={{
          background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border-strong)',
          borderRadius: 6, padding: '3px 10px', fontSize: 'calc(12px * var(--ui-scale, 1))',
          cursor: ready ? 'pointer' : 'default', opacity: ready ? 1 : 0.5,
        }}
      >
        Add
      </button>
    </div>
  )
}
