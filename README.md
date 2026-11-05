# AI Live Editor

**A local-first, AI-driven code editor that edits real files and patches a live browser in milliseconds — no WebContainers, no screenshot loops.**

You ask the AI: *"make this a todo app"* → it writes `projects/App.jsx` to disk → patches the live browser via `page.$eval` → you see it.

### Benefits

The AI doesn't guess if its change worked or wait on a screenshot round-trip — it patches the live DOM node and reads back `el.getBoundingClientRect()` plus a layout snapshot in the same run.

An improvement over a conventional web IDE because the agent drives a live browser pool. "Make a landing page's hero section" and the agent can inspect the DOM, edit your local files on disk (launcher UI, via Playwright) or work offline against IndexedDB (extension side panel without the launcher), and inject a preview live.


### What it is

- A **local Node server** (`localhost:4112`) that owns your project files on disk at `./projects/` (seeded on first run, never overwritten)
- A **Monaco editor** UI at `http://localhost:4112` with file tree, AI chat, and live preview (React + Vite source in `src/ui/`, built to `src/ui-dist/`)
- A **persistent Chrome pool** (Playwright `launchPersistentContext`) that keeps logins/cookies in `./projects/.chrome-data`
- A **Mastra AI agent** (`editorAgent`) with tools to read/write real files and patch the live DOM instantly
- An **optional Chrome side-panel extension** (`extension/`) — same launcher backend, patches the tab you're looking at

### Quick Start

```bash
# 1. Install everything (launcher + extension + user project)
npm run install:all
# Browser: uses your Chrome for Testing if found (override: CHROME_FOR_TESTING_PATH) —
# macOS checks /Applications, Windows/Linux check standard locations, else set the env var.
# No Testing binary? The pool falls back to Playwright's bundled Chromium;
# run `npm run install:browser` to install it explicitly.

# 2. Build the UI once (React + Monaco, served from src/ui-dist)
npm run ui:build

# 3. Start the launcher (FS API + Browser Pool + Monaco UI + Mastra)
npm run dev
# -> Open http://localhost:4112

# 4. (Optional) Start Vite HMR for the user project in another terminal
npm run projects:dev
# -> Open http://localhost:5173 for hot reload

# 5. (Optional) Make changes on the UI itself with hot reload
npm run ui:dev
# -> Open http://localhost:3000 (proxies /api + /projects to :4112)

### Option B — Chrome side panel (instead of the web UI)

Same launcher, different frontend: the extension runs the editor in Chrome's
side panel and patches the tab you're looking at via a content script.

```bash
npm run ext:build        # builds extension/dist
# chrome://extensions -> Developer mode -> Load unpacked -> extension/dist
```

- Needs the launcher running (`npm run dev`) for real FS + AI chat.
- Without it, the panel works offline with IndexedDB (● IDB badge).
- Note: `npm run ext:dev` uses port 5173 — don't run it together with `npm run projects:dev`.
```

First run seeds (missing files only — your edits are never overwritten):

```
./projects/
  index.html
  App.jsx
  main.jsx
  package.json    <- `npm run projects:dev` for Vite HMR on :5173
  vite.config.js
  .chrome-data/   <- your persistent Chrome profile (logins persist)
```

### How to use

1. **Edit files:** Click a file in left tree → Monaco opens → edit → autosaves after 800ms to real disk via `POST /api/fs/write`
2. **Live preview:** Bottom iframe shows `/projects/` static. Click **"Patch Live"** to push the current HTML file instantly to the browser pool (no reload for HTML, Vite HMR on `:5173` for JSX).
3. **AI edit:** Type in right chat: *"Add a counter button that increments"*
   - Agent calls `list-real-files` → `read-real-file` → `write-real-file` → `patch-dom`
   - You see the file change and the live DOM patch result (rect + elapsedMs)
