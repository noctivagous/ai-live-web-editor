# AI Live Editor

A local-first AI coding host: real files on disk, a live Vite app, and a Mastra agent. The editor, setup, chat, and project switcher live at **http://localhost:4112**. The running app is on **http://localhost:5173**.

Ask: *"list the files in this project"* or *"add a counter button"* — the agent uses `grep` / ranged `read-real-file` / `str-replace` (exact unique hunk; fail closed). `write-real-file` is for new files. Vite HMR shows the change.

## Path 1 — this repo (host)

This product owns a **workspace** of apps. Each child of `projects/` is one project (its own Vite app). Switching is among those children.

```
projects/
  lumen/       ← starter app (Lumen)
  <name>/      ← apps you create from the editor
```

```bash
npm run install:all
npm run dev    # the UI is served from source (Vite HMR) — no ui:build step
```

Open [http://localhost:4112/](http://localhost:4112/). That process also starts Vite for the **active** project on port 5173.

**First run:** the setup wizard asks for an OpenAI-compatible API key, base URL, and model. Values are written to the **repo-root** `.env` and apply immediately. Reopen the wizard from Settings.

```
OPENAI_API_KEY=xai-...
OPENAI_BASE_URL=https://api.x.ai/v1
OPENAI_MODEL=grok-4.7
```

**On 4112**

- **Project** dropdown + **New project** — switch or seed a child under `projects/`. Drop an existing Vite app in as `projects/<name>/` (needs `package.json`). The list updates from the folder watcher, or pick **Refresh list** at the bottom of the dropdown.
- **Files** — tree of the active app
- **Monaco** — editor, autosave to disk
- **Preview** — static `/projects/` or Vite HMR `http://localhost:5173`
- **AI Chat** — right sidebar; tool calls stream live
- **Settings** — key, model, editor theme

**On 5173** the live app still has the plugin overlay (floating chat + annotate). Same files, same `.env`.

## Path 2 — an existing Vite app

Install this package into that app and register the plugin. The agent writes **that app’s** files. No copy into this repo.

```bash
cd /path/to/your-app
npm install -D /path/to/ai-live-web-editor
```

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { aiLiveEditor } from 'ai-live-editor'

export default defineConfig({
  plugins: [react(), aiLiveEditor()],
})
```

Put the key in **that app’s** `.env`. Start its Vite as usual. Chat and annotate appear on that page.

```js
aiLiveEditor({
  fsRoot: '/absolute/path/the-agent-may-write', // default: Vite config.root
  envFile: '/absolute/path/to/.env',            // default: <fsRoot>/.env, then parent
  apiBase: '',                                  // default: same origin
})
```

## How to use Path 1

1. `npm run dev` → open [http://localhost:4112/](http://localhost:4112/).
2. Finish the wizard (paste a key, pick a model, Save).
3. Edit files in Monaco or ask Chat to change them.
4. Use the project dropdown to switch apps. **New project** creates `projects/<name>/` (seed + `npm install`) and selects it. Vite on 5173 restarts for that folder.
5. Annotate on the live page (5173 or the preview iframe when same-origin).

## What it is

- **4112 launcher** — `src/server.ts`: UI, FS API, config, Mastra chat, project switcher, Vite child
- **Vite plugin** `aiLiveEditor` — overlays + `/api` on the app origin (`src/vite-plugin/aiLiveEditor.ts`)
- **Mastra `editorAgent`** — files (`list` / `read` / `write`) plus live-page `inspect-dom` / `patch-dom` / `eval-js` on the Vite app via a same-origin page bridge. Optional **Playwright pool** (Settings, `npm run dev:pool`, or `PLAYWRIGHT_POOL=1`) for other URLs and `layout-snapshot`.
- **Chat memory** — conversations persist server-side (Mastra Memory on a LibSQL store at `.ai-live/mastra.db`, one thread per project root, with a per-thread working set of goal / files touched / decisions / open questions). The agent recalls earlier turns even from a fresh browser; `AI_LIVE_STORAGE` moves the database file. Settings → Privacy & Data → Clear saved chat sessions clears both the device copy and the server threads.
- **OpenAI-compatible keys** — `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL`

## Commands

| Command | What it is |
|---|---|
| `npm run dev` | Launcher on 4112 (UI served from source, HMR) + Vite for the active project on 5173 |
| `npm run dev:built` | Launcher serving the built UI bundle instead (`AI_LIVE_UI=build`) |
| `npm run dev:pool` | Playwright live target (`LIVE_TARGET=pool`): no Vite page bridge. Chrome opens the app at `:5173/` plus `/pool` |
| `npm run ui:build` | Build the 4112 UI into `src/ui-dist` (verification gate / `dev:built`) |
| `npm run ui:dev` | UI hot-reload on :3000 (proxies `/api` to 4112) |
| `npm run projects:dev` | Vite for `projects/lumen` only (launcher already does this) |

Archived (not started by `npm run dev`): [`archive/extension/`](archive/extension/) (Chrome side panel), [`archive/browser-pool/`](archive/browser-pool/) (Playwright second Chrome).

## API (launcher origin, `http://localhost:4112`)

**Projects** — `GET /api/projects`, `POST /api/projects/select` `{id}`, `POST /api/projects/create` `{id}`

**Files** — `GET /api/fs/health`, `GET /api/fs/list`, `GET /api/fs/read?path=/App.jsx`, `POST /api/fs/write`

**Config** — `GET /api/config`, `POST /api/config/key`, `POST /api/config/models`

**AI** — `POST /api/chat`, `POST /api/chat/stream` (SSE), `POST /api/live-edit/submit`

**Annotate script** — `GET /live-edit/overlay.js`

## License

MIT
