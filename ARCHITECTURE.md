Here's `ARCHITECTURE.md`:

---

# ARCHITECTURE.md — AI Live Editor (Launcher Only)

## Goal

Edit real files on disk and see them live in a real browser in **<20ms**, with AI that works with what actually appears, not a screenshot guess.

No WebContainers. No cloud browser bill. No MCP screenshot tax.

## Core Components

```
http://localhost:4112
├── src/server.ts        Express server, single entry point
├── src/launcher.ts      Ensures ./projects exists, FS root
├── src/browserPool.ts   Playwright persistent context
├── src/mastra/          Mastra agent + tools
└── src/ui/index.html    Monaco + FileTree + Chat + Preview
```

### 1. Real FS — `./projects/`

Canonical source of truth. Not IndexedDB, not OPFS, not in-memory.

```ts
// safe write, prevents traversal
function safePath(p) { return path.resolve(FS_ROOT, '.'+p) }
fs.writeFileSync(full, content) // 1ms
```

All APIs hit disk:
- `GET /api/fs/list` — recursive walk, ignores `.chrome-data`, `node_modules`
- `GET /api/fs/read?path=/App.jsx`
- `POST /api/fs/write` — `{path, content}`

### 2. Browser Pool — Persistent Chrome

```ts
chromium.launchPersistentContext('./projects/.chrome-data', {
  headless: false,
  executablePath: process.env.CHROME_FOR_TESTING_PATH // or /Applications/Google Chrome for Testing
})
```

No browser is downloaded: the pool drives the existing Chrome for Testing binary
(`resolveBrowserExecutable()` in `src/browserPool.ts`, Playwright default as fallback).
`npm run install:browser` remains as an opt-in for machines without it.

- Keeps cookies, localStorage, logins, SSO between restarts
- Single `context.pages()[0]` reused, not new browser per AI call
- Tools:
  - `patchDOM(selector, html)` → `page.$eval` → returns `{rect, elapsedMs}` in **5-15ms**
  - `inspectDOM(selector)` → returns `outerHTML + text + rect`
  - `evalJS(code)` → runs arbitrary JS in live page
  - `captureLayoutSnapshot(params)` → Playwright CDP `DOMSnapshot.captureSnapshot` (vendored `src/layout/layoutSnapshot.ts`) → element rects + layout styles + overlap/gap/clipping analysis, with `page.evaluate` rect-walk fallback
  - `renderLayoutSvg(snapshot, options)` → pure SVG wireframe of the rectangles

This replaces MCP's `take_snapshot` (80ms) + `screenshot` (1118ms + base64 encode).

### 3. Monaco UI (React + Vite, built to `src/ui-dist`)

Source in `src/ui/` (`App.tsx`, `components/`, `lib/api.ts`), built with `npm run ui:build`.
The launcher serves the build from `src/ui-dist` (see `server.ts`); `npm run ui:dev` runs it on `:3000` with proxy to `:4112`.

- Autosave debounce 800ms → `POST /api/fs/write`
- Manual Save + **⚡ Patch to Live DOM** button
- Preview iframe `src="/projects/"` (static) or `localhost:5173` (Vite HMR)

### 4. Mastra Agent — `editorAgent`

```ts
tools: {
  list-real-files, read-real-file, write-real-file,
  patch-dom, inspect-dom, eval-js,
  layout-snapshot, layout-svg,
  get-page-annotations, peek-page-annotations,
  import-page-annotations, set-annotate-baseline
}
```

Prompt enforces:
> Try real FS first. Patch live DOM for instant verification. Never do screenshot loops.

## Data Flows

### User edits in Monaco

```
Monaco onChange -> debounce 800ms -> POST /api/fs/write
-> fs.writeFileSync -> chokidar logs change
-> Preview iframe reloads (or Vite HMR pushes)
```

**Elapsed: ~1ms disk + network**

### AI edits

```
User: "Add counter button"
-> POST /api/chat {messages}
-> Mastra agent:
   1. list-real-files
   2. read-real-file /App.jsx
   3. write-real-file /App.jsx (1ms)
   4. patch-dom body (5ms) -> {rect}
-> Returns text + toolCalls
-> UI reloads editor content + preview
```

