import React, { useEffect, useState } from 'react'
import { getAgentSettings, getMuseCodeAvailability, listFiles, postAgentSettings, type BraveStatus, type MuseCodeAvailability } from '../lib/api'
import { ModalityPanel, ProviderSetup, hasValidConnection, useConnections } from './ProviderSetup'
import { SearchSetup } from './SearchSetup'
import { MuseSandboxSection } from './MuseSandboxSection'
import { MuseRequirementNote } from './MuseRequirementNote'
import { MODALITY_LABELS, type Modality } from '../../providerPresets'

/**
 * First-launch setup (Muse Code design §5.1). The first real
 * choice is the AI path — Specialized (Meta Muse via Muse Code)
 * or Open (OpenCode / the ALE agent, with the user's own provider
 * keys) — before any provider is mentioned. On the Specialized
 * path the sandbox step comes immediately after the path choice;
 * provider keys, modality assignments and the existing checks
 * follow on both paths, unchanged.
 */
type StepId = 'welcome' | 'path' | 'sandbox' | 'provider' | 'models' | 'search' | 'files' | 'preview' | 'done'
type AiPath = 'specialized' | 'open'

const STEP_LABELS: Record<StepId, string> = {
  welcome: 'Welcome',
  path: 'AI path',
  sandbox: 'Permissions',
  provider: 'AI provider',
  models: 'Models by type',
  search: 'Search',
  files: 'Project files',
  preview: 'Preview',
  done: 'Done',
}

/** The step sequence for a path choice; the sandbox step exists
 * only on the Specialized path. */
