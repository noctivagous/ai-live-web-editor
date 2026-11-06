import React, { useEffect, useState } from 'react'
import { listFiles } from '../lib/api'
import { ModalityPanel, ProviderSetup, hasValidConnection, useConnections } from './ProviderSetup'
import { MODALITY_LABELS, type Modality } from '../../providerPresets'

const STEPS = ['Welcome', 'AI provider', 'Models by type', 'Project files', 'Preview', 'Done']

type Check = { state: 'wait' | 'ok' | 'bad', detail: string }

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
  check: Check, title: string, children?: React.ReactNode
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
  const { payload, reload } = useConnections()
  const [fsCheck, setFsCheck] = useState<Check>({ state: 'wait', detail: 'Checking…' })
  const [hmrCheck, setHmrCheck] = useState<Check>({ state: 'wait', detail: 'Checking…' })

  const valid = hasValidConnection(payload)
  const active = payload?.connections.find(c => c.id === payload.activeId)

  async function runFsCheck() {
    setFsCheck({ state: 'wait', detail: 'Listing project files…' })
    try {
      const data = await listFiles()
      setFsCheck({
        state: data.files.length ? 'ok' : 'bad',
        detail: data.files.length
          ? `${data.files.length} files under ${data.root}.`
          : `Launcher answered but no files found under ${data.root}.`,
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
    if (step === 3 && fsCheck.state === 'wait') void runFsCheck()
    if (step === 4 && hmrCheck.state === 'wait') void runHmrCheck()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const last = step === STEPS.length - 1
  const nextDisabled = step === 1 && !valid
  const wide = step === 1 || step === 2

  const providerCheck: Check = valid
    ? {
        state: 'ok',
        detail: active
          ? `${active.name} — ${active.model}. Defaults: ${(['text', 'image', 'video', 'audio'] as Modality[])
              .filter(m => payload?.modalityDefaults[m])
              .map(m => `${MODALITY_LABELS[m]}: ${payload!.modalityDefaults[m]!.model}`)
              .join(' · ') || 'text only'}.`
          : 'A provider connection is saved and validated.',
      }
    : { state: 'bad', detail: 'No validated provider connection yet — add one in the AI provider step.' }

  return (
    <div className="wizard-overlay" role="dialog" aria-modal="true" aria-label="Setup wizard">
      <div className={`wizard-card ${wide ? 'wide' : ''}`}>
        <div style={{ fontSize: 17, fontWeight: 650 }}>Set up your AI provider</div>
        <div style={{ fontSize: 13, color: '#a1a1aa', marginTop: 4 }}>
          Step {step + 1} of {STEPS.length} — {STEPS[step]}
        </div>
        <div className="wizard-steps" aria-hidden="true">
          {STEPS.map((s, i) => <span key={s} className={i <= step ? 'done' : ''} />)}
        </div>

        {step === 0 && (
          <div style={{ fontSize: 13.5, lineHeight: 1.65, color: '#d4d4d8' }}>
            <p style={{ margin: '0 0 10px' }}>
              This editor lets an AI agent write and change the files in your
              project while you watch the result update live. For the AI to
              work, it needs an account with an AI provider — you bring your
              own key.
            </p>
            <div className="check-row ok"><span className="mark">1</span><div>Have your API key ready<small>From a provider like OpenAI, Meta, Anthropic, or OpenRouter. The next step shows where to get one for each.</small></div></div>
            <div className="check-row ok"><span className="mark">2</span><div>Paste it, pick a model<small>The key is checked against the provider, then you choose which of its models the editor should use — for text, and later for image, video, and audio too.</small></div></div>
            <div className="check-row ok"><span className="mark">3</span><div>Your key stays on this machine<small>It is stored locally and only ever sent to the provider you picked. You can add more providers later, side by side, in Settings — it is the same screen as the next step.</small></div></div>
          </div>
        )}

        {step === 1 && (
          <ProviderSetup payload={payload} reload={reload} />
        )}

        {step === 2 && (
          <div>
            <p style={{ fontSize: 13.5, lineHeight: 1.6, color: '#d4d4d8', margin: '0 0 12px' }}>
              Choose which model to use for each kind of work. Only models your
              keys actually unlocked are listed.
            </p>
            <ModalityPanel payload={payload} reload={reload} />
          </div>
        )}

        {step === 3 && (
          <div>
            <CheckRow check={fsCheck} title="Project files" />
            <button className="deck-btn" onClick={() => void runFsCheck()}>Recheck</button>
          </div>
        )}

        {step === 4 && (
          <div>
            <CheckRow check={hmrCheck} title="Preview servers">
              <small>
                Static preview is served by the launcher itself (<code>/projects/</code>).
                Vite HMR on <code>localhost:5173</code> is started by <code>npm run dev</code> for the active project.
              </small>
            </CheckRow>
            <button className="deck-btn" onClick={() => void runHmrCheck()}>Recheck</button>
          </div>
        )}

        {step === 5 && (
          <div style={{ fontSize: 13.5, lineHeight: 1.65 }}>
            <CheckRow check={providerCheck} title="AI provider" />
            <CheckRow check={fsCheck.state === 'wait' ? { state: 'wait', detail: 'Not checked — revisit step 4.' } : fsCheck} title="Project files" />
            <CheckRow check={hmrCheck.state === 'wait' ? { state: 'wait', detail: 'Not checked — revisit step 5.' } : hmrCheck} title="Preview" />
            <p style={{ color: '#a1a1aa', fontSize: 12.5 }}>
              Ask the agent to edit or generate files from the chat panel. Providers
              and models can be changed any time in Settings.
            </p>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          {step > 0 && (
            <button className="deck-btn" onClick={() => setStep(s => s - 1)}>Back</button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {!last && (
              <button className="deck-btn primary" disabled={nextDisabled} onClick={() => setStep(s => s + 1)}>Next</button>
            )}
            {last && (
              <button className="deck-btn primary" disabled={!valid} onClick={onDone}>Open editor</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
