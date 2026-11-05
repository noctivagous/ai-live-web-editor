import React, { useEffect, useState } from 'react'
import { getConfig, listFiles, type LauncherConfig } from '../lib/api'

const STEPS = ['Welcome', 'AI key', 'Project files', 'Browser & preview', 'Done']

type Check<T> = { state: 'wait' | 'ok' | 'bad', detail: string, data?: T }

async function probeHmr(url: string, timeoutMs = 4000): Promise<boolean> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    // opaque response means the server is up (no-cors hides the body, not reachability)
    await fetch(url, { mode: 'no-cors', signal: ctrl.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

function CheckRow({ check, title, children }: {
  check: Check<unknown>, title: string, children?: React.ReactNode
}) {
  const mark = check.state === 'wait' ? '…' : check.state === 'ok' ? '✓' : '!'
  return (
    <div className={`check-row ${check.state}`}>
      <span className="mark">{mark}</span>
      <div style={{ minWidth: 0 }}>
        <div>{title}</div>
        <small>{check.detail}</small>
        {children}
      </div>
    </div>
  )
}

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  const [config, setConfig] = useState<LauncherConfig | null>(null)
  const [keyCheck, setKeyCheck] = useState<Check<LauncherConfig>>({ state: 'wait', detail: 'Checking…' })
  const [fsCheck, setFsCheck] = useState<Check<{ files: string[], root: string }>>({ state: 'wait', detail: 'Checking…' })
  const [hmrCheck, setHmrCheck] = useState<Check<never>>({ state: 'wait', detail: 'Checking…' })

  async function runKeyCheck() {
    setKeyCheck({ state: 'wait', detail: 'Contacting the launcher…' })
    try {
      const c = await getConfig()
      setConfig(c)
      setKeyCheck(c.hasOpenAiKey
        ? { state: 'ok', detail: `Key detected on the launcher. Model: ${c.model}.`, data: c }
        : { state: 'bad', detail: 'No OPENAI_API_KEY on the launcher. The editor works without it, but AI chat will fail until you set one.' })
    } catch (e: unknown) {
      setKeyCheck({ state: 'bad', detail: `Launcher unreachable or outdated: ${e instanceof Error ? e.message : String(e)}. Run the latest launcher (npm run dev, restart if already running), then Recheck.` })
    }
  }

  async function runFsCheck() {
    setFsCheck({ state: 'wait', detail: 'Listing project files…' })
    try {
      const data = await listFiles()
      setFsCheck({
        state: data.files.length ? 'ok' : 'bad',
        detail: data.files.length
          ? `${data.files.length} files under ${data.root}.`
          : `Launcher answered but no files found under ${data.root}.`,
        data,
      })
    } catch (e: unknown) {
      setFsCheck({ state: 'bad', detail: `Launcher unreachable: ${e instanceof Error ? e.message : String(e)}. Run the latest launcher (npm run dev, restart if already running), then Recheck.` })
    }
  }

  async function runHmrCheck() {
    setHmrCheck({ state: 'wait', detail: 'Probing the Vite HMR server…' })
    const up = await probeHmr('http://localhost:5173')
    setHmrCheck(up
      ? { state: 'ok', detail: 'Vite HMR is up on :5173 — live preview with hot reload is available.' }
      : { state: 'bad', detail: 'Nothing on :5173. Static preview still works; run npm run projects:dev for HMR.' })
  }

  useEffect(() => {
    if (step === 1 && keyCheck.state === 'wait' && !config) void runKeyCheck()
    if (step === 2 && fsCheck.state === 'wait') void runFsCheck()
    if (step === 3 && hmrCheck.state === 'wait') void runHmrCheck()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const last = step === STEPS.length - 1

  return (
    <div className="wizard-overlay" role="dialog" aria-modal="true" aria-label="Setup wizard">
      <div className="wizard-card">
        <div style={{ fontSize: 17, fontWeight: 650 }}>AI Live Editor setup</div>
        <div style={{ fontSize: 13, color: '#a1a1aa', marginTop: 4 }}>
          Step {step + 1} of {STEPS.length} — {STEPS[step]}
        </div>
        <div className="wizard-steps" aria-hidden="true">
          {STEPS.map((s, i) => <span key={s} className={i <= step ? 'done' : ''} />)}
        </div>

        {step === 0 && (
          <div style={{ fontSize: 13.5, lineHeight: 1.65, color: '#d4d4d8' }}>
            <p style={{ margin: '0 0 10px' }}>
              This editor writes to a real project folder, patches a live browser tab,
              and lets an AI agent drive both. Three things need to be true:
            </p>
            <div className="check-row ok"><span className="mark">1</span><div>Launcher running<small>Serves the UI, the file API, and the browser pool on <code>:4112</code>.</small></div></div>
            <div className="check-row ok"><span className="mark">2</span><div>AI key set (optional)<small><code>OPENAI_API_KEY</code> in the launcher environment enables chat.</small></div></div>
            <div className="check-row ok"><span className="mark">3</span><div>Project + preview reachable<small>Files on disk, static preview always; Vite HMR on <code>:5173</code> when you want it.</small></div></div>
            <p style={{ margin: '10px 0 0', color: '#a1a1aa', fontSize: 12.5 }}>
              The next steps verify each one live. Nothing here changes your files.
            </p>
          </div>
        )}

        {step === 1 && (
          <div>
            <CheckRow check={keyCheck} title={config ? `Model: ${config.model}` : 'AI key status'}>
              {keyCheck.state === 'bad' && (
                <small>
                  Set <code>OPENAI_API_KEY</code> in the launcher <code>.env</code> (or environment),
                  restart the launcher, then press Recheck.
                </small>
              )}
            </CheckRow>
            <button className="deck-btn" onClick={() => void runKeyCheck()}>Recheck</button>
          </div>
        )}

        {step === 2 && (
          <div>
            <CheckRow check={fsCheck} title="Project files" />
            <button className="deck-btn" onClick={() => void runFsCheck()}>Recheck</button>
          </div>
        )}

        {step === 3 && (
          <div>
            <CheckRow check={hmrCheck} title="Preview servers">
              <small>
                Static preview is served by the launcher itself (<code>/projects/</code>) and needs nothing extra.
                The HMR button in the preview pane targets <code>localhost:5173</code>, which only runs
                while <code>npm run projects:dev</code> is up.
              </small>
            </CheckRow>
            <button className="deck-btn" onClick={() => void runHmrCheck()}>Recheck</button>
          </div>
        )}

        {step === 4 && (
          <div style={{ fontSize: 13.5, lineHeight: 1.65 }}>
            <CheckRow check={keyCheck.state === 'wait' ? { state: 'wait', detail: 'Not checked — revisit step 2.' } : keyCheck} title="AI key" />
            <CheckRow check={fsCheck.state === 'wait' ? { state: 'wait', detail: 'Not checked — revisit step 3.' } : fsCheck} title="Project files" />
            <CheckRow check={hmrCheck.state === 'wait' ? { state: 'wait', detail: 'Not checked — revisit step 4.' } : hmrCheck} title="Preview" />
            <p style={{ color: '#a1a1aa', fontSize: 12.5 }}>
              You can reopen this wizard any time from Settings.
            </p>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          {step > 0 && (
            <button className="deck-btn" onClick={() => setStep(s => s - 1)}>Back</button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {!last && (
              <button className="deck-btn" onClick={onDone} title="Skip the remaining steps">Skip setup</button>
            )}
            {!last && (
              <button className="deck-btn primary" onClick={() => setStep(s => s + 1)}>Next</button>
            )}
            {last && (
              <button className="deck-btn primary" onClick={onDone}>Open editor</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
