import React, { useState } from 'react'
import { NoctAppSettings, NoctPanel, NoctSegmented, NoctStack, NoctWell } from './noct/react.tsx'

/**
 * AppKit pilot: a small app shell built from the vendored
 * noct-code-appkit components (Lit) through their generated React
 * wrappers. The settings panel is the catalog's noct-app-settings —
 * the component the editor's find-component tool recommends for
 * "settings page" requests.
 */
export default function App() {
  const [showSettings, setShowSettings] = useState(false)
  const [target, setTarget] = useState('desktop')
  const [lastEvent, setLastEvent] = useState('—')

  return (
    <div style={{ minHeight: '100vh', background: '#17171c', color: '#e4e4e7', fontFamily: 'system-ui, sans-serif', padding: 20, boxSizing: 'border-box' }}>
      <NoctStack direction="column" gap="16px">
        <NoctPanel title="AppKit Pilot" subtitle="Vendored noct-* components, driven from React">
          <span slot="actions">
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              style={{ background: '#2e2e36', color: '#e4e4e7', border: '1px solid #3f3f46', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}
            >
              Open settings
            </button>
          </span>
          <NoctStack direction="column" gap="12px">
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55 }}>
              This shell is assembled from the component catalog: layout from
              noct-stack and noct-panel, the device switch from noct-segmented,
              and the settings surface from noct-app-settings — copied into the
              project (copy-own) rather than imported from a package.
            </p>
            <NoctSegmented
              label="Device target"
              items={JSON.stringify([
                { id: 'phone', label: 'Phone' },
                { id: 'tablet', label: 'Tablet' },
                { id: 'desktop', label: 'Desktop' },
              ])}
              value={target}
              onSegmentedSelect={(e) => {
                const id = e.detail?.id || e.detail?.value || 'desktop'
                setTarget(id)
                setLastEvent(`segmented-select → ${id}`)
              }}
            />
            <NoctWell label="Last component event">{lastEvent}</NoctWell>
          </NoctStack>
        </NoctPanel>
      </NoctStack>

      <NoctAppSettings
        show={showSettings}
        title="Pilot Settings"
        onClose={() => { setShowSettings(false); setLastEvent('settings close') }}
      >
        <div slot="general">
          <NoctStack direction="column" gap="8px">
            <label style={{ fontSize: 13 }}>
              Project name{' '}
              <input defaultValue="appkit-pilot" style={{ background: '#26262c', color: '#e4e4e7', border: '1px solid #3f3f46', borderRadius: 4, padding: '4px 8px' }} />
            </label>
            <p style={{ margin: 0, fontSize: 12.5, color: '#a1a1aa' }}>
              General section, delivered through the panel's "general" slot.
            </p>
          </NoctStack>
        </div>
        <div slot="advanced">
          <p style={{ margin: 0, fontSize: 12.5, color: '#a1a1aa' }}>
            Advanced section, through the "advanced" slot. Current target: {target}.
          </p>
        </div>
      </NoctAppSettings>
    </div>
  )
}
