import { useEffect, useState } from 'react'
import {
  getMuseCodeHealth, getProjectConfig, postMuseSandboxProbe, postProjectConfig,
  type MuseCodeHealth, type ProjectConfig, type SandboxProbeResult,
} from '../lib/api'
import { loadUiPrefs, saveUiPrefs, type UiPrefs } from '../lib/uiPrefs'
import {
  museRunConfig, resolveSandboxPosture, type SandboxPosture,
} from '../lib/museSandbox'
import { MuseRequirementNote } from './MuseRequirementNote'

/**
 * The Muse Code sandbox surface (Muse Code design §5.2): one
 * component, two homes — the setup wizard's Permissions step on
 * the specialized path, and Settings → Agent & Chat (the wizard
 * and Settings are the same screen; switching the engine to Muse
 * Code in Settings brings this panel back, and nothing else in
 * setup re-runs).
 *
 * What it holds:
 * - Health facts from the host: the binary and its version, the
 *   sign-in state, and the sandbox probe — a real sandboxed run
 *   that answers whether sandboxed shell commands can start on
 *   this machine at all (a bwrap binary existing says nothing;
 *   the spike's VM had the sandbox die mounting /proc).
 * - The posture (lib/museSandbox): a device-wide default in the
 *   device prefs, a per-project override in project.ai.json, and
 *   the run configuration the posture in force maps to — host
 *   flags, per-session approval mode, network tier, and whether
 *   the project is trusted. Trust is part of the posture because
 *   an untrusted project silently loses the editor's tools and
 *   its own skills (spike item 2/5); Strict doesn't trust, and
 *   the surface says so on its face.
 *
 * Everything saves on change, like the rest of Settings.
 */

const POSTURE_COPY: Record<SandboxPosture, { label: string, blurb: string }> = {
  unblocked: {
    label: 'Unblocked',
    blurb: 'Runs get the permissions they need, and the project is trusted so the editor’s tools and the project’s skills load. Muse Code doesn’t stop to ask — the sandbox stays on.',
  },
  sandboxed: {
    label: 'Sandboxed with granted permissions',
    blurb: 'The sandbox is on and the project is trusted. Anything your grants don’t cover stops and asks first, and new network sites are approved one at a time.',
  },
  strict: {
    label: 'Strict',
    blurb: 'The sandbox is on with no network, everything is asked, and the project is not trusted — the editor’s tools and the project’s skills stay off in this posture (see below).',
  },
}

const APPROVAL_LABEL: Record<string, string> = {
  allowAll: 'Allow all — no prompts',
  onRequest: 'Ask when a grant doesn’t cover it',
  denyUnmatched: 'Ask for everything',
}

const NETWORK_LABEL: Record<string, string> = {
  'proxy-only': 'New sites approved one at a time',
  restricted: 'No network',
  unrestricted: 'Full access',
}

