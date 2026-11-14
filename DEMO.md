# ALE Demo — the public, try-it-in-your-browser build

The demo is a **static build of the real editor UI** running a real sample
project (Lumen, in `projects/lumen`) entirely in the visitor's browser.
There is no server: the UI's API calls are answered in-browser from a
bundled fixture, the chat replays recorded turns (labelled as replays),
and the preview pane shows Lumen's own static build.

It exists so anyone can try the editor's shape — facets, feature graph,
plans, Delivery — before installing anything. Everything that needs a
real machine (editing your files, running tests, git actions, CI and
deployment actions, provider connections) shows a plain demo notice
pointing at the local install.

## How it works

- **Detection** — one function, `isDemoMode()` in `src/ui/lib/demoMode.ts`.
  Demo mode is on when the build sets `VITE_ALE_DEMO=1` (primary — the
  demo build bakes it in, so a custom domain works), or the page is
  served from a `*.vercel.app` host or a listed demo host (backstop),
  or the URL carries `?demo=1`. Separately, if the normal UI loads and
  the editor server doesn't answer at all, it offers demo mode instead
  of a dead screen.
- **Fixture transport** — `src/ui/lib/demoTransport.ts` wraps
  `window.fetch` in demo mode and answers `/api/*` from
  `src/ui/demo/fixtureData.ts`. File edits and feature-graph edits
  mutate an in-memory copy only; nothing persists and nothing leaves
  the browser. Server-only actions refuse in plain words, in the same
  `{ ok: false, error }` shape the real server uses.
- **The fixture is generated, not hand-written** —
  `scripts/generate-demo-fixture.ts` runs the server's own derivation
  functions (features, tech stack, config inventory, design,
  architecture, criteria, delivery git/tests/CI/deploy, catalog,
  skills) against `projects/lumen`. Two documented deviations: the git
  log is scoped to the project folder, and the branch/worktree lists
  are trimmed to the current branch, so a fixture generated inside a
  working multi-branch repo reads as the project's own state.
- **Chat** — `src/ui/demo/replays.ts`: three recorded turns in the
  real `ChatStreamEvent` shapes, streamed with pacing. The edit turn
  really patches the in-memory `App.jsx` and its `done` event carries
  a verify-gate verdict, so the turn grows the real Gate verdict card.
- **Preview** — the demo build compiles Lumen standalone (its own
  Vite config minus the editor's bridge plugin, `base: './'`) into
  `dist-demo/preview/`, and the fixture config points the Preview
  pane at it.

## Refreshing the fixture

After changing the sample project or any derivation:

```sh
npm install
npm run demo:fixture
```

Run it from a checkout of `main` so the recorded git state reads as
the project's own (branch `main`, clean tree). The command accepts an
optional path to another ALE checkout to read `projects/lumen` from:
`npx tsx scripts/generate-demo-fixture.ts /path/to/checkout`.

## Deploying to Vercel (free tier)

1. Go to [vercel.com](https://vercel.com) → **Add New… → Project** →
   import **noctivagous/ai-live-web-editor**.
2. Vercel reads `vercel.json` at the repo root, which already sets:
   - **Build command:** `npm run ui:build:demo`
   - **Output directory:** `dist-demo`
   
   If you configure it by hand instead, use exactly those two values
   and no framework preset.
3. **Deploy.** The first build takes a few minutes (it installs the
   editor's dependencies and the sample project's, then builds both).

The demo is pure static output — no functions, no server — so the
free (Hobby) tier is more than sufficient.

Notes:

- **Custom domain:** fine to add. Detection does not depend on the
  hostname, because the build flag is primary; the `*.vercel.app`
  hostname rule is only a backstop for preview deployments.
- **Updating the demo:** push to the branch the Vercel project is
  connected to (or merge to `main` if it's connected to production)
  and Vercel rebuilds. Refresh the fixture first (above) if the
  sample project changed.
- `vercel.json`'s one rewrite sends non-file paths to `index.html`
  (the UI is a single-page app); files that exist — the JS/CSS
  assets and everything under `preview/` — are served as-is.

## Known limits of the demo

- Chat is three recorded replays plus an honest fallback, not a live
  agent. A bring-your-own-key live mode is a possible later step.
- Edits (files, feature graph, settings) last for the session only.
- The preview is Lumen's recorded build; it does not rebuild when you
  edit files in the demo.
- The sample project's recorded Delivery state is genuinely empty
  where it's empty — no test suites, no CI workflows, no deployment
  targets — because that's what the real server reports for it.