4. **Annotate on the page (no chat needed):** In the Preview toolbar click **Annotate** (Static preview) → click page elements → add notes (right-click also enters picker, Esc exits) → **Submit notes**
   - Notes + page notes go to `POST /api/live-edit/submit` → the agent edits files, patches the DOM, verifies with `layout-snapshot` → preview reloads
5. **Open in real browser:** Click **"Browser Pool"** — focuses the pool's Chrome window with your `.chrome-data` profile, so if you're logged into Stripe/Linear/your app, the AI sees the logged-in DOM.

### Architecture

```
┌─────────────────────────────────────────┐
│  http://localhost:4112 (src/server.ts)  │
│  ├── Monaco UI (src/ui/ → src/ui-dist) │
│  ├── /api/fs/* (real disk)              │
│  ├── /api/browser/* (Playwright pool)   │
│  └── /api/chat (Mastra editorAgent)     │
└─────────────────────────────────────────┘
         │                 │
         ▼                 ▼
   ./projects/      ./projects/.chrome-data
   (real files)    (persistent Chrome)
```

- `src/launcher.ts` — ensures `./projects` exists, seeds starter files when missing
- `src/browserPool.ts` — `getBrowser()`, `patchDOM()`, `inspectDOM()`, `evalJS()` — all use `page.$eval`, not screenshots
- `src/mastra/tools/realFsTools.ts` — Mastra tools: `list-real-files`, `read-real-file`, `write-real-file`, `patch-dom`, `inspect-dom`, `eval-js`
- `src/mastra/tools/layoutTools.ts` — Mastra tools: `layout-snapshot`, `layout-svg` (rectangle analysis + SVG wireframe, no screenshots)
- `src/mastra/tools/liveEditTools.ts` — Mastra tools: `get-page-annotations`, `peek-page-annotations`, `import-page-annotations`, `set-annotate-baseline`
- `src/live-edit/overlay.js` — annotate-on-the-page overlay (ported from the MCP live-editing overlay; `window.__AI_LIVE_EDIT__`)
- `src/live-edit/annotationOverlay.ts` — loads/injects the overlay, import/export/clear helpers for the pool page
- `src/live-edit/annotationAnalysis.ts` — intent classifier + style-hint parser + live-edit prompt builder
- `src/layout/layoutSnapshot.ts` — vendored layout capture/SVG core (Playwright CDP adapter lives in `browserPool.ts`)
- `src/mastra/agents/editorAgent.ts` — the AI brain, prompt says: prefer real FS tools, patch live DOM for instant verification
- `src/ui/` — React + Monaco UI source, built with `npm run ui:build` to `src/ui-dist/` (served by `server.ts`; `npm run ui:dev` runs it on `:3000`)

### API

All endpoints on `http://localhost:4112`:

**File System (real disk)**
- `GET /api/fs/health` — check root
- `GET /api/fs/list` — list all files
- `GET /api/fs/read?path=/App.jsx`
- `POST /api/fs/write` — `{path, content}` → writes via `fs.writeFileSync`

**Browser Pool (live DOM, no screenshots)**
- `POST /api/browser/open` — `{url}` — open URL in persistent Chrome
- `POST /api/browser/patch` — `{selector, html, url?}` → returns `{rect, elapsedMs}` (typically milliseconds)
- `POST /api/browser/inspect` — `{selector}` → returns `{tag, html, text, rect}`
- `POST /api/browser/eval` — `{code}` → runs JS in live page

**Layout analysis (rectangles, no screenshots)**
- `POST /api/layout/snapshot` — `{selectors?, scopeSelector?, maxTotal?, computedStylePreset?, coordinateSpace?, includeOverlapAnalysis?, includeGapAnalysis?, includeClippingAnalysis?, url?}` → element rects + layout styles + overlap/gap/clipping analysis
- `POST /api/layout/svg` — same snapshot params + `{scale?, showLabels?, showDimensions?, showOverlaps?, showGaps?, showClipping?}` → `{svg, elementCount, viewport}` wireframe

