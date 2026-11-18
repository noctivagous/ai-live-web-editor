import { useEffect, useState } from 'react'
import { getFeatures } from '../lib/api'
import { WIZARDS, type WizardDef } from '../lib/wizards'
import {
  DEMO_REPO_URL, DEMO_WELCOME_OPEN_EVENT, demoWelcomeSeen, isDemoMode, markDemoWelcomeSeen,
} from '../lib/demoMode'

/**
 * The demo Welcome: the demo's front door. The installed editor
 * fronts itself with the SetupWizard; the demo skips setup, so a
 * first-time visitor would otherwise land in the Workbench with
 * nothing but the banner line. This is the introduction the
 * banner can't be — what ALE is, how it works, that Muse
 * Code is the default engine, the two layouts, the wizards and
 * their state, and what the demo can't do — ending in actions
 * that take the visitor to a surface, not just a dismiss.
 *
 * Demo mode only, shown once per browser (a localStorage flag),
 * and re-openable any time through the open event (the Help menu
 * and the demo banner dispatch it). The wizard names and their
 * ready/planned state come from the wizards registry itself, and
 * the sample project's build state from its own feature graph,
 * so the introduction cannot drift from the product it describes.
 */

/** Planned wizards worth naming to a visitor, in the order to
 * name them — filtered against the registry at render time, so
 * one that ships drops off this list on its own. */
const PLANNED_PICKS = ['new-project', 'import-graphic-design', 'add-package', 'make-responsive', 'restyle-app']

export function DemoWelcome({ projectName }: { projectName: string }) {
  const demo = isDemoMode()
  const [open, setOpen] = useState(() => demo && !demoWelcomeSeen())
  const [builtPct, setBuiltPct] = useState<number | null>(null)

  useEffect(() => {
    if (!demo) return
    const onOpen = () => setOpen(true)
    window.addEventListener(DEMO_WELCOME_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(DEMO_WELCOME_OPEN_EVENT, onOpen)
  }, [demo])

  useEffect(() => {
    if (!open) return
    let live = true
    void getFeatures()
      .then(r => { if (live && r.rollup) setBuiltPct(r.rollup.overall.pct) })
      .catch(() => { /* the sentence simply omits the figure */ })
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => { live = false; window.removeEventListener('keydown', onKey) }
  }, [open ])

  if (!demo || !open) return null

  function close() {
    markDemoWelcomeSeen()
    setOpen(false)
  }

  function go(hash: string) {
    close()
    window.location.hash = hash
  }

  function browseWizards() {
    close()
    window.dispatchEvent(new CustomEvent('ai-live:open-wizards'))
  }

  const ready = WIZARDS.filter(w => w.status === 'ready')
  const planned = WIZARDS.filter(w => w.status !== 'ready')
  const plannedPicks = PLANNED_PICKS
    .map(id => planned.find(w => w.id === id))
    .filter((w): w is WizardDef => Boolean(w))
  const plannedRest = planned.length - plannedPicks.length

  return (
    <div className="demo-welcome-overlay">
      <div className="demo-welcome" role="dialog" aria-modal="true" aria-label="Welcome to AI Live Editor">
        <div className="dw-head">
          <div>
            <b>Welcome to AI Live Editor</b>
            <span>A one-minute introduction to what you're looking at. You can reopen it any time from the Help menu.</span>
          </div>
          <button type="button" className="wiz-btn" onClick={close} aria-label="Close the welcome">✕</button>
        </div>

        <div className="dw-grid">
          <section className="dw-sec">
            <h3>What you're looking at</h3>
            <p>AI Live Editor (ALE) is an editor where an AI agent writes and changes a project's code while you watch the result update live. This demo is a sample project — {projectName} — running entirely in your browser, so you can see the editor's shape without installing anything.</p>
          </section>

          <section className="dw-sec">
            <h3>The engine</h3>
            <p>By default the agent is <b>Muse Code</b> — Meta's coding agent, signed in with your Muse account. In the installed editor you can switch engines in Settings → Agent &amp; Chat: Muse Code, OpenCode, or the editor's built-in agent with your own provider keys. In this demo no agent actually runs — the screens and the data are real, the agent is not.</p>
          </section>

          <section className="dw-sec">
            <h3>Two layouts: Workbench and Facets</h3>
            <p>The <b>Workbench</b> is where work happens: files, the live preview, and chat with the agent. The <b>Facets</b> are the same project seen as control surfaces — Features, Architecture, Graphic Design, Tech Stack, Configuration, Delivery — so you can pick from lists and guided flows instead of composing every instruction in chat.</p>
            <div className="dw-actions">
              <button type="button" className="wiz-btn" onClick={() => go('#/facets/features')}>See the Facets</button>
              <button type="button" className="wiz-btn" onClick={() => go('#/workbench')}>See the Workbench</button>
            </div>
          </section>

          <section className="dw-sec">
            <h3>Wizards</h3>
            <p>Wizards are guided flows that brief the agent for you. {ready.length > 0
              ? <><b>{ready.map(w => w.title).join(', ')}</b> works today, at two depths: add on the spot, or answer a few questions and approve a written plan first. </>
              : ''}The rest are planned{plannedPicks.length > 0
              ? <> — {plannedPicks.map(w => w.title).join(', ')}{plannedRest > 0 ? `, and ${plannedRest} more` : ''} — </>
              : ''}and the Wizards menu shows each one marked with its state.</p>
            <div className="dw-actions">
              <button type="button" className="wiz-btn" onClick={browseWizards}>Browse the wizards</button>
            </div>
          </section>

          <section className="dw-sec">
            <h3>The sample project</h3>
            <p>{projectName} is a real project record, not screenshots: its feature graph{builtPct !== null ? <> is <b>{builtPct}% built</b></> : ''}, and its design guide, packages, configuration and delivery state are genuine data, shown by the same screens the installed editor uses. Nothing you click here changes anything outside this tab.</p>
            <div className="dw-actions">
              <button type="button" className="wiz-btn" onClick={() => go('#/facets/overview')}>Open the project Overview</button>
            </div>
          </section>

          <section className="dw-sec">
            <h3>What the demo can't do</h3>
            <p>The demo can't edit real code, run the agent, or reach a server. To work on your own projects, install ALE locally — it runs on your machine, with your projects on your disk.</p>
            <div className="dw-actions">
              <a className="wiz-btn dw-link" href={DEMO_REPO_URL} target="_blank" rel="noreferrer">Get ALE from GitHub →</a>
            </div>
          </section>
        </div>

        <div className="dw-foot">
          <button type="button" className="wiz-btn primary" onClick={close}>Start exploring</button>
        </div>
      </div>
    </div>
  )
}