function stepsFor(path: AiPath | null): StepId[] {
  const steps: StepId[] = ['welcome', 'path']
  if (path === 'specialized') steps.push('sandbox')
  steps.push('provider', 'models', 'search', 'files', 'preview', 'done')
  return steps
}

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
  const [stepIdx, setStepIdx] = useState(0)
  const [pathChoice, setPathChoice] = useState<AiPath | null>(null)
  /** The engine saved on the host, kept current as the path step
   * writes it: picking Open only writes when a saved Muse Code
   * choice has to be undone — otherwise the open-path engine
   * choice stays exactly as it was. */
  const [savedEngine, setSavedEngine] = useState<string | null>(null)
  const [availability, setAvailability] = useState<MuseCodeAvailability | null>(null)
  const [refreshingAvailability, setRefreshingAvailability] = useState(false)
  const { payload, reload } = useConnections()
  const [fsCheck, setFsCheck] = useState<Check>({ state: 'wait', detail: 'Checking…' })
  const [hmrCheck, setHmrCheck] = useState<Check>({ state: 'wait', detail: 'Checking…' })
  const [brave, setBrave] = useState<BraveStatus | null>(null)

  const valid = hasValidConnection(payload)
  const active = payload?.connections.find(c => c.id === payload.activeId)

  const steps = stepsFor(pathChoice)
  const stepId = steps[Math.min(stepIdx, steps.length - 1)]

  // A wizard replayed over a saved Muse Code choice starts with
  // the Specialized path already picked; a fresh or Open state
  // starts unchosen, so the path is a real choice either way.
  useEffect(() => {
    let live = true
    void getAgentSettings().then(s => {
      if (!live) return
      setSavedEngine(s.chatEngine)
      if (s.chatEngine === 'musecode') setPathChoice(prev => prev ?? 'specialized')
    }).catch(() => { /* host unreachable — the path step still works; the provider step will surface it */ })
    void getMuseCodeAvailability().then(a => { if (live) setAvailability(a) }).catch(() => { /* unknown — the Specialized card stays enabled, the Permissions step reports what it finds */ })
    return () => { live = false }
  }, [])

  // The requirement note's Refresh: a FRESH availability check
  // (the host's cache is bypassed), in place — when it finds the
  // binary, availability flips, the note shows satisfied, and the
  // Specialized card enables, all without leaving this step.
  const refreshAvailability = () => {
    setRefreshingAvailability(true)
    void getMuseCodeAvailability(true)
      .then(a => setAvailability(a))
      .catch(() => { /* still unknown — the note keeps its state */ })
      .finally(() => setRefreshingAvailability(false))
  }

  const choosePath = (path: AiPath) => {
    setPathChoice(path)
    if (path === 'specialized') {
      void postAgentSettings({ chatEngine: 'musecode' })
        .then(s => setSavedEngine(s.chatEngine))
        .catch(() => { /* the Permissions step's health rows show the host state */ })
    } else if (savedEngine === 'musecode') {
      void postAgentSettings({ chatEngine: 'opencode' })
        .then(s => setSavedEngine(s.chatEngine))
        .catch(() => { /* as above */ })
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
    if (stepId === 'files' && fsCheck.state === 'wait') void runFsCheck()
    if (stepId === 'preview' && hmrCheck.state === 'wait') void runHmrCheck()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId])

  const last = stepId === 'done'
  const nextDisabled = stepId === 'path' ? !pathChoice : stepId === 'provider' && !valid
  const wide = stepId === 'provider' || stepId === 'models'
  const museUnavailable = availability !== null && !availability.available

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

  const pathCheck: Check = pathChoice === 'specialized'
    ? { state: 'ok', detail: 'Specialized — Muse Code (Meta Muse). Its permissions are set in the Permissions step and in Settings → Agent & Chat.' }
    : pathChoice === 'open'
      ? { state: 'ok', detail: 'Open — OpenCode or the ALE agent, with your own provider keys.' }
      : { state: 'wait', detail: 'Not chosen — revisit the AI path step.' }

  return (
    <div className="wizard-overlay" role="dialog" aria-modal="true" aria-label="Setup wizard">
      <div className={`wizard-card ${wide ? 'wide' : ''}`}>
        <div style={{ fontSize: 'calc(17px * var(--ui-scale, 1))', fontWeight: 650 }}>Set up your editor</div>
        <div style={{ fontSize: 'calc(13px * var(--ui-scale, 1))', color: 'var(--muted)', marginTop: 4 }}>
          Step {Math.min(stepIdx, steps.length - 1) + 1} of {steps.length} — {STEP_LABELS[stepId]}
        </div>
        <div className="wizard-steps" aria-hidden="true">
          {steps.map((s, i) => <span key={s} className={i <= stepIdx ? 'done' : ''} />)}
        </div>

        {stepId === 'welcome' && (
          <div style={{ fontSize: 'calc(13.5px * var(--ui-scale, 1))', lineHeight: 1.65, color: 'var(--text)' }}>
            <p style={{ margin: '0 0 10px' }}>
              This editor lets an AI agent write and change the files in your
              project while you watch the result update live. Setup starts
              with one choice — how that agent runs — and everything after
              it follows from there.
            </p>
            <div className="check-row ok"><span className="mark">1</span><div>Choose your AI path<small>Specialized runs Meta’s Muse Code, a ready-made coding agent you sign in to. Open runs OpenCode or the editor’s built-in agent with API keys from providers you choose.</small></div></div>
            <div className="check-row ok"><span className="mark">2</span><div>Permissions come next on the Specialized path<small>Muse Code runs inside a sandbox on this machine. If you choose it, the next step sets what it may do — including trusting this project — and you can revisit it any time in Settings.</small></div></div>
            <div className="check-row ok"><span className="mark">3</span><div>Your keys stay on this machine<small>Any keys you add later are stored locally and only ever sent to the provider you picked. Settings shows these same screens, so anything set here can be changed there.</small></div></div>
          </div>
        )}

        {stepId === 'path' && (
          <div>
            <p style={{ fontSize: 'calc(13.5px * var(--ui-scale, 1))', lineHeight: 1.6, color: 'var(--text)', margin: '0 0 12px' }}>
              How should the AI agent that edits your project run? You can switch
              later in Settings → Agent &amp; Chat — switching to Muse Code brings
              back its permissions step there.
            </p>
            <div role="radiogroup" aria-label="AI path">
              <button
                type="button" role="radio" aria-checked={pathChoice === 'specialized'}
                className={`path-card${pathChoice === 'specialized' ? ' on' : ''}`}
                disabled={museUnavailable}
                onClick={() => choosePath('specialized')}
              >
                <span className="dot" />
                <span>
                  Specialized — Muse Code
                  <small>
                    Meta’s ready-made coding agent (Meta Muse), signed in with your Muse
                    account. It brings its own tools and sandbox; the editor adds its live
                    preview, tools and checks. Its permissions are set in the next step.
                    {museUnavailable && ' Not available on this machine — Muse Code isn’t installed here.'}
                  </small>
                </span>
              </button>
              <button
                type="button" role="radio" aria-checked={pathChoice === 'open'}
                className={`path-card${pathChoice === 'open' ? ' on' : ''}`}
                onClick={() => choosePath('open')}
              >
                <span className="dot" />
                <span>
                  Open — your provider keys
                  <small>
                    Chats run on OpenCode or the editor’s built-in ALE agent, using API keys
                    you bring from providers like OpenAI, Meta, Anthropic or OpenRouter. The
                    AI provider step, next, takes your first key.
                  </small>
                </span>
              </button>
            </div>
            {availability !== null && (
              <div style={{ marginTop: 12 }}>
                <MuseRequirementNote availability={availability} onRefresh={refreshAvailability} refreshing={refreshingAvailability} />
              </div>
            )}
          </div>
        )}

        {stepId === 'sandbox' && (
          <MuseSandboxSection />
        )}

        {stepId === 'provider' && (
          <ProviderSetup payload={payload} reload={reload} />
        )}

        {stepId === 'models' && (
          <div>
            <p style={{ fontSize: 'calc(13.5px * var(--ui-scale, 1))', lineHeight: 1.6, color: 'var(--text)', margin: '0 0 12px' }}>
              Choose which model to use for each kind of work. Only models your
              keys actually unlocked are listed.
            </p>
            <ModalityPanel payload={payload} reload={reload} />
          </div>
        )}

        {stepId === 'search' && (
          <div>
            <p style={{ fontSize: 'calc(13.5px * var(--ui-scale, 1))', lineHeight: 1.6, color: 'var(--text)', margin: '0 0 12px' }}>
              Optional: web search for the agent. If your provider's card
              shows a Web search chip, it already searches on its own —
              choose that source in the chat header and skip this step.
              Otherwise a Brave key gives the agent search and research
              briefs. You can add it later — it is the same card in
              Settings, under Search.
            </p>
            <SearchSetup onStatus={setBrave} />
          </div>
        )}

        {stepId === 'files' && (
          <div>
            <CheckRow check={fsCheck} title="Project files" />
            <button className="deck-btn" onClick={() => void runFsCheck()}>Recheck</button>
          </div>
        )}

        {stepId === 'preview' && (
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

        {stepId === 'done' && (
          <div style={{ fontSize: 'calc(13.5px * var(--ui-scale, 1))', lineHeight: 1.65 }}>
            <CheckRow check={pathCheck} title="AI path" />
            <CheckRow check={providerCheck} title="AI provider" />
            <CheckRow
              check={brave?.configured
                ? { state: 'ok', detail: 'Brave key saved — web search and research are on.' }
                : { state: 'wait', detail: 'Not set — optional. Add it any time in Settings, under Search.' }}
              title="Search"
            />
            <CheckRow check={fsCheck.state === 'wait' ? { state: 'wait', detail: 'Not checked — revisit the Project files step.' } : fsCheck} title="Project files" />
            <CheckRow check={hmrCheck.state === 'wait' ? { state: 'wait', detail: 'Not checked — revisit the Preview step.' } : hmrCheck} title="Preview" />
            <p style={{ color: 'var(--muted)', fontSize: 'calc(12.5px * var(--ui-scale, 1))' }}>
              Ask the agent to edit or generate files from the chat panel. Providers
              and models can be changed any time in Settings.
            </p>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          {stepIdx > 0 && (
            <button className="deck-btn" onClick={() => setStepIdx(s => s - 1)}>Back</button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {!last && (
              <button className="deck-btn primary" disabled={nextDisabled} onClick={() => setStepIdx(s => s + 1)}>Next</button>
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
