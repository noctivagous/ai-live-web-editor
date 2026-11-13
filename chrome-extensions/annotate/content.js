/**
 * ALE Annotate — content script.
 *
 * Adapted from ALE's in-house overlay annotation (src/live-edit/overlay.js):
 * hover highlighting via capture-phase mouse tracking, element picking via
 * composedPath, and a selector-based element description. The overlay's
 * server submit pipeline is NOT carried over — this script's only output
 * is a text payload copied to the clipboard.
 *
 * Everything UI lives inside one shadow-DOM host so page styles can neither
 * break it nor be broken by it. Page content is only ever written into the
 * UI with textContent (never innerHTML). No network calls.
 */
(function () {
  if (window.__ALE_ANNOTATE_EXT__ && window.__ALE_ANNOTATE_EXT__.installed) return;

  var STORAGE_KEY = 'ale_annotate_ext:' + location.href.split('#')[0];

  var state = {
    enabled: false,
    picking: true,
    annotations: [], // {id, note, descriptor:{selector,tag,id,classes,text,label,role,href,rect:{x,y,w,h}}}
    pageNote: '',
    hovered: null,
    editing: null, // {id, isNew}
    scheduled: false,
    flashUntil: 0,
    flashEl: null,
    autoShots: false,
    suppressClickUntil: 0,
  };

  /* ------------------------------------------------------------------ */
  /* Element description — the heart of the clipboard payload            */
  /* ------------------------------------------------------------------ */

  function collapseText(s, max) {
    var t = String(s || '').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    return t.slice(0, max - 1) + '…';
  }

  function stableClasses(el) {
    var out = [];
    if (!el.classList) return out;
    for (var i = 0; i < el.classList.length && out.length < 3; i++) {
      var c = el.classList[i];
      // Skip our own / obvious state classes; keep author classes.
      if (/^(ai-le|ale-)/.test(c)) continue;
      if (/^[a-zA-Z_][\w-]*$/.test(c)) out.push(c);
    }
    return out;
  }

  function nthOfType(el) {
    var parent = el.parentElement;
    if (!parent) return 1;
    var same = 0, idx = 0;
    for (var i = 0; i < parent.children.length; i++) {
      if (parent.children[i].tagName === el.tagName) {
        same++;
        if (parent.children[i] === el) idx = same;
      }
    }
    return same > 1 ? idx : 0;
  }

  function segmentFor(el) {
    var seg = el.tagName.toLowerCase();
    if (el.id) return seg + '#' + CSS.escape(el.id);
    var classes = stableClasses(el);
    for (var i = 0; i < classes.length; i++) seg += '.' + CSS.escape(classes[i]);
    var nth = nthOfType(el);
    if (nth) seg += ':nth-of-type(' + nth + ')';
    return seg;
  }

  function matchesOnly(selector, el) {
    try {
      var found = document.querySelectorAll(selector);
      return found.length === 1 && found[0] === el;
    } catch (e) { return false; }
  }

  /**
   * Robust selector: shortest path that uniquely matches el, preferring an
   * #id anchor, then data-testid-style hooks, then tag.class / nth-of-type
   * segments walking up from the element (overlay.js walked a fixed 4
   * levels with nth-of-type only; this walks until the selector is unique).
   */
  function buildSelector(el) {
    if (!(el instanceof Element)) return 'body';
    if (el === document.body) return 'body';
    if (el === document.documentElement) return 'html';
    if (el.id && matchesOnly('#' + CSS.escape(el.id), el)) return '#' + CSS.escape(el.id);
    var dataKeys = ['data-testid', 'data-test', 'data-cy', 'data-qa'];
    for (var i = 0; i < dataKeys.length; i++) {
      var v = el.getAttribute(dataKeys[i]);
      if (v) {
        var sel = '[' + dataKeys[i] + '="' + CSS.escape(v) + '"]';
        if (matchesOnly(sel, el)) return sel;
      }
    }
    var parts = [];
    var cur = el;
    while (cur && cur !== document.documentElement) {
      parts.unshift(segmentFor(cur));
      var candidate = parts.join(' > ');
      if (matchesOnly(candidate, el)) return candidate;
      if (cur.id) break; // an #id segment anchors the path; going higher adds nothing
      cur = cur.parentElement;
    }
    // Fallback: full nth-of-type path from <html>.
    parts = [];
    cur = el;
    while (cur && cur !== document.documentElement) {
      var tag = cur.tagName.toLowerCase();
      var nth = nthOfType(cur);
      parts.unshift(nth ? tag + ':nth-of-type(' + nth + ')' : tag);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function describeElement(el) {
    var rect = el.getBoundingClientRect();
    var classes = stableClasses(el);
    var label = el.tagName.toLowerCase();
    if (el.id) label += '#' + el.id;
    for (var i = 0; i < classes.length; i++) label += '.' + classes[i];
    var text = '';
    try { text = collapseText(el.innerText || el.textContent || '', 120); } catch (e) { text = ''; }
    if (!text) {
      var alt = el.getAttribute && (el.getAttribute('alt') || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title'));
      if (alt) text = collapseText(alt, 120);
    }
    var href = null;
    if (el.tagName === 'A' && el.getAttribute('href')) href = el.getAttribute('href');
    if (el.tagName === 'IMG' && el.getAttribute('src')) href = el.getAttribute('src');
    return {
      selector: buildSelector(el),
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: classes,
      label: label,
      text: text,
      role: (el.getAttribute && el.getAttribute('role')) || null,
      ariaLabel: (el.getAttribute && el.getAttribute('aria-label')) || null,
      href: href,
      rect: {
        x: Math.round(rect.left + window.scrollX),
        y: Math.round(rect.top + window.scrollY),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* Clipboard payload — the product. Plain text, paste-ready.           */
  /* ------------------------------------------------------------------ */

  function indent(text, pad) {
    return String(text || '').split('\n').map(function (line) { return pad + line; }).join('\n');
  }

  /* ------------------------------------------------------------------ */
  /* Text-selection annotations                                          */
  /* ------------------------------------------------------------------ */

  function elementForNode(node) {
    var n = node;
    while (n && n.nodeType !== 1) n = n.parentNode;
    return n;
  }

  /**
   * Build a selection annotation's data from a Range: the exact quote,
   * a descriptor of the containing element (its rect replaced by the
   * selection's own rect), and ~40 chars of surrounding context so the
   * quote can be re-found even if it occurs more than once.
   */
  function describeSelection(range) {
    var quote = String(range.toString() || '').replace(/\s+/g, ' ').trim();
    if (quote.length < 2) return null;
    var container = elementForNode(range.commonAncestorContainer);
    if (!container || container === host) return null;
    var descriptor = describeElement(container);
    var r = range.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return null;
    descriptor.rect = {
      x: Math.round(r.left + window.scrollX),
      y: Math.round(r.top + window.scrollY),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
    var before = '', after = '';
    try {
      var flat = String(container.textContent || '').replace(/\s+/g, ' ');
      var idx = flat.indexOf(quote);
      if (idx >= 0) {
        before = flat.slice(Math.max(0, idx - 40), idx).trim();
        after = flat.slice(idx + quote.length, idx + quote.length + 40).trim();
      }
    } catch (e) { /* context is best-effort */ }
    return {
      quote: quote.length > 400 ? quote.slice(0, 399) + '…' : quote,
      before: before,
      after: after,
      descriptor: descriptor,
    };
  }

  /** Stored doc-coords rect → viewport rect (for pins and boxes). */
  function storedViewportRect(a) {
    var d = a.descriptor.rect;
    return { left: d.x - window.scrollX, top: d.y - window.scrollY, width: d.w, height: d.h };
  }

  function composeText() {
    var lines = [];
    lines.push('Annotations for: ' + (document.title || '(untitled page)'));
    lines.push('URL: ' + location.href);
    lines.push('Viewport: ' + window.innerWidth + ' × ' + window.innerHeight);
    if (state.pageNote && state.pageNote.trim()) {
      lines.push('');
      lines.push('Page note:');
      lines.push(indent(state.pageNote.trim(), '  '));
    }
    if (!state.annotations.length) {
      lines.push('');
      lines.push('(no element annotations)');
    }
    state.annotations.forEach(function (a, i) {
      var d = a.descriptor;
      lines.push('');
      if (a.kind === 'selection') {
        lines.push((i + 1) + ') Selected text in ' + d.label + ' — "' + collapseText(a.quote, 80) + '"');
        lines.push('   Selector: ' + d.selector);
        lines.push('   Quote: "' + a.quote + '"');
        if (a.before || a.after) {
          lines.push('   Context: …' + (a.before || '') + ' [' + collapseText(a.quote, 60) + '] ' + (a.after || '') + '…');
        }
      } else {
        var head = (i + 1) + ') Element: ' + d.label;
        if (d.text) head += ' — "' + d.text + '"';
        lines.push(head);
        lines.push('   Selector: ' + d.selector);
        if (d.role) lines.push('   Role: ' + d.role);
        if (d.ariaLabel && d.ariaLabel !== d.text) lines.push('   Accessible name: "' + d.ariaLabel + '"');
        if (d.href) lines.push('   Link: ' + d.href);
      }
      if (a.screenshot && a.screenshot.dataUrl) {
        lines.push('   Screenshot: ' + a.screenshot.w + ' × ' + a.screenshot.h + ' px crop (a separate image — Save image / Copy image in the Annotate panel)');
      } else if (a.screenshot && a.screenshot.dropped) {
        lines.push('   Screenshot: was captured but dropped to fit extension storage — retake it from the panel if needed');
      }
      lines.push('   Position: page (' + d.rect.x + ', ' + d.rect.y + '), ' + d.rect.w + ' × ' + d.rect.h + ' px');
      lines.push('   Note:');
      lines.push(indent((a.note || '').trim() || '(no note)', '   '));
    });
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ */
  /* Persistence — cross-session, per page URL.                          */
  /*                                                                     */
  /* Primary store is chrome.storage.local (extension-scoped, survives   */
  /* browser restarts, invisible to the page). Slice 1 used              */
  /* sessionStorage; a legacy session record under the same key is       */
  /* adopted once and migrated. Outside an extension context (tests      */
  /* injecting this file directly) the fallback is localStorage, then    */
  /* sessionStorage. Annotations stay until the user clears them.        */
  /* ------------------------------------------------------------------ */

  var extStorage = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ? chrome.storage.local : null;
  var saveTimer = null;

  function recordData() {
    return {
      annotations: state.annotations,
      pageNote: state.pageNote,
      settings: { autoShots: !!state.autoShots },
      savedAt: Date.now(),
    };
  }

  function applyData(data) {
    if (!data) return false;
    if (Array.isArray(data.annotations)) state.annotations = data.annotations;
    if (typeof data.pageNote === 'string') state.pageNote = data.pageNote;
    if (data.settings && typeof data.settings.autoShots === 'boolean') state.autoShots = data.settings.autoShots;
    return true;
  }

  function writeRecord() {
    saveTimer = null;
    var data = recordData();
    // chrome.storage.local has a ~10MB total quota; screenshots are the
    // only heavy field. If the record would crowd it, drop the oldest
    // screenshots (keeping a marker) rather than failing the whole save.
    try {
      var size = JSON.stringify(data).length;
      var dropped = false;
      for (var i = 0; size > 4500000 && i < data.annotations.length; i++) {
        var a = data.annotations[i];
        if (a.screenshot && a.screenshot.dataUrl) {
          a.screenshot = { w: a.screenshot.w, h: a.screenshot.h, dropped: 'quota' };
          dropped = true;
          size = JSON.stringify(data).length;
        }
      }
      if (dropped) {
        state.annotations = data.annotations;
        setStatus('Storage nearly full — oldest screenshots dropped, notes kept');
      }
    } catch (e) { /* size guard is best-effort */ }
    if (extStorage) {
      var obj = {};
      obj[STORAGE_KEY] = data;
      try {
        var p = extStorage.set(obj);
        if (p && typeof p.catch === 'function') {
          p.catch(function () { setStatus('Could not save annotations (storage error)'); });
        }
      } catch (e) { setStatus('Could not save annotations (storage error)'); }
    } else {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
      catch (e) {
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e2) { /* in-memory only */ }
      }
    }
  }

  function save() {
    if (extStorage) {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(writeRecord, 200);
    } else {
      writeRecord();
    }
  }

  function saveNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    writeRecord();
  }

  function adoptLegacySession() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      if (applyData(JSON.parse(raw))) {
        sessionStorage.removeItem(STORAGE_KEY);
        saveNow();
        scheduleRender();
      }
    } catch (e) { /* ignore */ }
  }

  function load() {
    if (extStorage) {
      try {
        var p = extStorage.get(STORAGE_KEY);
        if (p && typeof p.then === 'function') {
          p.then(function (res) {
            var data = res && res[STORAGE_KEY];
            if (data && applyData(data)) scheduleRender();
            else adoptLegacySession();
          }, function () { adoptLegacySession(); });
          return;
        }
      } catch (e) { /* fall through */ }
    }
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw && applyData(JSON.parse(raw))) return;
    } catch (e) { /* ignore */ }
    adoptLegacySession();
  }

  function clearAll() {
    state.annotations = [];
    state.pageNote = '';
    state.flashEl = null;
    closeEditor();
    saveNow();
    setStatus('All annotations for this page cleared');
    scheduleRender();
  }

  /* ------------------------------------------------------------------ */
  /* Shadow-DOM UI                                                       */
  /* ------------------------------------------------------------------ */

  var host = document.createElement('div');
  host.id = 'ale-annotate-ext';
  var shadow = host.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent = [
    ':host { font-family: ui-sans-serif, system-ui, sans-serif; }',
    '.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }',
    '.highlight { position: fixed; border: 2px solid #2563eb; border-radius: 4px; background: rgba(37,99,235,.08); display: none; }',
    '.highlight .tag { position: absolute; left: -2px; top: -22px; max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: #111827; color: #bfdbfe; border: 1px solid rgba(37,99,235,.6); padding: 1px 6px; font: 11px ui-monospace, Menlo, Consolas, monospace; border-radius: 5px; }',
    '.pin { position: fixed; width: 20px; height: 20px; margin: -10px 0 0 -10px; border-radius: 50%; background: #2563eb; color: #fff; border: 2px solid #fff; box-shadow: 0 1px 5px rgba(0,0,0,.4); font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; cursor: pointer; pointer-events: auto; }',
    '.pin.stale { background: #9ca3af; }',
    '.panel { position: fixed; right: 16px; bottom: 16px; width: 320px; max-height: 60vh; display: none; flex-direction: column; background: #141417; color: #e4e4e7; border: 1px solid #26262c; border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.45); font-size: 12px; pointer-events: auto; overflow: hidden; }',
    '.panel.open { display: flex; }',
    '.panel header { display: flex; align-items: center; gap: 6px; padding: 8px 10px; background: #1a1a1e; font-weight: 600; }',
    '.panel header .spacer { flex: 1; }',
    '.controls { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 6px; background: #1a1a1e; border-top: 1px solid #26262c; border-bottom: 1px solid #26262c; }',
    '.controls .spacer { flex: 1; }',
    '.thumb { display: block; max-width: 100%; max-height: 110px; border: 1px solid #34343e; border-radius: 6px; margin-top: 5px; }',
    '.shot-row { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 5px; }',
    '.shot-row button { padding: 3px 7px; font-size: 11px; }',
    '.selbox { position: fixed; border: 2px solid #d97706; background: rgba(217,119,6,.13); border-radius: 3px; display: none; }',
    'button { background: #1f1f24; border: 1px solid #34343e; color: #e4e4e7; padding: 5px 9px; border-radius: 7px; cursor: pointer; font-size: 12px; font-weight: 500; }',
    'button:hover { background: #26262c; }',
    'button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }',
    'button.primary:hover { background: #1d4ed8; }',
    'button[data-active="true"] { background: rgba(37,99,235,.25); border-color: #2563eb; color: #bfdbfe; }',
    'button:disabled { opacity: .45; cursor: default; }',
    '.list { overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 4px; }',
    '.item { display: flex; gap: 7px; align-items: flex-start; padding: 6px; border: 1px solid #26262c; border-radius: 8px; background: #0f0f12; cursor: pointer; }',
    '.item:hover { border-color: #34343e; }',
    '.num { flex: none; width: 18px; height: 18px; border-radius: 50%; background: #2563eb; color: #fff; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; margin-top: 1px; }',
    '.item .main { flex: 1; min-width: 0; }',
    '.item .sel { font: 10.5px ui-monospace, Menlo, Consolas, monospace; color: #93c5fd; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.item .note { color: #d4d4d8; white-space: pre-wrap; word-break: break-word; margin-top: 2px; }',
    '.item .note.empty { color: #71717a; font-style: italic; }',
    '.item .del { flex: none; padding: 2px 7px; }',
    '.empty-list { color: #71717a; padding: 10px 8px; text-align: center; }',
    '.page-note { padding: 6px; border-top: 1px solid #26262c; }',
    '.page-note textarea, .editor textarea { width: 100%; box-sizing: border-box; background: #0f0f12; border: 1px solid #26262c; border-radius: 8px; padding: 6px; color: #e4e4e7; font: 12px ui-sans-serif, system-ui, sans-serif; resize: vertical; }',
    '.page-note textarea { min-height: 44px; }',
    'textarea:focus { outline: none; border-color: #2563eb; }',
    '.status { padding: 5px 10px; color: #a1a1aa; font-size: 11.5px; border-top: 1px solid #26262c; min-height: 14px; }',
    '.status:empty { display: none; }',
    '.editor { position: fixed; width: 288px; display: none; background: #141417; color: #e4e4e7; border: 1px solid #34343e; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.5); padding: 8px; pointer-events: auto; }',
    '.editor.open { display: block; }',
    '.editor .target { font: 10.5px ui-monospace, Menlo, Consolas, monospace; color: #93c5fd; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 6px; }',
    '.editor textarea { min-height: 64px; }',
    '.editor .row { display: flex; gap: 6px; margin-top: 7px; }',
    '.editor .row .spacer { flex: 1; }',
    '.hint { color: #71717a; font-size: 10.5px; margin-top: 5px; }',
  ].join('\n');
  shadow.appendChild(style);

  var layer = document.createElement('div');
  layer.className = 'layer';
  shadow.appendChild(layer);

  var highlight = document.createElement('div');
  highlight.className = 'highlight';
  var highlightTag = document.createElement('div');
  highlightTag.className = 'tag';
  highlight.appendChild(highlightTag);
  layer.appendChild(highlight);

  var pinLayer = document.createElement('div');
  layer.appendChild(pinLayer);

  /* Editor popup (persistent element so typing survives re-renders) */
  var editor = document.createElement('div');
  editor.className = 'editor';
  var editorTarget = document.createElement('div');
  editorTarget.className = 'target';
  var editorText = document.createElement('textarea');
  editorText.placeholder = 'Note for this element… (Ctrl+Enter to save)';
  var editorRow = document.createElement('div');
  editorRow.className = 'row';
  var saveBtn = document.createElement('button');
  saveBtn.className = 'primary';
  saveBtn.textContent = 'Save note';
  var cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  var editorSpacer = document.createElement('div');
  editorSpacer.className = 'spacer';
  var deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Delete';
  editorRow.appendChild(saveBtn);
  editorRow.appendChild(cancelBtn);
  editorRow.appendChild(editorSpacer);
  editorRow.appendChild(deleteBtn);
  var editorHint = document.createElement('div');
  editorHint.className = 'hint';
  editorHint.textContent = 'Esc cancels. The note joins the list; Copy puts everything on the clipboard.';
  /* Screenshot area of the editor (slice 4) */
  var shotArea = document.createElement('div');
  var shotImg = document.createElement('img');
  shotImg.className = 'thumb';
  shotImg.alt = 'Cropped screenshot of the annotated target';
  var shotNote = document.createElement('div');
  shotNote.className = 'hint';
  var shotRow = document.createElement('div');
  shotRow.className = 'shot-row';
  var shotAttachBtn = document.createElement('button');
  shotAttachBtn.textContent = 'Attach screenshot';
  var shotRetakeBtn = document.createElement('button');
  shotRetakeBtn.textContent = 'Retake';
  var shotCopyBtn = document.createElement('button');
  shotCopyBtn.textContent = 'Copy image';
  var shotSaveBtn = document.createElement('button');
  shotSaveBtn.textContent = 'Save image';
  var shotRemoveBtn = document.createElement('button');
  shotRemoveBtn.textContent = 'Remove';
  shotRow.appendChild(shotAttachBtn);
  shotRow.appendChild(shotRetakeBtn);
  shotRow.appendChild(shotCopyBtn);
  shotRow.appendChild(shotSaveBtn);
  shotRow.appendChild(shotRemoveBtn);
  shotArea.appendChild(shotImg);
  shotArea.appendChild(shotNote);
  shotArea.appendChild(shotRow);
  editor.appendChild(editorTarget);
  editor.appendChild(editorText);
  editor.appendChild(shotArea);
  editor.appendChild(editorRow);
  editor.appendChild(editorHint);
  shadow.appendChild(editor);

  function findAnnotation(id) {
    for (var i = 0; i < state.annotations.length; i++) if (state.annotations[i].id === id) return state.annotations[i];
    return null;
  }

  function renderEditorShot(a) {
    var has = !!(a && a.screenshot && a.screenshot.dataUrl);
    var dropped = !!(a && a.screenshot && a.screenshot.dropped);
    shotImg.style.display = has ? 'block' : 'none';
    if (has) shotImg.src = a.screenshot.dataUrl;
    shotNote.textContent = dropped ? 'The saved screenshot was dropped to fit storage. Retake it if you still need it.' : '';
    shotNote.style.display = dropped ? 'block' : 'none';
    shotAttachBtn.style.display = has ? 'none' : '';
    shotRetakeBtn.style.display = has ? '' : 'none';
    shotCopyBtn.style.display = has ? '' : 'none';
    shotSaveBtn.style.display = has ? '' : 'none';
    shotRemoveBtn.style.display = (has || dropped) ? '' : 'none';
  }

  /* Panel */
  var panel = document.createElement('div');
  panel.className = 'panel';
  var pHead = document.createElement('header');
  var pTitle = document.createElement('span');
  pTitle.textContent = 'Annotate';
  var pSpacer = document.createElement('span');
  pSpacer.className = 'spacer';
  var pickBtn = document.createElement('button');
  pickBtn.textContent = 'Picking';
  pickBtn.title = 'Pause picking to use the page normally without leaving annotate mode';
  var copyBtn = document.createElement('button');
  copyBtn.className = 'primary';
  copyBtn.textContent = 'Copy';
  copyBtn.title = 'Copy all annotations as text';
  var exitBtn = document.createElement('button');
  exitBtn.textContent = 'Exit';
  pHead.appendChild(pTitle);
  pHead.appendChild(pSpacer);
  pHead.appendChild(copyBtn);
  pHead.appendChild(exitBtn);
  var controls = document.createElement('div');
  controls.className = 'controls';
  var shotsBtn = document.createElement('button');
  shotsBtn.textContent = 'Screenshots: off';
  shotsBtn.title = 'Automatically capture a cropped screenshot for each new annotation';
  var controlsSpacer = document.createElement('span');
  controlsSpacer.className = 'spacer';
  var clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear all';
  clearBtn.title = 'Delete every annotation and the page note for this page (they persist across sessions until cleared)';
  controls.appendChild(pickBtn);
  controls.appendChild(shotsBtn);
  controls.appendChild(controlsSpacer);
  controls.appendChild(clearBtn);
  var listEl = document.createElement('div');
  listEl.className = 'list';
  var pageNoteWrap = document.createElement('div');
  pageNoteWrap.className = 'page-note';
  var pageNoteText = document.createElement('textarea');
  pageNoteText.placeholder = 'Note about the whole page (optional)…';
  pageNoteWrap.appendChild(pageNoteText);
  var statusEl = document.createElement('div');
  statusEl.className = 'status';
  panel.appendChild(pHead);
  panel.appendChild(controls);
  panel.appendChild(listEl);
  panel.appendChild(pageNoteWrap);
  panel.appendChild(statusEl);
  shadow.appendChild(panel);

  document.documentElement.appendChild(host);

  function setStatus(text) { statusEl.textContent = text || ''; }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  function resolve(a) {
    try { return document.querySelector(a.descriptor.selector); } catch (e) { return null; }
  }

  function scheduleRender() {
    if (state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(function () { state.scheduled = false; render(); });
  }

  function render() {
    panel.classList.toggle('open', state.enabled);
    pickBtn.setAttribute('data-active', state.picking ? 'true' : 'false');
    pickBtn.textContent = state.picking ? 'Picking: on' : 'Picking: paused';
    shotsBtn.setAttribute('data-active', state.autoShots ? 'true' : 'false');
    shotsBtn.textContent = state.autoShots ? 'Screenshots: on' : 'Screenshots: off';
    clearBtn.disabled = !state.annotations.length && !state.pageNote.trim();
    copyBtn.disabled = !state.annotations.length && !state.pageNote.trim();
    pTitle.textContent = 'Annotate' + (state.annotations.length ? ' — ' + state.annotations.length : '');
    if (pageNoteText.value !== state.pageNote) pageNoteText.value = state.pageNote;

    // Highlight (hover or flash)
    var hlEl = null;
    if (state.flashEl && Date.now() < state.flashUntil) hlEl = state.flashEl;
    else if (state.enabled && state.picking && !state.editing) hlEl = state.hovered;
    if (hlEl) {
      var r = hlEl.getBoundingClientRect();
      highlight.style.display = 'block';
      highlight.style.left = r.left + 'px';
      highlight.style.top = r.top + 'px';
      highlight.style.width = r.width + 'px';
      highlight.style.height = r.height + 'px';
      highlightTag.textContent = buildSelector(hlEl);
      highlightTag.style.top = r.top < 26 ? '2px' : '-22px';
    } else {
      highlight.style.display = 'none';
    }

    // Pins (+ selection boxes for text annotations)
    while (pinLayer.firstChild) pinLayer.removeChild(pinLayer.firstChild);
    if (state.enabled) {
      state.annotations.forEach(function (a, i) {
        var el = resolve(a);
        var pin = document.createElement('div');
        pin.className = 'pin' + (el ? '' : ' stale');
        pin.textContent = String(i + 1);
        pin.title = a.kind === 'selection' ? '"' + collapseText(a.quote, 60) + '"' : a.descriptor.selector;
        var px, py;
        if (a.kind === 'selection') {
          var sr = storedViewportRect(a);
          px = sr.left; py = sr.top;
          var box = document.createElement('div');
          box.className = 'selbox';
          box.style.display = 'block';
          box.style.left = sr.left + 'px';
          box.style.top = sr.top + 'px';
          box.style.width = sr.width + 'px';
          box.style.height = sr.height + 'px';
          pinLayer.appendChild(box);
        } else if (el) {
          var pr = el.getBoundingClientRect();
          px = pr.left; py = pr.top;
        }
        if (px != null) {
          pin.style.left = Math.min(Math.max(px, 12), window.innerWidth - 12) + 'px';
          pin.style.top = Math.min(Math.max(py, 12), window.innerHeight - 12) + 'px';
        } else {
          pin.style.left = (20 + i * 24) + 'px';
          pin.style.top = '20px';
        }
        pin.addEventListener('click', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          openEditor(a.id, false);
        });
        pinLayer.appendChild(pin);
      });
    }

    // Panel list
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    if (!state.annotations.length) {
      var empty = document.createElement('div');
      empty.className = 'empty-list';
      empty.textContent = state.picking
        ? 'Click any element — or select text — on the page to pin a note to it.'
        : 'Picking is paused — turn it on, then click an element or select text.';
      listEl.appendChild(empty);
    }
    state.annotations.forEach(function (a, i) {
      var item = document.createElement('div');
      item.className = 'item';
      var num = document.createElement('div');
      num.className = 'num';
      num.textContent = String(i + 1);
      var main = document.createElement('div');
      main.className = 'main';
      var sel = document.createElement('div');
      sel.className = 'sel';
      sel.textContent = a.kind === 'selection'
        ? '"' + collapseText(a.quote, 60) + '" — in ' + a.descriptor.selector
        : a.descriptor.selector;
      sel.title = a.descriptor.selector;
      var note = document.createElement('div');
      note.className = 'note' + (a.note ? '' : ' empty');
      note.textContent = a.note || '(no note yet — click to edit)';
      main.appendChild(sel);
      main.appendChild(note);
      if (a.screenshot && a.screenshot.dataUrl) {
        var thumb = document.createElement('img');
        thumb.className = 'thumb';
        thumb.alt = 'Cropped screenshot for annotation ' + (i + 1);
        thumb.src = a.screenshot.dataUrl;
        main.appendChild(thumb);
        var srow = document.createElement('div');
        srow.className = 'shot-row';
        var saveImgBtn = document.createElement('button');
        saveImgBtn.textContent = 'Save image';
        saveImgBtn.addEventListener('click', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          saveShotImage(a, i);
        });
        var copyImgBtn = document.createElement('button');
        copyImgBtn.textContent = 'Copy image';
        copyImgBtn.addEventListener('click', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          copyShotImage(a);
        });
        srow.appendChild(saveImgBtn);
        srow.appendChild(copyImgBtn);
        main.appendChild(srow);
      } else if (a.screenshot && a.screenshot.dropped) {
        var droppedNote = document.createElement('div');
        droppedNote.className = 'note empty';
        droppedNote.textContent = '(screenshot dropped to fit storage — open the note to retake)';
        main.appendChild(droppedNote);
      }
      var del = document.createElement('button');
      del.className = 'del';
      del.textContent = '×';
      del.title = 'Remove this annotation';
      del.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        removeAnnotation(a.id);
      });
      item.appendChild(num);
      item.appendChild(main);
      item.appendChild(del);
      item.addEventListener('click', function () {
        var el = resolve(a);
        if (a.kind === 'selection') {
          window.scrollTo({ top: Math.max(0, a.descriptor.rect.y - window.innerHeight / 2), behavior: 'smooth' });
          setTimeout(scheduleRender, 350);
        } else if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          state.flashEl = el;
          state.flashUntil = Date.now() + 1200;
          scheduleRender();
          setTimeout(scheduleRender, 1250);
        }
        openEditor(a.id, false);
      });
      listEl.appendChild(item);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Editor                                                              */
  /* ------------------------------------------------------------------ */

  function openEditor(id, isNew) {
    var a = null;
    for (var i = 0; i < state.annotations.length; i++) if (state.annotations[i].id === id) a = state.annotations[i];
    if (!a) return;
    state.editing = { id: id, isNew: !!isNew };
    editorTarget.textContent = a.kind === 'selection'
      ? '"' + collapseText(a.quote, 50) + '" — in ' + a.descriptor.selector
      : a.descriptor.label + ' — ' + a.descriptor.selector;
    editorTarget.title = a.descriptor.selector;
    editorText.placeholder = a.kind === 'selection' ? 'Note for this text… (Ctrl+Enter to save)' : 'Note for this element… (Ctrl+Enter to save)';
    deleteBtn.style.display = isNew ? 'none' : '';
    editorText.value = a.note || '';
    renderEditorShot(a);
    // Position near the target, clamped to the viewport.
    var x = 16, y = 16;
    var r = null;
    if (a.kind === 'selection') r = storedViewportRect(a);
    else { var el = resolve(a); if (el) r = el.getBoundingClientRect(); }
    if (r) {
      x = Math.min(Math.max(r.left, 8), window.innerWidth - 304);
      y = r.top + r.height + 8;
      if (y + 230 > window.innerHeight) y = Math.max(8, r.top - 238);
    }
    editor.style.left = x + 'px';
    editor.style.top = y + 'px';
    editor.classList.add('open');
    setTimeout(function () { editorText.focus(); editorText.select(); }, 30);
    scheduleRender();
  }

  function closeEditor() {
    state.editing = null;
    editor.classList.remove('open');
    scheduleRender();
  }

  function saveEditor() {
    if (!state.editing) return;
    var id = state.editing.id, isNew = state.editing.isNew;
    var text = editorText.value.trim();
    if (!text) {
      // An empty note is not an annotation; discard it.
      if (isNew) removeAnnotation(id, true);
      closeEditor();
      setStatus('Empty note discarded');
      return;
    }
    for (var i = 0; i < state.annotations.length; i++) {
      if (state.annotations[i].id === id) state.annotations[i].note = text;
    }
    save();
    closeEditor();
    setStatus('Note saved — ' + state.annotations.length + ' annotation' + (state.annotations.length === 1 ? '' : 's'));
  }

  function cancelEditor() {
    if (!state.editing) return;
    if (state.editing.isNew) removeAnnotation(state.editing.id, true);
    closeEditor();
  }

  function removeAnnotation(id, silent) {
    state.annotations = state.annotations.filter(function (a) { return a.id !== id; });
    if (state.editing && state.editing.id === id) closeEditor();
    save();
    if (!silent) setStatus('Annotation removed');
    scheduleRender();
  }

  saveBtn.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); saveEditor(); });
  cancelBtn.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); cancelEditor(); });
  deleteBtn.addEventListener('click', function (ev) {
    ev.preventDefault(); ev.stopPropagation();
    if (state.editing) { var id = state.editing.id; closeEditor(); removeAnnotation(id); }
  });
  editorText.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); saveEditor(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); cancelEditor(); }
    ev.stopPropagation();
  });

  /* ------------------------------------------------------------------ */
  /* Panel actions                                                       */
  /* ------------------------------------------------------------------ */

  pickBtn.addEventListener('click', function (ev) {
    ev.preventDefault(); ev.stopPropagation();
    state.picking = !state.picking;
    setStatus(state.picking ? 'Picking on — click an element' : 'Picking paused');
    scheduleRender();
  });

  shotsBtn.addEventListener('click', function (ev) {
    ev.preventDefault(); ev.stopPropagation();
    state.autoShots = !state.autoShots;
    save();
    setStatus(state.autoShots ? 'Screenshots on — new pins capture a crop' : 'Screenshots off');
    scheduleRender();
  });

  clearBtn.addEventListener('click', function (ev) {
    ev.preventDefault(); ev.stopPropagation();
    if (!state.annotations.length && !state.pageNote.trim()) { setStatus('Nothing to clear'); return; }
    clearAll();
  });

  exitBtn.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); setEnabled(false); });

  pageNoteText.addEventListener('input', function () {
    state.pageNote = pageNoteText.value;
    save();
    copyBtn.disabled = !state.annotations.length && !state.pageNote.trim();
  });
  pageNoteText.addEventListener('keydown', function (ev) { ev.stopPropagation(); });

  copyBtn.addEventListener('click', function (ev) {
    ev.preventDefault(); ev.stopPropagation();
    copyPayload();
  });

  function copyPayload() {
    var text = composeText();
    function done(ok) {
      setStatus(ok
        ? 'Copied ' + state.annotations.length + ' annotation' + (state.annotations.length === 1 ? '' : 's') + ' — paste anywhere'
        : 'Copy failed — select the preview from a note and copy manually');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      done(!!ok);
    } catch (e) { done(false); }
  }

  /* ------------------------------------------------------------------ */
  /* Screenshots — cropped per annotation via captureVisibleTab.         */
  /* Text stays the product; a screenshot is a separate image the user   */
  /* attaches alongside the pasted text (Save image / Copy image).       */
  /* ------------------------------------------------------------------ */

  function currentViewportRect(a) {
    if (a.kind === 'selection') return storedViewportRect(a);
    var el = resolve(a);
    return el ? el.getBoundingClientRect() : null;
  }

  function maybeAutoScreenshot(a) {
    if (state.autoShots) captureForAnnotation(a.id, true);
  }

  function captureForAnnotation(id, isAuto, retried) {
    var a = findAnnotation(id);
    if (!a) return;
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      if (!isAuto) setStatus('Screenshots need the extension — this page context cannot capture');
      return;
    }
    var r = currentViewportRect(a);
    if (!r) { if (!isAuto) setStatus('Screenshot failed — target no longer on the page'); return; }
    var offscreen = r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth;
    if (offscreen && !retried) {
      if (a.kind === 'selection') {
        window.scrollTo({ top: Math.max(0, a.descriptor.rect.y - window.innerHeight / 2) });
      } else {
        var el = resolve(a);
        if (el) el.scrollIntoView({ block: 'center' });
      }
      setTimeout(function () { captureForAnnotation(id, isAuto, true); }, 300);
      return;
    }
    setStatus('Capturing screenshot…');
    host.style.visibility = 'hidden';
    setTimeout(function () {
      var finished = false;
      function done(resp) {
        if (finished) return;
        finished = true;
        host.style.visibility = '';
        if (!resp || !resp.ok || !resp.dataUrl) {
          setStatus('Screenshot failed' + (resp && resp.error ? ' — ' + resp.error : ''));
          scheduleRender();
          return;
        }
        cropAndStore(a, resp.dataUrl);
      }
      try {
        chrome.runtime.sendMessage({ type: 'ale-annotate:capture' }, function (resp) {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
            done({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          done(resp);
        });
      } catch (e) { done({ ok: false, error: String(e) }); }
    }, 90);
  }

  function cropAndStore(a, dataUrl) {
    var img = new Image();
    img.onload = function () {
      try {
        var r = currentViewportRect(a);
        if (!r) { setStatus('Screenshot failed — target moved off the page'); return; }
        var dprX = img.width / window.innerWidth;
        var dprY = img.height / window.innerHeight;
        var pad = 6;
        var sx = Math.max(0, (r.left - pad) * dprX);
        var sy = Math.max(0, (r.top - pad) * dprY);
        var sw = Math.min(img.width - sx, (r.width + pad * 2) * dprX);
        var sh = Math.min(img.height - sy, (r.height + pad * 2) * dprY);
        if (sw < 2 || sh < 2) { setStatus('Screenshot failed — target not visible'); return; }
        var scale = Math.min(1, 900 / Math.max(sw, sh));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sw * scale));
        canvas.height = Math.max(1, Math.round(sh * scale));
        canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        var asPng = canvas.width * canvas.height <= 480000;
        a.screenshot = {
          dataUrl: canvas.toDataURL(asPng ? 'image/png' : 'image/jpeg', 0.82),
          w: canvas.width,
          h: canvas.height,
        };
        save();
        setStatus('Screenshot attached — it travels as a separate image (Save / Copy image)');
        if (state.editing && state.editing.id === a.id) {
          renderEditorShot(a);
          editorText.focus();
        }
        scheduleRender();
      } catch (e) { setStatus('Screenshot failed while cropping'); }
    };
    img.onerror = function () { setStatus('Screenshot failed to load'); };
    img.src = dataUrl;
  }

  function screenshotPngBlob(a) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          canvas.getContext('2d').drawImage(img, 0, 0);
          canvas.toBlob(function (b) { b ? res(b) : rej(new Error('encode failed')); }, 'image/png');
        } catch (e) { rej(e); }
      };
      img.onerror = rej;
      img.src = a.screenshot.dataUrl;
    });
  }

  function copyShotImage(a) {
    if (!a.screenshot || !a.screenshot.dataUrl) return;
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard || !navigator.clipboard.write) {
      setStatus('Copy image is not supported here — use Save image instead');
      return;
    }
    var item = {};
    item['image/png'] = screenshotPngBlob(a);
    navigator.clipboard.write([new ClipboardItem(item)]).then(
      function () { setStatus('Screenshot image copied — paste it alongside the text'); },
      function () { setStatus('Copy image failed — use Save image instead'); }
    );
  }

  function saveShotImage(a, index) {
    if (!a.screenshot || !a.screenshot.dataUrl) return;
    var link = document.createElement('a');
    link.href = a.screenshot.dataUrl;
    link.download = 'annotation-' + (index + 1) + (a.screenshot.dataUrl.indexOf('image/jpeg') === 5 ? '.jpg' : '.png');
    document.body.appendChild(link);
    link.click();
    link.remove();
    setStatus('Screenshot saved as a file — attach it with your pasted text');
  }

  function wireShotButton(btn, action) {
    btn.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      if (!state.editing) return;
      var a = findAnnotation(state.editing.id);
      if (a) action(a);
    });
  }
  wireShotButton(shotAttachBtn, function (a) { captureForAnnotation(a.id, false); });
  wireShotButton(shotRetakeBtn, function (a) { captureForAnnotation(a.id, false); });
  wireShotButton(shotCopyBtn, function (a) { copyShotImage(a); });
  wireShotButton(shotSaveBtn, function (a) {
    var idx = state.annotations.indexOf(a);
    saveShotImage(a, idx < 0 ? 0 : idx);
  });
  wireShotButton(shotRemoveBtn, function (a) {
    delete a.screenshot;
    save();
    renderEditorShot(a);
    setStatus('Screenshot removed');
    scheduleRender();
  });

  /* ------------------------------------------------------------------ */
  /* Picking                                                             */
  /* ------------------------------------------------------------------ */

  function isOwnUi(path) {
    for (var i = 0; i < path.length; i++) if (path[i] === host) return true;
    return false;
  }

  function pickTarget(ev) {
    var path = (ev.composedPath && ev.composedPath()) || [];
    if (isOwnUi(path)) return null;
    for (var i = 0; i < path.length; i++) if (path[i] instanceof Element) return path[i];
    return ev.target instanceof Element ? ev.target : null;
  }

  function onMouseMove(ev) {
    if (!state.enabled || !state.picking || state.editing) return;
    state.hovered = pickTarget(ev);
    scheduleRender();
  }

  function newId() {
    return 'ann_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function onMouseUp(ev) {
    if (!state.enabled || !state.picking || state.editing) return;
    var path = (ev.composedPath && ev.composedPath()) || [];
    if (isOwnUi(path)) return;
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    if (String(sel.toString() || '').trim().length < 2) return;
    var built = describeSelection(sel.getRangeAt(0));
    if (!built) return;
    // The click event that follows this mouseup must not also pin the
    // element underneath — the user meant the text. That click fires
    // within a few ms; keep the window short so a fast deliberate click
    // on another element right after selecting is not swallowed.
    state.suppressClickUntil = Date.now() + 250;
    var a = {
      id: newId(),
      kind: 'selection',
      note: '',
      quote: built.quote,
      before: built.before,
      after: built.after,
      descriptor: built.descriptor,
    };
    state.annotations.push(a);
    save();
    try { sel.removeAllRanges(); } catch (e) { /* our own box marks it now */ }
    openEditor(a.id, true);
    setStatus('Text annotation ' + state.annotations.length + ' pinned — write the note');
    maybeAutoScreenshot(a);
  }

  function onClick(ev) {
    if (!state.enabled) return;
    var path = (ev.composedPath && ev.composedPath()) || [];
    if (isOwnUi(path)) return; // our own buttons/pins/editor handle themselves
    if (Date.now() < state.suppressClickUntil) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    if (!state.picking || state.editing) return;
    var target = pickTarget(ev);
    if (!target || target === document.documentElement) return;
    ev.preventDefault();
    ev.stopPropagation();
    var a = {
      id: newId(),
      kind: 'element',
      note: '',
      descriptor: describeElement(target),
    };
    state.annotations.push(a);
    save();
    openEditor(a.id, true);
    setStatus('Annotation ' + state.annotations.length + ' pinned — write the note');
    maybeAutoScreenshot(a);
  }

  function onKeydown(ev) {
    if (!state.enabled) return;
    if (ev.key === 'Escape' && !state.editing) {
      ev.preventDefault();
      setEnabled(false);
    }
  }

  window.addEventListener('mousemove', onMouseMove, true);
  window.addEventListener('mouseup', onMouseUp, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKeydown, true);
  window.addEventListener('scroll', scheduleRender, true);
  window.addEventListener('resize', scheduleRender);

  /* ------------------------------------------------------------------ */
  /* Enable / disable + background wiring                                */
  /* ------------------------------------------------------------------ */

  function reportState() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'ale-annotate:state', enabled: state.enabled });
      }
    } catch (e) { /* injected outside an extension context (tests) */ }
  }

  function setEnabled(on) {
    state.enabled = !!on;
    if (!state.enabled) {
      state.picking = true;
      state.hovered = null;
      closeEditor();
    }
    reportState();
    scheduleRender();
  }

  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(function (msg) {
        if (msg && msg.type === 'ale-annotate:toggle') setEnabled(!state.enabled);
      });
    }
  } catch (e) { /* ignore */ }

  load();
  render();

  window.__ALE_ANNOTATE_EXT__ = {
    installed: true,
    version: '0.4.0',
    enable: function () { setEnabled(true); },
    disable: function () { setEnabled(false); },
    toggle: function () { setEnabled(!state.enabled); },
    isEnabled: function () { return state.enabled; },
    describeElement: describeElement,
    buildSelector: buildSelector,
    composeText: composeText,
    getAnnotations: function () { return state.annotations.slice(); },
    clear: function () { clearAll(); },
  };
})();
