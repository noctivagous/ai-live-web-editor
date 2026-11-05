# TASKS.md — AI Live Editor (dogfood notes)

Gaps found using the editor at `http://localhost:4112/` as a fresh user.
Checked = done. Unchecked = placeholder or future work.

## Done

- [x] Fix startup crash: chokidar regex `/(^|[\/\])\../` never terminated (one-char fix)
- [x] Fix autosave data loss: editor loaded `// loading...` placeholder and saved it over real files
- [x] Replace `alert()` Inspect Body with in-app dialog
- [x] Adjustable split panes (file tree / editor / chat / preview dividers)
- [x] Setup wizard + deck restyle: first-run wizard (key, files, pool/preview checks) with `localStorage` skip flag; top bar with brand + status pills; `GET /api/config` presence-only endpoint
- [x] Settings panel wired: key presence via `GET /api/config` (never the key), editor theme (`vs-dark`/`light`/`hc-black`, persisted), pool URL display, replay-wizard button
- [x] Pane sizes persist: `leftW`/`rightW`/`previewH` in `localStorage` (`ai-live-editor.panes`)
- [x] Chat failure surface: missing-key Send shows guided "set your key" card with Review-setup action, not a raw dump
- [x] Preview Vite HMR button: probes `:5173` and shows an unreachable card with Retry/Static actions instead of a dead iframe

## Tasks

- [ ] **File delete / rename:** tree has only `+ New File` (native `prompt()`); need delete with confirm + rename inline.
- [ ] **Cmd+S / Ctrl+S:** keyboard save; currently save is button + autosave only.
- [ ] **Pool browser choice:** settings shows the pool URL read-only; choosing a different pool browser is still future work.
- [ ] **Inspect selector input:** Inspect Body is hardcoded to `body`; needs a selector field.
- [ ] **New File dialog:** replace native `prompt()` with an in-app input (consistent with the custom dialog).
- [ ] **Unsaved indicator:** status text covers it, but a dirty dot on the active file would read better.
