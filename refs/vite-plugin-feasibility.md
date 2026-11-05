# Can the AI Live Editor exist as a Vite plugin?

Verdict: yes. Vite's plugin API exposes dev-server middleware, HTML injection,
and HMR control, which covers nearly everything the launcher does. Working
projects already prove each piece independently.

## Hook mapping

| Launcher piece | Vite plugin hook | Working precedent |
|---|---|---|
| `/api/fs`, `/api/chat` endpoints | `configureServer` middleware | Standard pattern ([Vite plugin API](https://vite.dev/guide/api-plugin)) |
| Overlay auto-inject | `transformIndexHtml` | [@adophilus/dom-review](https://jsr.io/@adophilus/dom-review@1.2.0) annotates elements via an injected widget |
| `patch-dom` via `$eval` | `handleHotUpdate` / `server.ws` custom events | [LiveStyleSync](https://dev.to/artyx71/i-built-a-vite-plugin-that-writes-css-changes-back-to-your-source-files-4omp) writes edits to source, HMR updates |
| Browser pool via Playwright | Plugin runs in Node, can own Playwright | [boneyard](https://blog.openreplay.com/automatic-skeleton-screen-generation-boneyard/) scans DOM via Playwright, re-captures on HMR |
| Element-to-source mapping | Babel transform stamping `data-source-loc` | [@dev-sync/vite](https://github.com/bthe0/css-devtools-sync/blob/HEAD/README.md) reads the stamp over CDP, writes back to files |

## What ports over unchanged

- Layout capture and SVG wireframe logic ([src/layout/layoutSnapshot.ts](../src/layout/layoutSnapshot.ts))
  behind middleware endpoints instead of Express routes.
- Annotation analysis and the live-edit prompt builder
  ([src/live-edit/annotationAnalysis.ts](../src/live-edit/annotationAnalysis.ts)).
- The Mastra agent and its tools, exposed through one middleware endpoint
  instead of `POST /api/chat`.

## What changes shape

- **Scope narrows to one project.** The launcher is project-agnostic: it serves
  any `./projects/` folder and keeps one browser pool across them. A plugin
  lives inside a single Vite app (`apply: 'serve'`, dev only) — users install
  it per project instead of opening a launcher.
- **HMR replaces most `$eval` patching.** For Vite-handled files the plugin can
  push updates through HMR rather than mutating the DOM directly. Direct
  patching stays useful for plain HTML or non-HMR cases.
- **The Chrome side-panel extension stays separate either way.** As a plugin it
  would point at the Vite dev server's middleware instead of
  `http://localhost:4112`.

## Related reading

- [Vite plugin API](https://vite.dev/guide/api-plugin) — `configureServer`,
  `transformIndexHtml`, `handleHotUpdate` hooks.
- [Stop describing UI to your AI agent in words. Point at it.](https://dev.to/anton_churaev/stop-describing-ui-to-your-ai-agent-in-words-point-at-it-31o1) —
  agent "point at it" workflow with a dev-only source-location plugin plus
  CDP/Playwright driving as complement.
- [Effortless UI Context for AI Coding: Inside ViteLens](https://dev.to/mdsohail99/effortless-ui-context-for-ai-coding-inside-vitelens-for-react-vite-5ac) —
  Playwright flow recording inside a Vite dev environment.
- [vite-plugin-vue-devtools 8.x](https://devhunt.org/blog/vue-dev-tools-help-debug-your-code-faster) —
  official precedent for shipping devtools as a Vite plugin.
