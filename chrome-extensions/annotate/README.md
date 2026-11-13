# ALE Annotate — standalone annotation extension

A separate Chrome extension that extracts ALE's page-annotation capability
from the editor's server pipeline. Its **only job**: annotate a page, then
copy the result as clean text you can paste into a Muse Code chat — or any
app or text field.

No ALE server, no build step, no network calls, no telemetry, no external
dependencies. Plain JavaScript.

## Load it

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this directory (`chrome-extensions/annotate/`)
3. Open any http(s) page, click the **ALE Annotate** toolbar button
   (or press **Alt+Shift+A**)

## Use it

- **Annotate mode on:** hovering highlights elements and shows the selector
  that will identify them. Clicking an element pins a numbered annotation
  and opens a small note editor by it. `Ctrl+Enter` saves, `Esc` cancels;
  saving an empty note discards the pin.
- **Selecting text** (drag or double-click, while picking is on) pins a
  *text annotation* instead: the payload carries the exact quote, ~40
  characters of surrounding context, and the containing element's selector.
  An amber box marks the selected range on the page.
- **Screenshots:** turn **Screenshots: on** in the panel to capture a
  cropped screenshot automatically for each new pin, or use **Attach
  screenshot** in the note editor for a single annotation. The crop is of
  the visible element only (the extension hides its own UI for the shot).
  A screenshot is a *separate image*: the payload notes its size, and the
  panel/editor offer **Save image** (download the crop) and **Copy image**
  (put the crop itself on the clipboard) so it can travel with the pasted
  text into a chat.
- **Panel** (bottom-right): the numbered list of annotations — click an
  item to scroll its target into view and edit the note, `×` removes it,
  plus an optional whole-page note. **Picking: paused** lets you use the
  page normally without leaving annotate mode. **Clear all** deletes this
  page's annotations and page note.
- **Copy:** composes everything (format below) onto the clipboard.
- **Exit** or `Esc` leaves annotate mode. Annotations persist per page URL
  in the extension's own storage (`chrome.storage.local`), across browser
  sessions, until you clear them — they are never written into the page.
  Slice 1's per-session records are adopted and migrated automatically.

## The clipboard format

This format is the product. It is designed for an AI chat to act on: a
human-readable header, then one block per annotation whose **selector is
the primary locator**, backed up by the visible text and page position so
a repeated component can still be told apart.

```
Annotations for: Checkout — Example Store
URL: https://example.com/checkout
Viewport: 1440 × 900

Page note:
  Overall the page feels cramped on the right side.

1) Element: button#pay-now.primary — "Pay now"
   Selector: #pay-now
   Position: page (812, 340), 180 × 44 px
   Note:
   This wraps onto two lines at 1280px wide. Keep it on one line.

2) Element: div.summary-row — "Total $42.00"
   Selector: main > section.checkout > div.summary-row:nth-of-type(3)
   Role: row
   Screenshot: 432 × 36 px crop (a separate image — Save image / Copy image in the Annotate panel)
   Position: page (640, 512), 420 × 24 px
   Note:
   The total should be bold — right now it reads like another line item.

3) Selected text in p#intro — "free returns within 30 days"
   Selector: #intro
   Quote: "free returns within 30 days"
   Context: …We offer [free returns within 30 days] on all orders, no questions…
   Position: page (120, 640), 210 × 18 px
   Note:
   This contradicts the footer, which says 14 days.
```

Rules the format follows:

- Plain text / light markdown only; no JSON, nothing that needs parsing
  machinery to read.
- `Selector` is a CSS selector verified unique on the page at pin time
  (see below); `Element` is `tag#id.class` plus the element's visible text
  (first ~120 chars, or its `alt` / `aria-label` / `placeholder`).
- `Position` is in page coordinates (scroll included) with the element's
  size — cheap disambiguation and layout context.
- `Role`, `Accessible name` and `Link` lines appear only when present.
- Notes keep their line breaks, indented under `Note:`.

### How the selector is built

Adapted from `src/live-edit/overlay.js`'s `buildSelector`, hardened for
arbitrary pages (the overlay only needed its own preview pages):

1. A unique `#id` wins; then a unique `data-testid` / `data-test` /
   `data-cy` / `data-qa` hook.
2. Otherwise walk up from the element building `tag.class` segments
   (`:nth-of-type(n)` added when siblings share the tag), stopping as
   soon as the joined path matches **only** this element — the overlay
   stopped at a fixed 4 levels whether or not the result was unique.
3. Fallback: the full `:nth-of-type` path from `<html>`.

## How it was adapted from ALE

