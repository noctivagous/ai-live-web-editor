import { useEffect, useState } from 'react'
import { fetchMcpState, updateMcpSettings, type McpSettings } from '../lib/mcp'

/**
 * Settings → MCP: the editor-global MCP switches. The values
 * live in the MCP config itself (Settings is just a second
 * window onto it), read and written through the MCP API —
 * the MCP manager reads the same state.
 */
export function McpSettingsSection() {
  const [settings, setSettings] = useState<McpSettings | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    fetchMcpState()
      .then(r => { if (live) setSettings(r.config.settings) })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : 'Could not load MCP settings') })
    return () => { live = false }
  }, [])

  const apply = (patch: Partial<McpSettings>) => {
    setSettings(s => (s ? { ...s, ...patch } : s))
    updateMcpSettings(patch)
      .then(r => setSettings(r.config.settings))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not save'))
  }

  if (!settings) {
    return <div className="field-hint">{error || 'Loading…'}</div>
  }
  return (
    <div>
      {error && <div className="field-hint" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="set-row">
        <div className="set-row-text">
          <label className="set-row-label" htmlFor="set-mcp-chat-tools">Chat uses MCP tools</label>
          <div className="field-hint">Chat turns connect to your enabled MCP servers and can call their tools. Turn this off to stop all MCP use in chat — the MCP manager in the header still works.</div>
        </div>
        <div className="set-row-control">
          <input
            id="set-mcp-chat-tools" type="checkbox"
            checked={settings.chatToolsEnabled}
            onChange={e => apply({ chatToolsEnabled: e.target.checked })}
          />
        </div>
      </div>
      <div className="set-row">
        <div className="set-row-text">
          <label className="set-row-label" htmlFor="set-mcp-protocol-choice">Protocol version per server</label>
          <div className="field-hint">Adds a Protocol choice to each server in the MCP manager. Leave off unless a server needs the 2026 protocol revision — checking for it slows down connections to today's servers.</div>
        </div>
        <div className="set-row-control">
          <input
            id="set-mcp-protocol-choice" type="checkbox"
            checked={settings.protocolChoiceEnabled}
            onChange={e => apply({ protocolChoiceEnabled: e.target.checked })}
          />
        </div>
      </div>
    </div>
  )
}
