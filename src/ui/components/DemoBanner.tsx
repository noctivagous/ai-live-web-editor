import { DEMO_LOCAL_NOTE, DEMO_REPO_URL, isDemoMode } from '../lib/demoMode'

/**
 * The demo banner: one line at the top of the app chrome, always
 * visible in demo mode, saying plainly what the visitor is
 * looking at and where the real editor runs. Renders nothing
 * outside demo mode.
 */
export function DemoBanner() {
  if (!isDemoMode()) return null
  return (
    <div className="demo-banner" role="note">
      <span>
        <b>Demo mode</b> — a sample project (Lumen) running entirely in your browser. Nothing here touches a real project or server.
      </span>
      <a href={DEMO_REPO_URL} target="_blank" rel="noreferrer">Install ALE locally to edit your own code →</a>
    </div>
  )
}

/**
 * The plain demo state for a surface that needs the real server:
 * one or two sentences, the shared wording, and the install
 * pointer. `what` optionally names the specific thing that is
 * unavailable, in the surface's own words.
 */
export function DemoNotice({ what }: { what?: string }) {
  return (
    <div className="demo-notice" role="note">
      <p>{what ? `${what} ` : ''}{DEMO_LOCAL_NOTE}</p>
      <p><a href={DEMO_REPO_URL} target="_blank" rel="noreferrer">Get ALE from GitHub →</a></p>
    </div>
  )
}