| Overlay (`src/live-edit/overlay.js`) | This extension |
|---|---|
| Injected by launcher / Vite plugin (`client/annotate.js` fetches it from the launcher origin) | Injected by the background worker with `chrome.scripting`, only on user invocation |
| Styles as a `<style>` in the page, `#ai-live-edit-root` | One **shadow-DOM host**; page CSS can neither break nor be broken by the UI |
| Pick → menu (note / move / placement rects) → **Submit** POSTs to `/api/live-edit/submit` | Pick → note editor → **Copy** to clipboard. No server, no submit |
| Move annotations, UI placement rectangles, React-component toggle, chat digest over postMessage | Dropped for slice 1 — they serve ALE's own pipeline. The descriptor keeps selector + text + position |
| Annotations in `sessionStorage` per page | Slice 1 matched that; slice 2 moved them to `chrome.storage.local` (cross-session, extension-scoped), migrating old records |
| `window.__AI_LIVE_EDIT__` API | `window.__ALE_ANNOTATE_EXT__` API (used by the checks) |

Agentation is intentionally not involved — the user removed it from ALE
in favour of this overlay approach, and this extension follows the overlay.

## Structure & permissions

```
chrome-extensions/annotate/
  manifest.json   MV3 manifest
  background.js   Service worker: toolbar action + Alt+Shift+A → inject/toggle; badge shows ON; captureVisibleTab for screenshots
  content.js      Everything in-page: picking, selections, pins, editor, panel, storage, cropping, copy
  test/check.mjs  Dependency-free structural checks (node test/check.mjs)
```

Permissions, each load-bearing and nothing more:

- `activeTab` — temporary access to the tab the user invoked the extension
  on. There is **no** `host_permissions` and no static `content_scripts`,
  so the extension touches no page until invoked, and never runs at startup.
  `captureVisibleTab` (screenshots) is permitted by this same grant —
  Chrome accepts `activeTab` or `<all_urls>` for it, and this extension
  deliberately takes the `activeTab` route. The grant lasts while the tab
  stays on the same site; if screenshots start failing after navigating
  elsewhere, toggle the extension off and on to re-grant.
- `scripting` — inject `content.js` into that tab on first invocation.
- `clipboardWrite` — the Copy actions (text payload and screenshot images).
- `storage` — `chrome.storage.local`, where annotations persist per page
  URL across sessions. Extension-scoped; the page cannot read it. A size
  guard drops the oldest screenshot data (keeping a marker) rather than
  failing a save near the ~10 MB quota.

Non-http(s) pages (`chrome://`, the Web Store, …) cannot be scripted; the
toolbar click flashes a `—` badge there instead of failing silently. The
worker decides this by trying — message first, injection second — rather
than by inspecting `tab.url`, which the Tabs API does not reliably expose
without a grant.

## Slices

- **Slice 1:** MV3 skeleton, toggle (action + shortcut), hover highlight,
  click-to-pin, note editor, numbered panel (edit / remove / scroll-to),
  optional page note, Copy with the format above, session persistence.
- **Slice 2:** cross-session persistence — `chrome.storage.local` per page
  URL, legacy session records migrated, panel controls row with
  **Clear all**.
- **Slice 3:** text-selection annotations — exact quote + surrounding
  context + containing element in the payload, amber range box, and the
  follow-up click of a drag-select is suppressed (250 ms window) without
  also pinning the element underneath.
- **Slice 4:** cropped screenshots via `captureVisibleTab` — auto-capture
  toggle or per-note **Attach screenshot**; the worker captures, the
  content script crops (own UI hidden, off-screen targets scrolled into
  view, longest side capped at 900 px, PNG for small crops / JPEG for
  large); thumbnails in the panel; **Save image** / **Copy image** per
  annotation; the payload gains a `Screenshot:` line. Text stays primary.
- **Not planned:** move/placement rectangles, React fiber/source-file
  lookup, any sync or server — those belong to ALE proper.

## Verification

- `node test/check.mjs` — manifest parses and references existing files,
  permissions stay within the declared set, both scripts parse, content
  script contains no network APIs and no `innerHTML` writes of page data.
  25 checks after slice 4.
- Driven in Chromium against a fixture page (script-injected context):
  the slice-1 flow end to end (hover → pin → payload asserted line by
  line → real Copy → clipboard contents match → edit / delete → reload
  persistence; 23 checks), persistence (legacy-record adoption and
  migration, survival across a simulated new session, Clear-all wipe;
  5 checks), and text selection (real mouse drag-select, exact quote /
  context, click suppression, payload shape, graceful screenshot failure
  outside an extension context; 11 checks).
- The unpacked extension was also loaded into a real Chromium profile:
  slice 1's load checks (8: service worker, toggle → inject → annotate →
  toggle-off, badge, `chrome://` refusal), plus slices 2–4 (13 checks):
  auto-screenshot attached and thumbnailed for both an element pin and a
  drag-selected text annotation, payload Screenshot/Quote lines read back
  from the real clipboard, **Copy image** putting a real PNG on the
  clipboard, annotations + thumbnails surviving a full browser restart in
  `chrome.storage.local`, and Clear-all emptying the record.
- Honest gaps, unchanged in kind: the load tests grant the harness copy
  host access statically (`<all_urls>` — which `captureVisibleTab` also
  accepts) because a synthetic worker call cannot reproduce the
  `activeTab` grant a real toolbar click gives the shipped manifest
  (asserted minimal by `test/check.mjs`); and a human literally clicking
  the toolbar button / pressing Alt+Shift+A in their own Chrome remains
  unexercised.
