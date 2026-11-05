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
