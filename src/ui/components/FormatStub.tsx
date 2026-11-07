import React from 'react'
import type { RendererDescriptor } from '../lib/previewRender'

/**
 * Placeholder surface for a registered renderer whose reading isn't
 * built yet (document, workbook). It says exactly that, in the
 * descriptor's own words — the file is markable and the slot exists,
 * but nothing pretends to read a format it can't.
 */
export function FormatStub({ path, descriptor }: { path: string; descriptor: RendererDescriptor }) {
  const name = path.split('/').pop() || path
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#141417', padding: 20, textAlign: 'center', minHeight: 0 }}>
      <div style={{ maxWidth: 420 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#e4e4e7', marginBottom: 8 }}>Not readable here yet</div>
        <div style={{ fontSize: 12.5, color: '#a1a1aa', lineHeight: 1.6 }}>
          <span className="mono">{name}</span> — {descriptor.summary} The file is unchanged.
        </div>
      </div>
    </div>
  )
}