**AI**
- `POST /api/chat` — `{messages}` → calls Mastra agent with real FS + browser tools
- `POST /api/live-edit/submit` — `{annotations:[{selector,text,type?,targetSelector?}], pageNotes?, url?}` → imports notes into the pool page, runs the agent (edit files → patch DOM → layout-snapshot verify), returns `{text, annotationCount, before, after}`
- `GET /live-edit/overlay.js` — the annotate-on-the-page overlay script (injected into the preview iframe / extension pages)

### Efficient Live Edit Loop (vs MCP)

**Old MCP loop (slow):**
```
AI writes file → build → reload → page snapshot + screenshot encode → AI parses image → repeat
```

**This launcher (fast):**
```
AI calls write-real-file (disk) → patch-dom via page.$eval → returns rect + elapsedMs → done
```

### Annotation live edit + layout tools (goals)

**Goal: point at the page instead of describing it.** Clicking an element and typing "more padding here" beats pasting selectors into chat. The overlay (`window.__AI_LIVE_EDIT__` in [overlay.js](/Users/jpratt/Developer/ai-live-web-editor/src/live-edit/overlay.js)) collects per-element annotations plus page-level notes, and the submit endpoint turns them into one agent run: edit files → patch the live DOM → verify with `layout-snapshot`.

**Goal: prioritize before acting.** [annotationAnalysis.ts](/Users/jpratt/Developer/ai-live-web-editor/src/live-edit/annotationAnalysis.ts) classifies each note by intent (`bug`, `move`, `layout`, `style`, `copy`, `note`), orders work bugs-first, extracts `move` source→target links, and parses numeric style hints ("gap 24" → `24px`) for the agent to verify before applying.

**Goal: never regress the page silently.** Every submit captures `layout-snapshot` before and after, and the agent prompt requires a post-edit snapshot to check overlap/clipping regressions. A baseline wireframe can also be stashed on the page (`set-annotate-baseline`) for before/after diffing.

**Goal: rectangles, not screenshots.** [layoutSnapshot.ts](/Users/jpratt/Developer/ai-live-web-editor/src/layout/layoutSnapshot.ts) captures element rects, layout styles, and overlap/gap/clipping analysis via CDP `DOMSnapshot` (with a `page.evaluate` rect-walk fallback), so the agent reasons about geometry as data. `layout-svg` renders the same snapshot as an SVG wireframe with labels and overlap/gap/clipping overlays — a visual the agent and the user can read without any screenshot encode step.

One limit: in the web UI, Annotate works in Static preview only — Vite HMR (`:5173`) is cross-origin and can't be injected. The extension has no such limit since its content script runs in the active tab.

### Customizing

- **Add Monaco themes/languages:** Edit `src/ui/components/MonacoEditor.tsx` (`getLang` + `<Editor>` options), then `npm run ui:build` (the editor theme itself is switchable in Settings, no rebuild needed)
- **Add more AI tools:** Edit `src/mastra/tools/realFsTools.ts` and add to `editorAgent` in `src/mastra/agents/editorAgent.ts`
- **Change project:** Edit anything in `./projects/` — it's your real app (React + Vite starter; `npm run projects:dev` for HMR)

### Environment

Create `.env` in root (optional), or paste values in the first-run setup wizard:

```
OPENAI_API_KEY=sk-...
# Optional: any OpenAI-compatible provider
# OPENAI_BASE_URL=https://api.openai.com/v1
# OPENAI_MODEL=gpt-4o-mini
```

### Browser extension (optional)

The core works without any extension. If you want the editor in your main Chrome's side panel (e.g. to use your main profile's logged-in SaaS cookies), build `extension/` and load it unpacked — it's a thin client over the same `http://localhost:4112/api/*` backend. Without the launcher it runs offline against IndexedDB (● IDB badge).

### License

MIT — use it as a template for your own AI editor.