export function MuseSandboxSection() {
  const [prefs, setPrefs] = useState<UiPrefs>(() => loadUiPrefs())
  const [projectCfg, setProjectCfg] = useState<ProjectConfig | null>(null)
  const [health, setHealth] = useState<MuseCodeHealth | null>(null)
  const [probe, setProbe] = useState<SandboxProbeResult | null>(null)
  const [probing, setProbing] = useState(false)
  const [refreshingHealth, setRefreshingHealth] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void getMuseCodeHealth().then(h => {
      if (!live) return
      setHealth(h)
      setProbe(h.sandboxProbe)
    }).catch(() => { /* host unreachable — the rows stay in their checking state */ })
    void getProjectConfig().then(r => { if (live) setProjectCfg(r.config) }).catch(() => { /* as above */ })
    return () => { live = false }
  }, [])

  const availability = health?.availability ?? null
  const projectOverride = projectCfg?.museSandboxPosture
  const effective = resolveSandboxPosture(prefs.museSandboxPosture, projectOverride)
  const config = museRunConfig(effective)

  const setProjectOverride = (value: string) => {
    setError(null)
    void postProjectConfig({ museSandboxPosture: value === 'default' ? null : value })
      .then(r => setProjectCfg(r.config))
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
  }

  // The requirement note's Refresh: a fresh health read (the
  // host re-detects the binary, cache bypassed), in place.
  const refreshHealth = () => {
    setRefreshingHealth(true)
    void getMuseCodeHealth(true)
      .then(h => { setHealth(h); setProbe(h.sandboxProbe) })
      .catch(() => { /* host unreachable — the rows keep their state */ })
      .finally(() => setRefreshingHealth(false))
  }

  const runProbe = (force: boolean) => {
    setProbing(true)
    setError(null)
    void postMuseSandboxProbe(force)
      .then(setProbe)
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setProbing(false))
  }

  const probeRow = probing
    ? { state: 'wait' as const, detail: 'Running one sandboxed command in a scratch folder — a short, capped run…' }
    : probe === null
      ? { state: 'wait' as const, detail: 'Not checked yet. The check runs one real sandboxed command, so it only runs when you ask.' }
      : probe.state === 'ok'
        ? { state: 'ok' as const, detail: probe.detail }
        : probe.state === 'sandbox-failed'
          ? { state: 'bad' as const, detail: probe.detail }
          : { state: 'wait' as const, detail: probe.detail }

  return (
    <div>
      <p style={{ fontSize: 'calc(13.5px * var(--ui-scale, 1))', lineHeight: 1.6, color: 'var(--text)', margin: '0 0 12px' }}>
        Muse Code runs on this machine inside its own sandbox. What it may do —
        which folders it can write, whether it can reach the network, and whether
        this project is trusted so the editor’s tools and the project’s skills
        load — is decided here, and applies every time it runs.
      </p>

      {availability === null && (
        <div className="check-row wait">
          <span className="mark">…</span>
          <div>Checking for Muse Code on this machine<small>Looking for the <code>muse</code> program and asking it for its version.</small></div>
        </div>
      )}
      {availability?.available && (
        <div className="check-row ok">
          <span className="mark">✓</span>
          <div>
            Muse Code {availability.version} is installed on this machine
            <small>{availability.binPath}</small>
          </div>
        </div>
      )}
      {availability && !availability.available && (
        <>
          <div className="check-row bad">
            <span className="mark">!</span>
            <div>
              Muse Code is not available on this machine
              <small>
                {availability.binPath
                  ? 'The muse program was found but did not answer — it may be mid-update or damaged. Check again below.'
                  : 'Until it is installed, chats on the Muse Code engine can’t run — the Open path works with your own provider keys.'}
              </small>
            </div>
          </div>
          <div style={{ margin: '0 0 10px' }}>
            <MuseRequirementNote availability={availability} onRefresh={refreshHealth} refreshing={refreshingHealth} />
          </div>
        </>
      )}

      {health && (
        <div className={`check-row ${health.signIn.state === 'none-found' ? 'bad' : 'ok'}`}>
          <span className="mark">{health.signIn.state === 'none-found' ? '!' : '✓'}</span>
          <div>
            {health.signIn.state === 'none-found' ? 'Not signed in' : 'Signed in'}
            <small>{health.signIn.detail}</small>
          </div>
        </div>
      )}

      <div className={`check-row ${probeRow.state}`}>
        <span className="mark">{probeRow.state === 'ok' ? '✓' : probeRow.state === 'bad' ? '!' : '…'}</span>
        <div style={{ minWidth: 0 }}>
          <div>Sandboxed commands on this machine</div>
          <small>{probeRow.detail}</small>
          <div style={{ marginTop: 6 }}>
            <button type="button" className="deck-btn" disabled={probing || !availability?.available} onClick={() => runProbe(probe !== null)}>
              {probing ? 'Checking…' : probe === null ? 'Run check' : 'Run again'}
            </button>
          </div>
        </div>
      </div>

      <div className="set-group-label" style={{ marginTop: 14 }}>Sandbox posture</div>

      <div className="set-row">
        <div className="set-row-text">
          <label className="set-row-label" htmlFor="muse-posture-project">For this project</label>
          <div className="field-hint">
            Stored in this project’s project.ai.json and travels with it. “Use the device
            default” clears the project’s own choice.
          </div>
        </div>
        <div className="set-row-control">
          <select
            id="muse-posture-project" className="deck-select"
            value={projectOverride ?? 'default'}
            disabled={projectCfg === null}
            onChange={e => setProjectOverride(e.target.value)}
          >
            <option value="default">Use the device default</option>
            {(Object.keys(POSTURE_COPY) as SandboxPosture[]).map(p => (
              <option key={p} value={p}>{POSTURE_COPY[p].label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="set-row">
        <div className="set-row-text">
          <label className="set-row-label" htmlFor="muse-posture-device">Device default</label>
          <div className="field-hint">Applies to every project on this device that doesn’t carry its own choice.</div>
        </div>
        <div className="set-row-control">
          <select
            id="muse-posture-device" className="deck-select"
            value={prefs.museSandboxPosture}
            onChange={e => setPrefs(saveUiPrefs({ museSandboxPosture: e.target.value as SandboxPosture }))}
          >
            {(Object.keys(POSTURE_COPY) as SandboxPosture[]).map(p => (
              <option key={p} value={p}>{POSTURE_COPY[p].label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="field-hint" style={{ margin: '8px 0 4px' }}>
        In force for this project: <b>{POSTURE_COPY[effective].label}</b>
        {projectOverride ? ' — from this project’s own setting.' : ' — from the device default.'}
      </div>
      <div className="field-hint" style={{ marginBottom: 8 }}>{POSTURE_COPY[effective].blurb}</div>

      {!config.trustWorkspace && (
        <div className="check-row wait">
          <span className="mark">!</span>
          <div>
            This project is not trusted in the {POSTURE_COPY[effective].label} posture
            <small>
              Without trust, the editor’s tools — live page edits, graphs, plans and wizards —
              and this project’s own skills don’t load, and nothing warns you inside the chat.
              Pick Unblocked or Sandboxed with granted permissions to trust the project.
            </small>
          </div>
        </div>
      )}

      <dl className="set-facts">
        <div><dt>Host flags</dt><dd className="mono">{config.serveArgs.join(' ')}</dd></div>
        <div><dt>Approvals</dt><dd>{APPROVAL_LABEL[config.approvalMode]}</dd></div>
        <div><dt>Network</dt><dd>{NETWORK_LABEL[config.sandboxNetwork]}</dd></div>
        <div><dt>Project trusted</dt><dd>{config.trustWorkspace ? 'Yes' : 'No'}</dd></div>
      </dl>

      {error && <div className="field-hint" style={{ color: 'var(--red-text)', marginTop: 8 }}>{error}</div>}
    </div>
  )
}
