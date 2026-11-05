
# Chrome AI Code Editor - Patched with Launcher + Real FS Sync

Now has 2 modes:

### Mode 1: IDB only (no launcher) - works everywhere
- Extension saves to IndexedDB
- Patch DOM live via content script
- Export zip

### Mode 2: Real FS (launcher running) - efficient live files
- Extension talks to local server at localhost:4112
- Real files on disk at ./projects/
- Browser pool (Playwright) keeps logged-in Chrome context
- No WebContainers cost

### Quick Start

1. Launcher (from repo root — serves real FS + AI chat on :4112):
```
npm run install:all
npm run ui:build
npm run dev
```

2. Extension (from repo root):
```
npm run ext:build
# or: cd extension && npm install && npm run build
```

3. Load unpacked dist in chrome://extensions:
- Developer mode -> Load unpacked -> `extension/dist`

The side panel now shows ● REAL FS or ● IDB only badge. When REAL FS, edits go to disk instantly, AI uses real-fs tools, and you can run `npm run dev` in projects/ folder separately.

### Endpoints
- GET http://localhost:4112/api/fs/health
- GET http://localhost:4112/api/fs/list
- GET http://localhost:4112/api/fs/read?path=/App.tsx
- POST http://localhost:4112/api/fs/write {path, content}
- POST http://localhost:4112/api/browser/patch {url, selector, html}
