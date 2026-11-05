# Archive

Code that is no longer part of the main product.

## `extension/`

Chrome side-panel editor (CRXJS / Vite 5). It talked to the old Express launcher at `http://localhost:4112` and could patch any tab via a content script, with an IndexedDB fallback.

The current product is a Vite plugin: chat and annotate live on the app you are developing. This extension is unused in that loop.

To load it anyway: `cd archive/extension && npm install && npm run build`, then Load unpacked `archive/extension/dist`. You also need `npm run launcher` from the repo root so `:4112` is up.

## `browser-pool/`

Playwright persistent Chrome (Chrome for Testing) that opened `http://localhost:4112/pool` on launcher boot. The agent used it for `patch-dom`, `inspect-dom`, `eval-js`, `layout-snapshot`, and annotation import into a second window, with logins in `projects/<app>/.chrome-data`.

The live product now has this as an **optional** feature in `src/` (Settings → Playwright pool, or `PLAYWRIGHT_POOL=1`). Off by default, lazy Chrome. Copies here are the snapshot from when it was removed.

Default live-page inspect/patch/eval is the Vite page bridge. The pool is the other-origin / CDP layout target.
