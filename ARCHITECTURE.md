# ARCHITECTURE.md — AI Live Editor

## Goal

Host multiple Vite apps under this repo, edit them in a launcher UI, and drive a Mastra agent against the **active** app’s real files.

Primary origin is **http://localhost:4112**. The active app’s Vite server is **http://localhost:5173**.

## Two entry points

```
Path 1: this repo
  npm run dev  →  src/server.ts :4112
                  └── spawns Vite in projects/<active>/  :5173
  Workspace: children of projects/ (lumen, …)
  Keys: repo-root .env

Path 2: foreign Vite app
  plugins: [aiLiveEditor()]
  fsRoot = that app's config.root
  Keys: that app's .env
```

## Path 1 runtime

```
http://localhost:4112
├── src/ui-dist          Files + Monaco + Preview + Chat + Setup + project <select>
├── /api/projects        list / select / create
├── /api/fs/*            disk under getFsRoot() = projects/<active>
├── /api/config*         .env
├── /api/chat/stream     Mastra editorAgent
└── Vite child           npm run dev in the active folder (port 5173)
        └── aiLiveEditor plugin (overlays + same APIs on 5173)
```

`projects/.active` stores the selected id (gitignored). Default `lumen`.

Select kills whatever is on 5173 and starts Vite in the new folder. Create seeds `SEED_FILES`, runs `npm install`, then selects.

## Why the editor never serves the app

The split is load-bearing. :5173 is the project's own Vite — its framework, its plugins, its `npm run dev` flags, its HMR behaviour — spawned as-is. If the editor served the app itself, it would have to replicate every project's build setup (custom Vite plugins, non-Vite frameworks, HTTPS, backend sidecars), and any divergence means the user is live-editing something that is not quite their app. The invariant that falls out of it: the same `npm run dev` in a terminal gives the same app in the editor.

The covenant, in its working form: **the app is served by the project's own dev command, unmodified; the editor may observe the launch and may edit project files visibly with the user's knowledge; it never substitutes its own serving or its own launch.** Observing includes reading the project's vite.config — which is what makes the bridge guarantee below possible without breaking the covenant. (The stronger reading — the launcher may not influence the launch at all — is not required and was rejected: it is not what protects the app's fidelity.)

## The bridge guarantee

Everything live rides the plugin — page ops, source stamps, annotations, the runtime-state tools — so plugin presence is ensured, not assumed (`src/pluginEnsure.ts`, run on project open from `selectProject` / `ensureWorkspace`):

- Detection is text-level and conservative. A config that registers `aiLiveEditor()` (rename- and CJS-aware) is left alone. An editable shape that lacks it gets a marked edit — the import and the call, each wrapped in `// ai-live-editor: begin plugin` / `end plugin` blocks — verified in memory before anything is written: the result must classify as registered, and stripping the markers must reproduce the original bytes exactly.
- Shapes that can't be edited safely (function configs, spreads or computed keys, an import that is never called, a bare mention) are never guess-edited. The ensure state is `cannot`, and the Preview notice shows the exact lines to paste instead.
- Removing the marked block records a per-project opt-out in editor-owned state (`.ai-live/plugin-ensure.json`) — never in project files — and ensure never re-adds after that unless the user re-enables it.
- A folder with no `package.json` has no launch of its own to preserve: the launcher spawns its own Vite with a generated config kept in the editor's `.ai-live/`, plugin inline, and writes nothing into the folder.
- Restart after an edit goes through the project's own unmodified `npm run dev` (`startVite`); there is no wrapper config anywhere.

A "page not reachable" failure is therefore **dual-cause**: the dev server is down, *or* the plugin is absent from the config. The two were historically easy to mistake for each other, because the bridge fallback only exists when the plugin is registered. Ensure removes the second cause where it safely can, and the Preview header's bridge chip (`src/ui/lib/bridgeChip.ts`) distinguishes the rest — **Bridged / Not bridged / Plugin missing** — derived from launcher-side data only (the ensure state plus the launcher-origin `/api/page/status` count), so the failure case itself renders as "not bridged", never as an error state.

## Overlay vs launcher chat

| Surface | Where |
|---|---|
| Chat sidebar | 4112 `App.tsx` (restored) |
| Chat overlay | 5173 plugin iframe `/chat-embed` |
| Annotate | page DOM via `overlay.js` |
| File tree / Monaco | 4112 only |

Both chats POST `/api/chat/stream` on their origin. File tools use that process’s `getFsRoot()`, which is the same active app directory.

Live-page inspect / patch / eval: the plugin injects `page-bridge.js` into the Vite app. The page holds an SSE to `/api/page/stream`. Default tools hit that bridge.

Optional Playwright pool (`PLAYWRIGHT_POOL=1` or Settings): headed Chrome, lazy on first `pool-open` / `url=` inspect. Other origins only. Vite origin still uses the bridge, including `layout-snapshot` / `layout-svg`. Chrome is not started at boot.

Bridge routing, precisely: the page client (`page-bridge.js`) opens its SSE to `/api/page/stream` on **its own origin** — for an app on :5173 that registry lives in the plugin's apiApp process, not the launcher's; the launcher process's own registry only sees pages served from :4112 itself. When the launcher has no local client and is not the page owner, `pageCommand` proxies the op to `http://localhost:5173/api/page/<op>`, and the launcher's `/api/page/status` likewise relays the page server's client count server-side (503 when :5173 is unreachable). So the launcher-origin status is truthful about plugin-hosted clients, but indirectly — the bridge chip's derivation is built around that (a failed probe reads as "not bridged"). `markPageOwner()` is set by the plugin's `configureServer`, which is why the plugin process never proxies to itself.

Annotations do **not** ride the bridge — there is no annotation page op. The overlay POSTs `{annotations, pageNotes, url}` to `/api/live-edit/submit` (mounted by both `src/apiApp.ts` and `src/server.ts`), which resolves selectors to source and runs a headless `editorAgent.generate` turn. The overlay starts wherever the plugin serves a document: `chat-overlay.js` splits its bootstrap so the annotate installer runs in every frame (the floating chat window stays top-only), fetches `overlay.js` from the page's own origin first with the configured `apiBase` as fallback, and the editor's Preview drives it cross-origin by postMessage (`pick` / `unpick`), with state confirmed through the annotation digest (`src/ui/lib/annotationSync.ts`).

## File layout

```
ai-live-editor/
├── src/
│   ├── server.ts               // :4112
│   ├── launcher.ts             // workspace, getFsRoot, Vite child
│   ├── apiApp.ts               // /api used by the Vite plugin
│   ├── vite-plugin/
│   ├── mastra/
│   ├── ui/                     // React source for 4112
│   └── ui-dist/                // npm run ui:build
├── projects/
│   ├── .active                 // selected id
│   └── lumen/                  // default Vite app
├── archive/
│   ├── extension/              // Chrome side panel
│   └── browser-pool/           // Playwright second Chrome
└── package.json                // "dev": "tsx src/server.ts"
```

## Constraints

- One Vite on 5173 at a time (the active project).
- Keys are repo-wide for Path 1.
- `safePath` keeps writes under `getFsRoot()`.
- Plugin `apply: 'serve'` only.
- The editor never serves the app: the Vite child is the project's own `npm run dev`, unmodified (see "Why the editor never serves the app").
- Plugin presence is ensured on open, never assumed; ambiguous vite configs are shown the lines, never edited.
- The Playwright pool stays off unless `PLAYWRIGHT_POOL`, `LIVE_TARGET=pool`, or the Settings toggle turns it on.