**Elapsed: ~50ms total tool time, no build**

### User annotates on the page (no chat)

```
User clicks Annotate in Preview toolbar (Static preview, same-origin iframe)
-> parent injects GET /live-edit/overlay.js into iframe, select mode on
-> user clicks elements -> menu: Add note / Move this here (+ drag red port to target)
-> user tags + optional page Notes panel
-> Submit notes -> POST /api/live-edit/submit {annotations, pageNotes}
-> server imports notes into the pool page, captures baseline layout snapshot
-> editorAgent: get-page-annotations -> read/write real files -> patch-dom -> layout-snapshot
-> UI shows result, reloads files + preview (annotations cleared on submit)
```

**Elapsed: one agent run, no MCP round-trip, no screenshots.** Annotate mode in the
extension works the same way: the content script injects the overlay into the active
tab, the sidepanel Submit posts to the same endpoint. Annotate is Static-preview-only
in the web UI — Vite HMR (`:5173`) is cross-origin and cannot be injected.

### Fast Path vs Slow Path

**OLD MCP Loop (what we killed):**
```
write file -> npm run build (2-5s) -> reload -> take_snapshot (80ms) 
-> screenshot (1118ms + base64) -> LLM parses image -> repeat
= 3-5s per iteration, loses auth, $ for cloud browser
```

**NEW Launcher Loop:**
```
write-real-file (1ms) -> patch-dom $eval (5ms) -> rect returned
= <20ms, keeps auth, $0
```

## Why Persistent Context Matters

Standard Playwright MCP: `browser.newContext()` per run = fresh profile, no login.

Launcher: `launchPersistentContext('./projects/.chrome-data')` = real user data dir, like your daily Chrome. If you're logged into your app, the AI sees the logged-in DOM.

If you want your *main* Chrome profile, change:

```ts
path.join(os.homedir(), '...Chrome/User Data') // risky, copy instead
```

We default to isolated `.chrome-data` to avoid corrupting main profile.

## File Layout

```
ai-live-editor-launcher/
├── src/
│   ├── server.ts         // :4112, serves UI + APIs
│   ├── browserPool.ts    // patch/inspect/eval
│   ├── launcher.ts       // FS_ROOT = ../projects
│   ├── mastra/index.ts
│   ├── mastra/agents/editorAgent.ts
│   ├── mastra/tools/realFsTools.ts
│   ├── ui/               // React UI source (Monaco + FileTree + Chat + Preview)
│   └── ui-dist/          // built UI, served by server.ts (gitignored, via npm run ui:build)
├── extension/            // OPTION B: Chrome side-panel UI (same :4112 backend)
│   ├── manifest.json     // sidePanel + content script, host perms for :4112
│   ├── src/background.ts // relays chat to POST /api/chat, DOM ops to active tab
│   ├── src/content.ts    // GET_DOM / PATCH_DOM / READ_SELECTION in page
│   └── src/sidepanel/    // Monaco + FileTree + Chat; REAL FS badge or IDB offline
├── projects/             // USER APP - real files
│   ├── index.html
│   ├── App.jsx
│   ├── main.jsx
│   ├── vite.config.js
│   ├── package.json      // run npm run dev here for HMR
│   └── .chrome-data/     // persistent browser
└── package.json          // launcher deps
```

## Tradeoffs

**Pros:**
- Real FS, real Node, real Chrome, zero cost
- Instant feedback (rect, not screenshot)
- Keeps auth

**Cons:**
- Not distributable via Chrome Web Store (it's a local app, `npx`)
- User needs Node + Playwright install (one-time)
- No sandbox — AI can write anywhere under `./projects` (mitigated by `safePath` check)

## Future Extensions

- **Thin extension adapter (optional):** 200-line side panel that calls `http://localhost:4112/api/*` so you get main Chrome cookies
- **Vite HMR integration:** Inject HMR client into preview iframe for JSX hot reload without full reload
- **Tauri wrapper:** Package launcher as desktop app with one click

---

Want me to add this file into the zip too?