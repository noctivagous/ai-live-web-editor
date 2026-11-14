/**
 * Demo mode — the single source every demo behaviour consults.
 *
 * ALE is a local-first editor backed by its own server (the
 * launcher on :4112). The public demo is a static build of this
 * same UI whose API calls are answered in the browser from a
 * bundled sample project (lib/demoTransport.ts), so anyone can
 * try the editor's shape from a static host (Vercel's free tier)
 * with no server at all.
 *
 * Demo mode is on when ANY of these hold:
 *  (a) the build was made with VITE_ALE_DEMO=1 — the demo build.
 *      Primary: it cannot be switched off by where the bundle is
 *      served from, and a normal build can never drift into demo
 *      mode by accident;
 *  (b) the page is served from a demo host — any *.vercel.app
 *      deployment, or a host listed in DEMO_HOSTS. A backstop, so
 *      even a misbuilt bundle served from Vercel degrades into
 *      the demo instead of pointing at a server that isn't there;
 *  (c) the URL carries ?demo=1 — for judging the demo locally;
 *  (d) the visitor accepted the "editor server not found" offer,
 *      which stores DEMO_FLAG_KEY in localStorage; the offer's
 *      button reloads the page into demo mode.
 */

export const DEMO_FLAG_KEY = 'ale-demo-mode'

export const DEMO_REPO_URL = 'https://github.com/noctivagous/ai-live-web-editor'

/** Hosts that always mean "this is the public demo". The
 * *.vercel.app suffix rule covers preview deployments; a custom
 * domain is carried by the build flag instead. */
export const DEMO_HOSTS = ['ale-demo.vercel.app']

/** The one demo sentence surfaces reuse, so the wording stays the
 * same everywhere: what the demo can't do, and where the real
 * thing runs. */
export const DEMO_LOCAL_NOTE =
  'Demo mode — this needs ALE running on your own machine. In the demo you can look through the sample project (Lumen), but nothing here reaches a real project or server.'

export interface DemoModeSources {
  envFlag: boolean
  hostname: string
  search: string
  storedFlag: boolean
}

/** Pure detection over explicit sources — the testable core. */
export function detectDemoMode(s: DemoModeSources): boolean {
  if (s.envFlag) return true
  if (s.storedFlag) return true
  const host = s.hostname.toLowerCase()
  if (host.endsWith('.vercel.app') || DEMO_HOSTS.includes(host)) return true
  try {
    if (new URLSearchParams(s.search).get('demo') === '1') return true
  } catch { /* a malformed query string is not a demo signal */ }
  return false
}

function liveSources(): DemoModeSources {
  let envFlag = false
  try { envFlag = (import.meta as { env?: Record<string, string> }).env?.VITE_ALE_DEMO === '1' } catch { /* non-Vite test env */ }
  let hostname = ''
  let search = ''
  try { hostname = window.location.hostname; search = window.location.search } catch { /* non-DOM env */ }
  let storedFlag = false
  try { storedFlag = localStorage.getItem(DEMO_FLAG_KEY) === '1' } catch { /* storage unavailable */ }
  return { envFlag, hostname, search, storedFlag }
}

export function isDemoMode(): boolean {
  return detectDemoMode(liveSources())
}

/** The server-absence offer's action: remember the choice and let
 * the caller reload into demo mode. */
export function enterDemoMode(): void {
  try { localStorage.setItem(DEMO_FLAG_KEY, '1') } catch { /* storage unavailable: the reload just won't be a demo */ }
}
