/**
 * Annotate-on-the-page overlay for the AI Live Editor launcher.
 *
 * Ported from the live-editing overlay in
 * `wireframe-chrome-devtools-mcp/src/tools/live-editing.ts`
 * (`beginLiveEditingSessionHandler` page.evaluate payload).
 *
 * Intentional drift: launcher namespace `__AI_LIVE_EDIT__` (was
 * `__MCP_LIVE_EDITING__`), storage keys `ai_live_edit_*`, no MCP
 * patch-id attributes, no questionnaire/interact slideshow (not needed
 * for the annotate-and-submit loop).
 *
 * Plain script, no dependencies. Installed by inserting this source as a
 * `<script>` tag (preview iframe, extension content script) or via
 * Playwright `addScriptTag`. Self-installs on load.
 */
(function () {
  if (window.__AI_LIVE_EDIT__ && window.__AI_LIVE_EDIT__.installed) {
    return;
  }

  var STORAGE_ANNOTATIONS = 'ai_live_edit_annotations';
  var STORAGE_NOTES = 'ai_live_edit_page_notes';
  var STORAGE_UI = 'ai_live_edit_notes_ui';

  var state = {
    annotations: [],
    selectMode: false,
    scheduled: false,
    hoveredSelector: null,
    menuVisible: false,
    menuX: 0,
    menuY: 0,
    menuSelector: null,
    lastPick: null,
    pageNotes: '',
    notesVisible: false,
    notesCollapsed: false,
    notesPos: { x: 24, y: 24 },
    moveArmed: null,
    arrowTo: null,
    uiMenu: false,
    menuFromToolbar: false,
    notifyAt: 0,
    includeComponent: true,
    toolbarPos: null,
  };

  // Chat bridge: the :4112 chat iframe is cross-origin, so state crosses via
  // postMessage. The embed re-publishes to the sidebar; see annotationSync.
  var CHAT_NS = 'ai-live-annotations';
  var CHAT_CMD_NS = 'ai-live-chat-cmd';

  function abbrSelector(selector) {
    var s = String(selector || '').trim();
    if (!s) return 'body';
    var parts = s.split('>').map(function (p) { return p.trim(); }).filter(Boolean);
    if (parts.length <= 2) return s;
    return parts.slice(-2).map(function (p) { return p.replace(/:nth-of-type\(\d+\)/g, ''); }).join(' > ');
  }

  /* Tiny inline stroke icons for the toolbar (no dependencies). */
  function icon(paths) {
    return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }
  var ICON_PICK = icon('<circle cx="12" cy="12" r="8"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>');
  var ICON_NOTES = icon('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>');
  var ICON_SUBMIT = icon('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>');
  var ICON_COMPONENT = icon('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>');
  var ICON_GRIP = icon('<circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none"/>');
  var ICON_UI = icon('<rect x="3" y="7" width="18" height="10" rx="1" stroke-dasharray="3 2"/><path d="M3 7l2-4h14l2 4"/>');
  var ICON_REF = icon('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>');
  var ICON_TRASH = icon('<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>');

  /* Generic UI rects the agent places and styles to match the page. */
  var UI_RECTS = [
    { kind: 'element', label: 'Element', w: 240, h: 120, icon: '<rect x="5" y="5" width="14" height="14" rx="1" stroke-dasharray="3 2"/>' },
    { kind: 'navbar', label: 'Navbar', w: 900, h: 64, icon: '<rect x="3" y="7" width="18" height="3" rx="1"/><circle cx="6" cy="8.5" r="0.6" fill="currentColor" stroke="none"/><path d="M3 5h18"/>' },
    { kind: 'hero', label: 'Hero section', w: 900, h: 320, icon: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M7 12h6M7 15h4"/>' },
    { kind: 'card', label: 'Card', w: 320, h: 200, icon: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 9h16M8 13h5"/>' },
    { kind: 'button', label: 'Button', w: 160, h: 44, icon: '<rect x="4" y="9" width="16" height="6" rx="3"/>' },
    { kind: 'input', label: 'Input field', w: 320, h: 44, icon: '<rect x="3" y="8" width="18" height="8" rx="1"/><path d="M12 11v3"/>' },
    { kind: 'form', label: 'Form', w: 420, h: 300, icon: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M8 7h8M8 11h8M8 15h5"/>' },
    { kind: 'modal', label: 'Modal', w: 480, h: 320, icon: '<rect x="3" y="3" width="18" height="18" rx="1"/><rect x="7" y="7" width="10" height="8" rx="1"/>' },
    { kind: 'sidebar', label: 'Sidebar', w: 260, h: 500, icon: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M9 4v16"/>' },
    { kind: 'media', label: 'Image / media', w: 480, h: 270, icon: '<rect x="3" y="5" width="18" height="14" rx="1"/><circle cx="9" cy="10" r="1.5"/><path d="M3 16l5-5 4 4 3-3 6 6"/>' },
    { kind: 'text', label: 'Text block', w: 480, h: 140, icon: '<path d="M4 6h16M4 10h16M4 14h10M4 18h7"/>' },
    { kind: 'tabs', label: 'Tabs', w: 480, h: 48, icon: '<rect x="3" y="7" width="18" height="10" rx="1"/><path d="M3 11h18M9 7v4"/>' },
    { kind: 'footer', label: 'Footer', w: 900, h: 160, icon: '<rect x="3" y="14" width="18" height="3" rx="1"/><path d="M3 19h18"/>' },
  ];

  function abbrText(text, max) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    return t.slice(0, max) + '…';
  }

  function buildDigest() {
    return {
      ns: CHAT_NS,
      v: 1,
      at: Date.now(),
      selection: state.lastPick,
      annotations: state.annotations.map(function (a) {
        if (a.type === 'placement' && a.placement) {
          var plc = a.placement;
          var specifics = (a.text || '').trim();
          return {
            id: a.id,
            selector: '',
            abbr: '▦ ' + plc.label,
            text: 'Place ' + plc.label + ' (~' + plc.width + '×' + plc.height + ') at (' + (plc.x + plc.scrollX) + ', ' + (plc.y + plc.scrollY) + ')' + (specifics ? ' — ' + specifics : ''),
          };
        }
        var item = { id: a.id, selector: a.selector, abbr: abbrSelector(a.selector), text: a.text || '' };
        if (a.component) item.component = a.component;
        return item;
      }),
      pageNote: state.pageNotes
        ? { present: true, len: state.pageNotes.length, abbr: abbrText(state.pageNotes, 24) }
        : { present: false, len: 0, abbr: '' },
    };
  }

  function chatFrame() {
    try {
      // The chat iframe lives in the overlay host's shadow DOM.
      var host = document.getElementById('ai-live-chat-host');
      var root = host && host.shadowRoot;
      var frame = root
        ? root.querySelector('iframe[title="AI Chat"]')
        : document.querySelector('iframe[title="AI Chat"]');
      return frame ? frame.contentWindow : null;
    } catch (e) { return null; }
  }

  function notifyChat(force) {
    var now = Date.now();
    if (!force && now - state.notifyAt < 300) return;
    state.notifyAt = now;
    var digest = buildDigest();
    try {
      var frame = chatFrame();
      if (frame) frame.postMessage(digest, '*');
    } catch (e) { /* cross-origin post is allowed; ignore */ }
  }

  function handleChatCommand(ev) {
    var data = ev && ev.data;
    if (!data || typeof data !== 'object' || data.ns !== CHAT_CMD_NS) return;
    var api = window.__AI_LIVE_EDIT__;
    if (!api) return;
    if (data.cmd === 'pick') api.enableSelectMode();
    else if (data.cmd === 'highlight' && typeof data.selector === 'string' && data.selector) {
      if (!state.selectMode && !state.moveArmed) {
        state.hoveredSelector = data.selector;
        scheduleRender();
      }
    }
    else if (data.cmd === 'unhighlight') {
      if (state.hoveredSelector === data.selector || !data.selector) {
        state.hoveredSelector = null;
        scheduleRender();
      }
    }
    else if (data.cmd === 'submit') submitNotesToLauncher();
    else if (data.cmd === 'notes') {
      state.notesVisible = !state.notesVisible;
      saveNotes();
      scheduleRender();
    }
  }

  function setStatus(text, isError) {
    var root = document.getElementById('ai-live-edit-root');
    var el = root ? root.querySelector('.ai-le-status') : null;
    if (!el) return;
    el.textContent = text || '';
    if (isError) el.setAttribute('data-error', 'true');
    else el.removeAttribute('data-error');
  }

  function save() {
    try {
      window.sessionStorage.setItem(STORAGE_ANNOTATIONS, JSON.stringify(state.annotations));
    } catch (e) { /* ignore */ }
  }

  function saveNotes() {
    try {
      window.sessionStorage.setItem(STORAGE_NOTES, state.pageNotes);
      window.sessionStorage.setItem(STORAGE_UI, JSON.stringify({
        visible: state.notesVisible,
        collapsed: state.notesCollapsed,
        pos: state.notesPos,
        includeComponent: state.includeComponent,
        toolbarPos: state.toolbarPos,
      }));
    } catch (e) { /* ignore */ }
  }

  function load() {
    try {
      var raw = window.sessionStorage.getItem(STORAGE_ANNOTATIONS);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) state.annotations = parsed;
      }
    } catch (e) { /* ignore */ }
    try {
      var notes = window.sessionStorage.getItem(STORAGE_NOTES);
      if (typeof notes === 'string') state.pageNotes = notes;
      var ui = window.sessionStorage.getItem(STORAGE_UI);
      if (ui) {
        var u = JSON.parse(ui);
        if (typeof u.visible === 'boolean') state.notesVisible = u.visible;
        if (typeof u.collapsed === 'boolean') state.notesCollapsed = u.collapsed;
        if (u.pos && u.pos.x != null && u.pos.y != null) {
          state.notesPos = { x: Number(u.pos.x), y: Number(u.pos.y) };
        }
        if (typeof u.includeComponent === 'boolean') state.includeComponent = u.includeComponent;
        if (u.toolbarPos && u.toolbarPos.x != null && u.toolbarPos.y != null) {
          state.toolbarPos = { x: Number(u.toolbarPos.x), y: Number(u.toolbarPos.y) };
        }
      }
    } catch (e) { /* ignore */ }
  }

  function supportsPopover() {
    return typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';
  }

  function asManualPopover(el) {
    if (!el || !supportsPopover()) return;
    if (el.getAttribute('popover') !== 'manual') el.setAttribute('popover', 'manual');
  }

  function openManualPopover(el) {
    if (!el || !supportsPopover()) return;
    try {
      if (!el.matches(':popover-open')) el.showPopover();
    } catch (e) { /* ignore */ }
  }

  function closeManualPopover(el) {
    if (!el || !supportsPopover()) return;
    try {
      if (el.matches(':popover-open')) el.hidePopover();
    } catch (e) { /* ignore */ }
  }

  function createRoot() {
    var root = document.getElementById('ai-live-edit-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'ai-live-edit-root';
      root.style.position = 'fixed';
      root.style.inset = '0';
      root.style.pointerEvents = 'none';
      root.style.zIndex = '2147483647';
      document.documentElement.appendChild(root);
    }
    return root;
  }

  function ensureStyle() {
    if (document.getElementById('ai-live-edit-style')) return;
    var style = document.createElement('style');
    style.id = 'ai-live-edit-style';
    style.textContent = [
      '#ai-live-edit-root .ai-le-toolbar, #ai-live-edit-root .ai-le-toolbar[popover] { position: fixed; inset: unset; right: 16px; bottom: 16px; margin: 0; width: max-content; height: fit-content; overflow: visible; display: flex; flex-direction: column; align-items: stretch; gap: 2px; padding: 8px 10px; border: 1px solid #26262c; border-radius: 12px; background: #141417; color: #e4e4e7; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12px; pointer-events: auto; box-shadow: 0 12px 40px rgba(0,0,0,.45); }',
      '#ai-live-edit-root .ai-le-toolbar-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }',
      '#ai-live-edit-root .ai-le-status:empty { display: none; }',
      '#ai-live-edit-root .ai-le-toolbar button { background: #1a1a1e; border: 1px solid #26262c; color: #e4e4e7; padding: 6px 10px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 500; display: inline-flex; align-items: center; gap: 5px; }',
      '#ai-live-edit-root .ai-le-toolbar button svg { flex-shrink: 0; }',
      '#ai-live-edit-root .ai-le-toolbar button:hover { background: #1f1f24; border-color: #34343e; }',
      '#ai-live-edit-root .ai-le-toolbar button[data-active="true"] { background: rgba(34,197,94,.18); border-color: rgba(34,197,94,.5); color: #bbf7d0; }',
      '#ai-live-edit-root .ai-le-toolbar button:disabled { opacity: .45; cursor: default; }',
      '#ai-live-edit-root .ai-le-drag { cursor: grab; color: #71717a; display: flex; align-items: center; padding: 6px 2px 6px 0; user-select: none; }',
      '#ai-live-edit-root .ai-le-drag:active { cursor: grabbing; }',
      '#ai-live-edit-root .ai-le-toggle > span { display: inline-flex; align-items: center; }',
      '#ai-live-edit-root .ai-le-toggle { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 500; color: #d4d4d8; cursor: pointer; white-space: nowrap; }',
      '#ai-live-edit-root .ai-le-toggle input { accent-color: #3b82f6; cursor: pointer; }',
      '#ai-live-edit-root .ai-le-status { color: #a1a1aa; font-size: 11.5px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '#ai-live-edit-root .ai-le-status[data-error="true"] { color: #fca5a5; }',
      '#ai-live-edit-root .ai-le-error { position: fixed; right: 16px; bottom: 16px; display: flex; align-items: center; gap: 8px; max-width: 340px; padding: 8px 10px; background: #141417; color: #fecaca; border: 1px solid rgba(239,68,68,.4); border-radius: 12px; font-size: 12px; pointer-events: auto; box-shadow: 0 12px 40px rgba(0,0,0,.45); }',
      '#ai-live-edit-root .ai-le-error button { background: #1a1a1e; border: 1px solid #26262c; color: #e4e4e7; padding: 4px 8px; border-radius: 8px; cursor: pointer; font-size: 11px; }',
      '#ai-live-edit-root .ai-le-uimenu { position: fixed; background: #141417; color: #e4e4e7; border: 1px solid #26262c; border-radius: 10px; padding: 6px; min-width: 220px; max-height: 320px; overflow: auto; box-shadow: 0 8px 20px rgba(0,0,0,.45); pointer-events: auto; display: none; font-family: ui-sans-serif, system-ui, sans-serif; }',
      '#ai-live-edit-root .ai-le-uimenu button { display: flex; width: 100%; text-align: left; background: transparent; border: none; padding: 6px 8px; cursor: pointer; font-size: 12px; font-family: inherit; color: #e4e4e7; border-radius: 6px; align-items: center; gap: 8px; }',
      '#ai-live-edit-root .ai-le-uimenu button:hover { background: #26262c; }',
      '#ai-live-edit-root .ai-le-uimenu .ai-le-ui-size { margin-left: auto; color: #71717a; font-size: 11px; font-family: ui-monospace, monospace; }',
      '#ai-live-edit-root .ai-le-place { position: fixed; background: rgba(20, 20, 23, 0.92); border: 2px dashed #3b82f6; border-radius: 10px; pointer-events: auto; box-shadow: 0 4px 16px rgba(0,0,0,.5); display: flex; flex-direction: column; overflow: hidden; resize: both; min-width: 15px; min-height: 15px; }',
      '#ai-live-edit-root .ai-le-place-bar { display: flex; align-items: center; gap: 6px; padding: 4px 6px; background: rgba(59, 130, 246, 0.18); cursor: move; user-select: none; font-size: 12px; font-weight: 600; color: #e4e4e7; flex-shrink: 0; }',
      '#ai-live-edit-root .ai-le-place-bar .ai-le-ui-kind { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '#ai-live-edit-root .ai-le-place-note { flex: 1; background: transparent; border: none; outline: none; resize: none; color: #e4e4e7; font-size: 12px; font-family: ui-sans-serif, system-ui, sans-serif; padding: 6px 8px; min-height: 0; }',
      '#ai-live-edit-root .ai-le-place-note::placeholder { color: #71717a; }',
      '#ai-live-edit-root .ai-le-place .ai-le-close { position: static; margin-left: 0; }',
      '#ai-live-edit-root .ai-le-tag { position: absolute; max-width: 240px; background: #1a1a1e; color: #e4e4e7; border: 1px solid #26262c; border-radius: 10px; padding: 6px 30px 4px 8px; font-size: 12px; pointer-events: auto; box-shadow: 0 4px 12px rgba(0,0,0,.4); }',
      '#ai-live-edit-root .ai-le-tag-content { outline: none; min-height: 16px; white-space: pre-wrap; }',
      '#ai-live-edit-root .ai-le-tag-content:empty:before { content: attr(data-placeholder); color: #71717a; }',
      '#ai-live-edit-root .ai-le-tag-footer { margin-top: 4px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 10px; color: #93c5fd; border-top: 1px dashed #26262c; padding-top: 3px; word-break: break-all; }',
      '#ai-live-edit-root .ai-le-close { position: absolute; top: 4px; right: 4px; margin-left: 0; border: 1px solid #26262c; background: #1a1a1e; border-radius: 6px; padding: 0 6px; line-height: 18px; cursor: pointer; color: #a1a1aa; font-weight: 700; }',
      '#ai-live-edit-root .ai-le-close:hover { color: #fecaca; border-color: rgba(239,68,68,.4); }',
      '#ai-live-edit-root .ai-le-tag[data-source="ai"] { border-color: #3b82f6; }',
      '#ai-live-edit-root .ai-le-highlight { position: fixed; border: 2px solid #3b82f6; border-radius: 6px; box-shadow: 0 0 0 2px rgba(59,130,246,0.2); pointer-events: none; }',
      '#ai-live-edit-root .ai-le-highlight-label { position: fixed; background: #141417; color: #bfdbfe; border: 1px solid rgba(59,130,246,.4); padding: 2px 6px; font-size: 11px; border-radius: 6px; pointer-events: none; font-family: ui-monospace, Menlo, Consolas, monospace; }',
      '#ai-live-edit-root .ai-le-menu { position: fixed; background: #141417; color: #e4e4e7; border: 1px solid #26262c; border-radius: 10px; padding: 6px; min-width: 180px; box-shadow: 0 8px 20px rgba(0,0,0,.45); pointer-events: auto; display: none; font-family: ui-sans-serif, system-ui, sans-serif; }',
      '#ai-live-edit-root .ai-le-menu button { display: block; width: 100%; text-align: left; background: transparent; border: none; padding: 6px 8px; cursor: pointer; font-size: 12px; font-family: inherit; color: #e4e4e7; border-radius: 6px; }',
      '#ai-live-edit-root .ai-le-menu button:hover { background: #1f1f24; }',
      '#ai-live-edit-root .ai-le-notes, #ai-live-edit-root .ai-le-notes[popover] { position: fixed; inset: unset; margin: 0; width: 280px; overflow: visible; background: #141417; color: #e4e4e7; border: 1px solid #26262c; border-radius: 12px; box-shadow: 0 12px 24px rgba(0,0,0,.45); pointer-events: auto; font-family: ui-sans-serif, system-ui, sans-serif; }',
      '#ai-live-edit-root .ai-le-notes-titlebar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; font-size: 12px; font-weight: 600; cursor: move; background: #1a1a1e; color: #e4e4e7; border-bottom: 1px solid #1e1e23; border-top-left-radius: 12px; border-top-right-radius: 12px; font-family: ui-sans-serif, system-ui, sans-serif; }',
      '#ai-live-edit-root .ai-le-notes-titlebar button { background: transparent; border: none; outline: none; color: #a1a1aa; font-size: 11px; font-family: inherit; padding: 4px 6px; border-radius: 6px; cursor: pointer; font-weight: 500; }',
      '#ai-live-edit-root .ai-le-notes-titlebar button:hover { background: #26262c; color: #e4e4e7; }',
      '#ai-live-edit-root .ai-le-notes-titlebar button:focus { outline: none; }',
      '#ai-live-edit-root .ai-le-notes-body { padding: 8px; }',
      '#ai-live-edit-root .ai-le-notes textarea { width: 100%; min-height: 140px; resize: vertical; background: #0f0f12; border: 1px solid #26262c; border-radius: 8px; padding: 6px; font-size: 12px; font-family: ui-sans-serif, system-ui, sans-serif; color: #e4e4e7; box-sizing: border-box; }',
      '#ai-live-edit-root .ai-le-notes textarea:focus { outline: none; border-color: #3b82f6; }',
      '#ai-live-edit-root .ai-le-connector { position: fixed; inset: 0; pointer-events: none; }',
      '#ai-live-edit-root .ai-le-outline { outline: 2px solid #3b82f6 !important; outline-offset: 2px; }',
      '#ai-live-edit-root .ai-le-outline-move { outline: 2px solid #f97316 !important; outline-offset: 2px; }',
      '#ai-live-edit-root .ai-le-tag-move { border-color: #f97316; }',
      '#ai-live-edit-root .ai-le-tag-move .ai-le-tag-footer { color: #fdba74; }',
    ].join('\n');
    document.head.appendChild(style);
  }
  function buildSelector(el) {
    var id = el.getAttribute('id');
    if (id) return '#' + CSS.escape(id);
    var dataKeys = ['data-testid', 'data-test', 'data-cy', 'data-qa'];
    for (var i = 0; i < dataKeys.length; i++) {
      var v = el.getAttribute(dataKeys[i]);
      if (v) return '[' + dataKeys[i] + '="' + CSS.escape(v) + '"]';
    }
    var parts = [];
    var cur = el;
    for (var depth = 0; cur && depth < 4; depth++) {
      var name = cur.tagName.toLowerCase();
      var parent = cur.parentElement;
      if (!parent) { parts.unshift(name); break; }
      var siblings = Array.prototype.slice.call(parent.children);
      var sameTag = siblings.filter(function (c) { return c.tagName === cur.tagName; });
      parts.unshift(name + ':nth-of-type(' + (sameTag.indexOf(cur) + 1) + ')');
      cur = parent;
    }
    return parts.join(' > ');
  }

  function clearTags(root) {
    var tags = root.querySelectorAll('.ai-le-tag');
    for (var i = 0; i < tags.length; i++) tags[i].remove();
  }

  function clearOutlines() {
    var els = document.querySelectorAll('.ai-le-outline, .ai-le-outline-move');
    for (var i = 0; i < els.length; i++) els[i].classList.remove('ai-le-outline', 'ai-le-outline-move');
  }

  function scheduleRender() {
    if (state.scheduled) return;
    state.scheduled = true;
    window.requestAnimationFrame(function () {
      state.scheduled = false;
      render();
    });
  }

  function toggleSelectMode(force) {
    state.selectMode = typeof force === 'boolean' ? force : !state.selectMode;
    syncPickButton();
  }

  function syncPickButton() {
    var btn = document.getElementById('ai-le-btn');
    if (btn) {
      btn.setAttribute('data-active', state.selectMode ? 'true' : 'false');
      btn.innerHTML = ICON_PICK + '<span>' + (state.selectMode ? 'Picking…' : 'Pick') + '</span>';
    }
  }

  function isOverlayTarget(path) {
    for (var i = 0; i < path.length; i++) {
      var n = path[i];
      if (!n) continue;
      if (n.id === 'ai-live-edit-root' || n.id === 'ai-live-chat-host') return true;
      if (n.classList && (
        n.classList.contains('ai-le-toolbar') ||
        n.classList.contains('ai-le-notes') ||
        n.classList.contains('ai-le-menu') ||
        n.classList.contains('ai-le-tag')
      )) return true;
    }
    return false;
  }

  function pickTarget(ev) {
    var path = (ev.composedPath && ev.composedPath()) || [];
    if (isOverlayTarget(path)) return null;
    for (var i = 0; i < path.length; i++) {
      if (path[i] instanceof Element) return path[i];
    }
    return ev.target instanceof Element ? ev.target : null;
  }

  function render() {
    var root = createRoot();
    clearTags(root);
    renderConnectors(root);
    clearOutlines();
    for (var i = 0; i < state.annotations.length; i++) {
      (function (annotation) {
        if (annotation.type === 'placement') return;
        var el = annotation.selector ? document.querySelector(annotation.selector) : null;
        if (!el) return;
        var rect = el.getBoundingClientRect();
        el.classList.add('ai-le-outline');
        var tag = document.createElement('div');
        tag.className = 'ai-le-tag' + (annotation.type === 'move' ? ' ai-le-tag-move' : '');
        tag.setAttribute('data-annotation-id', annotation.id);
        tag.setAttribute('data-source', annotation.source || 'user');
        var content = document.createElement('div');
        content.className = 'ai-le-tag-content';
        content.contentEditable = 'true';
        content.setAttribute('data-placeholder', 'Type a note…');
        content.textContent = annotation.text;
        content.addEventListener('input', function () {
          annotation.text = content.textContent || '';
          save();
          notifyChat(false);
        });
        tag.appendChild(content);
        var close = document.createElement('button');
        close.className = 'ai-le-close';
        close.textContent = '×';
        close.title = 'Delete this annotation';
        close.setAttribute('aria-label', 'Delete this annotation');
        close.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          state.annotations = state.annotations.filter(function (a) { return a.id !== annotation.id; });
          save();
          notifyChat(true);
          scheduleRender();
        });
        tag.appendChild(close);
        var footer = document.createElement('div');
        footer.className = 'ai-le-tag-footer';
        var footerText = annotation.selector;
        if (annotation.component) footerText += ' · ' + annotation.component;
        if (annotation.sourceFile) footerText += ' (' + annotation.sourceFile + ')';
        footer.textContent = footerText;
        tag.appendChild(footer);
        tag.style.left = Math.max(8, rect.left) + 'px';
        tag.style.top = Math.max(8, rect.top - 28) + 'px';
        root.appendChild(tag);
      })(state.annotations[i]);
    }
    renderHighlight(root);
    renderMenu(root);
    renderUiMenu(root);
    renderNotes(root);
    renderPlacements(root);
    syncToolbarCounts();
  }

  function syncToolbarCounts() {
    var notes = 0;
    var rects = 0;
    for (var i = 0; i < state.annotations.length; i++) {
      if (state.annotations[i].type === 'placement') rects++;
      else notes++;
    }
    var notesBtn = document.getElementById('ai-le-notes-btn');
    if (notesBtn) notesBtn.innerHTML = ICON_NOTES + '<span>Notes' + (notes ? ' (' + notes + ')' : '') + '</span>';
    var uiBtn = document.getElementById('ai-le-ui-btn');
    if (uiBtn) uiBtn.innerHTML = ICON_UI + '<span>UI' + (rects ? ' (' + rects + ')' : '') + '</span>';
  }

  function renderPlacements(root) {
    var old = root.querySelectorAll('.ai-le-place');
    for (var i = 0; i < old.length; i++) old[i].remove();
    for (var j = 0; j < state.annotations.length; j++) {
      (function (annotation) {
        if (annotation.type !== 'placement' || !annotation.placement) return;
        var plc = annotation.placement;
        var box = document.createElement('div');
        box.className = 'ai-le-place';
        box.setAttribute('data-annotation-id', annotation.id);
        box.style.left = plc.x + 'px';
        box.style.top = plc.y + 'px';
        box.style.width = plc.width + 'px';
        box.style.height = plc.height + 'px';
        var bar = document.createElement('div');
        bar.className = 'ai-le-place-bar';
        bar.title = 'Drag to move';
        var kind = document.createElement('span');
        kind.className = 'ai-le-ui-kind';
        kind.textContent = plc.label + ' ' + plc.width + '×' + plc.height;
        var close = document.createElement('button');
        close.className = 'ai-le-close';
        close.textContent = '×';
        close.title = 'Delete this rectangle';
        close.setAttribute('aria-label', 'Delete this rectangle');
        close.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          state.annotations = state.annotations.filter(function (a) { return a.id !== annotation.id; });
          save();
          notifyChat(true);
          scheduleRender();
        });
        bar.appendChild(kind);
        bar.appendChild(close);
        var note = document.createElement('textarea');
        note.className = 'ai-le-place-note';
        note.placeholder = 'Specifics for this ' + plc.label + '…';
        note.value = annotation.text || '';
        note.addEventListener('input', function () {
          annotation.text = note.value;
          save();
          notifyChat(false);
        });
        box.appendChild(bar);
        box.appendChild(note);
        root.appendChild(box);
        bar.addEventListener('mousedown', function (ev) {
          if (ev.target === close || close.contains(ev.target)) return;
          ev.preventDefault();
          ev.stopPropagation();
          var startX = ev.clientX;
          var startY = ev.clientY;
          var baseX = plc.x;
          var baseY = plc.y;
          function onMove(moveEv) {
            plc.x = Math.max(0, Math.round(baseX + (moveEv.clientX - startX)));
            plc.y = Math.max(0, Math.round(baseY + (moveEv.clientY - startY)));
            box.style.left = plc.x + 'px';
            box.style.top = plc.y + 'px';
          }
          function onUp() {
            window.removeEventListener('mousemove', onMove, true);
            window.removeEventListener('mouseup', onUp, true);
            annotation.intersects = computeIntersects(plc.x, plc.y, plc.width, plc.height);
            save();
            notifyChat(false);
          }
          window.addEventListener('mousemove', onMove, true);
          window.addEventListener('mouseup', onUp, true);
        });
        if (typeof ResizeObserver !== 'undefined' && !box.dataset.observed) {
          box.dataset.observed = '1';
          var ro = new ResizeObserver(function () {
            var r = box.getBoundingClientRect();
            plc.width = Math.max(15, Math.round(r.width));
            plc.height = Math.max(15, Math.round(r.height));
            kind.textContent = plc.label + ' ' + plc.width + '×' + plc.height;
            save();
          });
          ro.observe(box);
        }
      })(state.annotations[j]);
    }
  }
  function renderHighlight(root) {
    var box = root.querySelector('.ai-le-highlight');
    var label = root.querySelector('.ai-le-highlight-label');
    if (!box) {
      box = document.createElement('div');
      box.className = 'ai-le-highlight';
      root.appendChild(box);
    }
    if (!label) {
      label = document.createElement('div');
      label.className = 'ai-le-highlight-label';
      root.appendChild(label);
    }
    if (!state.selectMode || !state.hoveredSelector) {
      box.style.display = 'none';
      label.style.display = 'none';
      return;
    }
    var el = document.querySelector(state.hoveredSelector);
    if (!el) {
      box.style.display = 'none';
      label.style.display = 'none';
      return;
    }
    var rect = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = rect.left + 'px';
    box.style.top = rect.top + 'px';
    box.style.width = rect.width + 'px';
    box.style.height = rect.height + 'px';
    label.style.display = 'block';
    label.textContent = state.hoveredSelector;
    label.style.left = rect.left + 'px';
    label.style.top = Math.max(4, rect.top - 20) + 'px';
  }

  function openMenu(selector, x, y, fromToolbar) {
    state.menuVisible = true;
    state.menuSelector = selector;
    state.menuX = x;
    state.menuY = y;
    state.menuFromToolbar = !!fromToolbar;
    state.moveArmed = null;
    state.arrowTo = null;
    closeUiMenu();
  }

  function closeMenu() {
    state.menuVisible = false;
    state.menuSelector = null;
    state.menuFromToolbar = false;
  }

  /* Pick button: with a previously picked element, show its menu at the
   * dock; otherwise arm the crosshair picker. */
  function onPickButton() {
    if (state.lastPick) {
      var bar = document.querySelector('#ai-live-edit-root .ai-le-toolbar');
      var r = bar ? bar.getBoundingClientRect() : { left: 16, bottom: 64 };
      openMenu(state.lastPick, Math.max(8, Math.round(r.left)), Math.round(r.bottom) + 8, true);
      scheduleRender();
    } else {
      toggleSelectMode();
    }
  }

  /* Ref button: drop a reference token for the last-picked element straight
   * into the chat input — no menu selection needed. */
  function onRefButton() {
    if (!state.lastPick) {
      setStatus('Pick an element first, then Ref it');
      scheduleRender();
      return;
    }
    var found = null;
    for (var i = 0; i < state.annotations.length; i++) {
      if (state.annotations[i].selector === state.lastPick && state.annotations[i].type !== 'placement') {
        found = state.annotations[i];
        break;
      }
    }
    var text = found && found.text ? found.text : '';
    try {
      var frame = chatFrame();
      if (frame) frame.postMessage({ ns: 'ai-live-chat-insert', text: text, selector: state.lastPick }, '*');
      setStatus('Reference inserted — type in the chat input');
    } catch (e) {
      setStatus('Chat is unreachable — open the AI chat and pick again', true);
    }
    scheduleRender();
  }

  /* UI-rect dropdown: opens up or down depending on space. */
  function toggleUiMenu() {
    if (state.uiMenu) { closeUiMenu(); return; }
    state.uiMenu = true;
    scheduleRender();
  }
  function closeUiMenu() {
    if (!state.uiMenu) return;
    state.uiMenu = false;
    scheduleRender();
  }
  function uiMenuRect() {
    var bar = document.querySelector('#ai-live-edit-root .ai-le-toolbar');
    var r = bar ? bar.getBoundingClientRect() : { left: 16, top: innerHeight - 64, bottom: innerHeight - 16 };
    var estH = Math.min(UI_RECTS.length * 30 + 12, 332);
    var below = innerHeight - r.bottom;
    var openUp = below < estH + 16 && r.top > estH + 16;
    return { left: Math.max(8, Math.min(r.left, innerWidth - 240)), top: openUp ? Math.max(8, r.top - estH - 8) : r.bottom + 8 };
  }

  function addPlacement(def) {
    var w = Math.min(def.w, Math.max(160, innerWidth - 32));
    var h = Math.min(def.h, Math.max(100, innerHeight - 32));
    var x = Math.max(8, Math.round((innerWidth - w) / 2));
    var y = Math.max(8, Math.round((innerHeight - h) / 2));
    var id = 'plc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    var annotation = {
      id: id,
      type: 'placement',
      text: '',
      selector: '',
      createdAt: Date.now(),
      source: 'user',
      userNotes: '',
      placement: {
        kind: def.kind,
        label: def.label,
        x: x,
        y: y,
        width: Math.round(w),
        height: Math.round(h),
        scrollX: Math.round(window.scrollX || 0),
        scrollY: Math.round(window.scrollY || 0),
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      },
      intersects: [],
    };
    annotation.intersects = computeIntersects(x, y, w, h);
    state.annotations.push(annotation);
    save();
    notifyChat(true);
    closeUiMenu();
    setStatus(def.label + ' placed — drag, resize, describe, then Submit');
    scheduleRender();
  }

  /** Selectors of live elements intersecting a viewport rect (for placement context). */
  function computeIntersects(x, y, w, h) {
    var found = [];
    var seen = {};
    try {
      var root = document.getElementById('ai-live-edit-root');
      var chat = document.getElementById('ai-live-chat-host');
      var prev = [];
      var els = [root, chat].filter(Boolean);
      for (var i = 0; i < els.length; i++) {
        prev[i] = els[i].style.display;
        els[i].style.display = 'none';
      }
      var xs = [x + 2, x + w / 2, x + w - 2];
      var ys = [y + 2, y + h / 2, y + h - 2];
      for (var xi = 0; xi < xs.length && found.length < 12; xi++) {
        for (var yi = 0; yi < ys.length && found.length < 12; yi++) {
          var el = document.elementFromPoint(xs[xi], ys[yi]);
          if (el && el !== document.body && el !== document.documentElement) {
            var sel = buildSelector(el);
            if (!seen[sel]) {
              seen[sel] = true;
              found.push(sel);
            }
          }
        }
      }
      for (var j = 0; j < els.length; j++) {
        els[j].style.display = prev[j];
      }
    } catch (e) { /* best effort — intersections stay empty */ }
    return found;
  }

  function pushAnnotation(type, text, selector, targetSelector) {
    var id = 'ann_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    var extra = {};
    if (state.includeComponent) {
      var info = reactInfoFor(document.querySelector(selector));
      if (info) {
        if (info.name) extra.component = info.name;
        if (info.source) extra.sourceFile = info.source;
      }
    }
    state.annotations.push({
      id: id,
      type: type,
      text: text,
      selector: selector,
      targetSelector: targetSelector,
      createdAt: Date.now(),
      source: 'user',
      userNotes: '',
      component: extra.component || undefined,
      sourceFile: extra.sourceFile || undefined,
    });
    save();
    notifyChat(true);
    return id;
  }

  /**
   * Best-effort React component info for an element, via the reconciler
   * fiber (dev builds carry _debugSource with file:line). Returns
   * { name, source } or null when React is absent or unreachable.
   */
  function reactInfoFor(el) {
    try {
      if (!el || !(el instanceof Element)) return null;
      var fiber = null;
      var node = el;
      var guard = 0;
      while (node && !fiber && guard++ < 6) {
        for (var k in node) {
          if (k.indexOf('__reactFiber$') === 0 || k.indexOf('__reactInternalInstance$') === 0) {
            fiber = node[k];
            break;
          }
        }
        node = node.parentElement;
      }
      if (!fiber) return null;
      var name = null;
      var source = null;
      var f = fiber;
      var depth = 0;
      while (f && depth++ < 60) {
        var t = f.elementType || f.type;
        if (t && (typeof t === 'function' || typeof t === 'object')) {
          var n = t.displayName || t.name;
          if (n && n !== 'Fragment' && n !== 'StrictMode' && n !== 'Suspense') {
            if (!name) name = n;
            var ds = f._debugSource;
            if (ds && ds.fileName) {
              source = compactPath(ds.fileName) + (ds.lineNumber ? ':' + ds.lineNumber : '');
              break;
            }
          }
        }
        f = f.return;
      }
      if (!name && !source) return null;
      return { name: name, source: source };
    } catch (e) {
      return null;
    }
  }

  function compactPath(p) {
    var s = String(p || '');
    var i = s.indexOf('/projects/');
    if (i >= 0) return s.slice(i);
    var parts = s.split('/');
    return parts.length > 3 ? parts.slice(-3).join('/') : s;
  }

  // Focus the inline editor of a freshly added tag (replaces window.prompt).
  function focusTag(id) {
    setTimeout(function () {
      try {
        var root = document.getElementById('ai-live-edit-root');
        var content = root && root.querySelector('[data-annotation-id="' + id + '"] .ai-le-tag-content');
        if (content) content.focus();
      } catch (e) { /* ignore */ }
    }, 60);
  }

  function renderUiMenu(root) {
    var menu = root.querySelector('.ai-le-uimenu');
    if (menu) menu.remove();
    var uiBtn = document.getElementById('ai-le-ui-btn');
    if (uiBtn) uiBtn.setAttribute('data-active', state.uiMenu ? 'true' : 'false');
    if (!state.uiMenu) return;
    menu = document.createElement('div');
    menu.className = 'ai-le-uimenu';
    for (var i = 0; i < UI_RECTS.length; i++) {
      (function (def) {
        var item = document.createElement('button');
        var glyph = document.createElement('span');
        glyph.innerHTML = icon(def.icon || '');
        glyph.setAttribute('aria-hidden', 'true');
        glyph.style.display = 'inline-flex';
        var label = document.createElement('span');
        label.textContent = def.label;
        var size = document.createElement('span');
        size.className = 'ai-le-ui-size';
        size.textContent = def.w + '×' + def.h;
        item.appendChild(glyph);
        item.appendChild(label);
        item.appendChild(size);
        item.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          addPlacement(def);
        });
        menu.appendChild(item);
      })(UI_RECTS[i]);
    }
    root.appendChild(menu);
    var pos = uiMenuRect();
    menu.style.left = pos.left + 'px';
    menu.style.top = pos.top + 'px';
    menu.style.display = 'block';
  }

  function renderMenu(root) {
    var menu = root.querySelector('.ai-le-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'ai-le-menu';
      root.appendChild(menu);
    }
    menu.innerHTML = '';
    if (!state.menuVisible || !state.menuSelector) {
      menu.style.display = 'none';
      return;
    }
    menu.style.display = 'block';
    menu.style.left = state.menuX + 'px';
    menu.style.top = state.menuY + 'px';
    (function (selector) {
      function addButton(label, onClick) {
        var btn = document.createElement('button');
        btn.textContent = label;
        btn.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          onClick();
          closeMenu();
          scheduleRender();
        });
        menu.appendChild(btn);
      }
      addButton('Add note', function () {
        focusTag(pushAnnotation('note', '', selector));
      });
      addButton('Move element', function () {
        var id = pushAnnotation('move', '', selector);
        state.moveArmed = id;
        state.arrowTo = null;
        setStatus('Move: click the target area — Esc to cancel');
      });
      addButton('Delete annotations for element', function () {
        state.annotations = state.annotations.filter(function (a) { return a.selector !== selector; });
        save();
        notifyChat(true);
      });
      if (state.menuFromToolbar) {
        addButton('Pick a different element', function () { toggleSelectMode(true); });
      }
      addButton('Exit picker', function () { toggleSelectMode(false); });
    })(state.menuSelector);
  }

  function renderConnectors(root) {
    var svg = root.querySelector('.ai-le-connector');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'ai-le-connector');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      root.appendChild(svg);
    }
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    function addLine(x1, y1, x2, y2, color, marker) {
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(x1));
      line.setAttribute('y1', String(y1));
      line.setAttribute('x2', String(x2));
      line.setAttribute('y2', String(y2));
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '2');
      line.setAttribute('marker-end', marker || 'url(#ai-le-arrow-pick)');
      svg.appendChild(line);
    }
    var defs = svg.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      defs.appendChild(makeMarker('ai-le-arrow-pick', '#f97316'));
      svg.appendChild(defs);
    }
    function makeMarker(id, fill) {
      var marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', id);
      marker.setAttribute('markerWidth', '10');
      marker.setAttribute('markerHeight', '10');
      marker.setAttribute('refX', '8');
      marker.setAttribute('refY', '3');
      marker.setAttribute('orient', 'auto');
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M0,0 L8,3 L0,6 Z');
      path.setAttribute('fill', fill);
      marker.appendChild(path);
      return marker;
    }
    for (var i = 0; i < state.annotations.length; i++) {
      var ann = state.annotations[i];
      if (ann.type !== 'move' || !ann.targetSelector) continue;
      var sourceEl = document.querySelector(ann.selector);
      var targetEl = document.querySelector(ann.targetSelector);
      if (!sourceEl || !targetEl) continue;
      var s = sourceEl.getBoundingClientRect();
      var t = targetEl.getBoundingClientRect();
      addLine(s.right, s.top + s.height / 2, t.left, t.top + t.height / 2, '#f97316', 'url(#ai-le-arrow-pick)');
    }
    if (state.moveArmed && state.arrowTo) {
      var armed = null;
      for (var j = 0; j < state.annotations.length; j++) {
        if (state.annotations[j].id === state.moveArmed) { armed = state.annotations[j]; break; }
      }
      var fromEl = armed && document.querySelector(armed.selector);
      if (fromEl) {
        var r = fromEl.getBoundingClientRect();
        addLine(r.right, r.top + r.height / 2, state.arrowTo.x, state.arrowTo.y, '#f97316', 'url(#ai-le-arrow-pick)');
      }
    }
  }

  function renderNotes(root) {
    var panel = root.querySelector('.ai-le-notes');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'ai-le-notes';
      var titlebar = document.createElement('div');
      titlebar.className = 'ai-le-notes-titlebar';
      var title = document.createElement('div');
      title.textContent = 'Page notes';
      var controls = document.createElement('div');
      var collapseBtn = document.createElement('button');
      collapseBtn.textContent = 'Collapse';
      collapseBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        state.notesCollapsed = !state.notesCollapsed;
        saveNotes();
        scheduleRender();
      });
      var closeBtn = document.createElement('button');
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        state.notesVisible = false;
        saveNotes();
        scheduleRender();
      });
      controls.appendChild(collapseBtn);
      controls.appendChild(closeBtn);
      titlebar.appendChild(title);
      titlebar.appendChild(controls);
      var body = document.createElement('div');
      body.className = 'ai-le-notes-body';
      var textarea = document.createElement('textarea');
      textarea.placeholder = 'Notes about the whole page...';
      textarea.value = state.pageNotes;
      textarea.addEventListener('input', function () {
        state.pageNotes = textarea.value;
        saveNotes();
        notifyChat(false);
      });
      body.appendChild(textarea);
      titlebar.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var startX = ev.clientX;
        var startY = ev.clientY;
        var startPos = { x: state.notesPos.x, y: state.notesPos.y };
        (function (p) {
          function onMove(moveEv) {
            state.notesPos = {
              x: Math.max(8, startPos.x + (moveEv.clientX - startX)),
              y: Math.max(8, startPos.y + (moveEv.clientY - startY)),
            };
            p.style.left = state.notesPos.x + 'px';
            p.style.top = state.notesPos.y + 'px';
          }
          function onUp() {
            window.removeEventListener('mousemove', onMove, true);
            window.removeEventListener('mouseup', onUp, true);
            saveNotes();
          }
          window.addEventListener('mousemove', onMove, true);
          window.addEventListener('mouseup', onUp, true);
        })(panel);
      });
      panel.appendChild(titlebar);
      panel.appendChild(body);
      asManualPopover(panel);
      root.appendChild(panel);
    }
    panel.style.left = state.notesPos.x + 'px';
    panel.style.top = state.notesPos.y + 'px';
    if (supportsPopover()) {
      if (state.notesVisible) openManualPopover(panel);
      else closeManualPopover(panel);
    } else {
      panel.style.display = state.notesVisible ? 'block' : 'none';
    }
    var cb = panel.querySelector('.ai-le-notes-titlebar button');
    if (cb) cb.textContent = state.notesCollapsed ? 'Expand' : 'Collapse';
    var bd = panel.querySelector('.ai-le-notes-body');
    if (bd) {
      bd.style.display = state.notesCollapsed ? 'none' : 'block';
      var ta = bd.querySelector('textarea');
      if (ta && ta.value !== state.pageNotes) ta.value = state.pageNotes;
    }
  }

  function handleMouseMove(ev) {
    if (state.moveArmed) {
      state.arrowTo = { x: ev.clientX, y: ev.clientY };
      var hover = pickTarget(ev);
      state.hoveredSelector = hover ? buildSelector(hover) : null;
      scheduleRender();
      return;
    }
    if (!state.selectMode) return;
    var target = pickTarget(ev);
    state.hoveredSelector = target ? buildSelector(target) : null;
    scheduleRender();
  }

  function handleSelect(ev) {
    if (state.uiMenu) {
      var t = ev.target;
      if (!(t instanceof Element) || (!t.closest('.ai-le-uimenu') && !t.closest('#ai-le-ui-btn'))) {
        closeUiMenu();
      }
    }
    if (state.moveArmed) {
      var moveTarget = pickTarget(ev);
      if (!moveTarget) return;
      ev.preventDefault();
      ev.stopPropagation();
      var selector = buildSelector(moveTarget);
      for (var i = 0; i < state.annotations.length; i++) {
        if (state.annotations[i].id === state.moveArmed) {
          state.annotations[i].targetSelector = selector;
          save();
          break;
        }
      }
      state.moveArmed = null;
      state.arrowTo = null;
      setStatus('Move target set: ' + abbrSelector(selector));
      notifyChat(true);
      scheduleRender();
      return;
    }
    if (!state.selectMode) return;
    var target = pickTarget(ev);
    if (!target) return;
    ev.preventDefault();
    ev.stopPropagation();
    state.lastPick = buildSelector(target);
    openMenu(state.lastPick, ev.clientX, ev.clientY);
    toggleSelectMode(false);
    setStatus('Selected ' + abbrSelector(state.lastPick) + ' — pick an action');
    notifyChat(true);
    scheduleRender();
  }

  function handleContextMenu(ev) {
    if (!state.selectMode) {
      toggleSelectMode(true);
      state.menuVisible = false;
      ev.preventDefault();
      ev.stopPropagation();
      handleMouseMove(ev);
      return;
    }
    handleSelect(ev);
  }

  function handleKeydown(ev) {
    if (ev.key === 'Escape') {
      state.selectMode = false;
      state.moveArmed = null;
      state.arrowTo = null;
      closeMenu();
      closeUiMenu();
      setStatus('');
      scheduleRender();
    }
  }

  function submitNotesToLauncher() {
    var base = window.__AI_LIVE_LAUNCHER__;
    if (!base) {
      setStatus('Submit needs the launcher URL', true);
      return;
    }
    var payload = {
      annotations: state.annotations
        .filter(function (a) {
          if (a.type === 'placement') return true;
          return (a.text || '').trim();
        })
        .map(function (a) {
          var out = { id: a.id, type: a.type, text: a.text, selector: a.selector };
          if (a.targetSelector) out.targetSelector = a.targetSelector;
          if (a.component) out.component = a.component;
          if (a.sourceFile) out.sourceFile = a.sourceFile;
          if (a.type === 'placement' && a.placement) {
            a.intersects = computeIntersects(a.placement.x, a.placement.y, a.placement.width, a.placement.height);
            out.placement = {
              componentType: a.placement.label,
              kind: a.placement.kind,
              x: a.placement.x + a.placement.scrollX,
              y: a.placement.y + a.placement.scrollY,
              width: a.placement.width,
              height: a.placement.height,
              viewportWidth: a.placement.viewportWidth,
              viewportHeight: a.placement.viewportHeight,
            };
            out.intersects = a.intersects;
          }
          return out;
        }),
      pageNotes: state.pageNotes || '',
      url: location.href,
    };
    if (!payload.annotations.length && !payload.pageNotes) {
      setStatus('No notes yet — pick an element first', true);
      return;
    }
    setStatus('Sending…');
    fetch(String(base).replace(/\/$/, '') + '/api/live-edit/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data && data.ok) {
        state.annotations = [];
        state.pageNotes = '';
        state.lastPick = null;
        save();
        saveNotes();
        notifyChat(true);
        setStatus('Sent ' + (data.annotationCount || 0) + ' note(s)');
        scheduleRender();
      } else {
        setStatus('Submit failed: ' + ((data && data.error) || 'unknown'), true);
      }
    }).catch(function (err) {
      setStatus('Submit failed: ' + (err && err.message ? err.message : String(err)), true);
    });
  }

  function applyToolbarPos(toolbar) {
    if (state.toolbarPos) {
      toolbar.style.left = state.toolbarPos.x + 'px';
      toolbar.style.top = state.toolbarPos.y + 'px';
      toolbar.style.right = 'auto';
      toolbar.style.bottom = 'auto';
    }
  }

  function createToolbar() {
    var root = createRoot();
    var toolbar = root.querySelector('.ai-le-toolbar');
    if (toolbar) {
      syncPickButton();
      applyToolbarPos(toolbar);
      return;
    }
    toolbar = document.createElement('div');
    toolbar.className = 'ai-le-toolbar';
    var row = document.createElement('div');
    row.className = 'ai-le-toolbar-row';
    toolbar.appendChild(row);
    var grip = document.createElement('div');
    grip.className = 'ai-le-drag';
    grip.innerHTML = ICON_GRIP;
    grip.title = 'Drag to move the toolbar';
    grip.addEventListener('mousedown', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var rect = toolbar.getBoundingClientRect();
      var startX = ev.clientX;
      var startY = ev.clientY;
      var baseLeft = rect.left;
      var baseTop = rect.top;
      function onMove(moveEv) {
        var x = Math.max(8, baseLeft + (moveEv.clientX - startX));
        var y = Math.max(8, baseTop + (moveEv.clientY - startY));
        toolbar.style.left = x + 'px';
        toolbar.style.top = y + 'px';
        toolbar.style.right = 'auto';
        toolbar.style.bottom = 'auto';
      }
      function onUp(upEv) {
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mouseup', onUp, true);
        var r = toolbar.getBoundingClientRect();
        state.toolbarPos = { x: Math.max(8, Math.round(r.left)), y: Math.max(8, Math.round(r.top)) };
        saveNotes();
      }
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mouseup', onUp, true);
    });
    var status = document.createElement('div');
    status.className = 'ai-le-status';
    var btn = document.createElement('button');
    btn.id = 'ai-le-btn';
    btn.innerHTML = ICON_PICK + '<span>Pick</span>';
    btn.title = 'Pick an element on the page to annotate';
    btn.setAttribute('data-active', 'false');
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      onPickButton();
    });
    var refBtn = document.createElement('button');
    refBtn.id = 'ai-le-ref-btn';
    refBtn.innerHTML = ICON_REF + '<span>Ref</span>';
    refBtn.title = 'Insert a reference chip for the last-picked element into the chat input';
    refBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      onRefButton();
    });
    var notesBtn = document.createElement('button');
    notesBtn.id = 'ai-le-notes-btn';
    notesBtn.innerHTML = ICON_NOTES + '<span>Notes</span>';
    notesBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      state.notesVisible = !state.notesVisible;
      saveNotes();
      notifyChat(true);
      scheduleRender();
    });
    var componentToggle = document.createElement('label');
    componentToggle.className = 'ai-le-toggle';
    componentToggle.title = 'Attach the React component name and source file to new annotations';
    var componentBox = document.createElement('input');
    componentBox.type = 'checkbox';
    componentBox.checked = state.includeComponent !== false;
    componentBox.addEventListener('change', function () {
      state.includeComponent = componentBox.checked;
      saveNotes();
      setStatus(componentBox.checked ? 'React component info on' : 'React component info off');
    });
    var componentText = document.createElement('span');
    componentText.innerHTML = ICON_COMPONENT + '<span style="margin-left:5px">Component</span>';
    componentToggle.appendChild(componentBox);
    componentToggle.appendChild(componentText);
    var uiBtn = document.createElement('button');
    uiBtn.id = 'ai-le-ui-btn';
    uiBtn.innerHTML = ICON_UI + '<span>UI</span>';
    uiBtn.title = 'Place a generic UI rectangle for the agent to style and fill';
    uiBtn.setAttribute('data-active', 'false');
    uiBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      toggleUiMenu();
    });
    row.appendChild(grip);
    row.appendChild(btn);
    row.appendChild(refBtn);
    row.appendChild(notesBtn);
    row.appendChild(uiBtn);
    row.appendChild(componentToggle);
    toolbar.appendChild(status);
    if (window.__AI_LIVE_LAUNCHER__) {
      var submitBtn = document.createElement('button');
      submitBtn.id = 'ai-le-submit-btn';
      submitBtn.innerHTML = ICON_SUBMIT + '<span>Submit</span>';
      submitBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        submitNotesToLauncher();
      });
      row.appendChild(submitBtn);
    }
    var clearBtn = document.createElement('button');
    clearBtn.id = 'ai-le-clear-btn';
    clearBtn.innerHTML = ICON_TRASH + '<span>Clear</span>';
    clearBtn.title = 'Delete all annotations and rectangles';
    clearBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var n = state.annotations.length;
      if (!n) {
        setStatus('Nothing to clear');
        scheduleRender();
        return;
      }
      state.annotations = [];
      state.moveArmed = null;
      state.arrowTo = null;
      save();
      notifyChat(true);
      setStatus('Cleared ' + n + ' annotation' + (n === 1 ? '' : 's'));
      scheduleRender();
    });
    row.appendChild(clearBtn);
    applyToolbarPos(toolbar);
    syncPickButton();
    asManualPopover(toolbar);
    root.appendChild(toolbar);
    openManualPopover(toolbar);
  }

  ensureStyle();
  createRoot();
  createToolbar();
  load();
  render();

  window.addEventListener('scroll', scheduleRender, true);
  window.addEventListener('resize', scheduleRender);
  window.addEventListener('mousemove', handleMouseMove, true);
  window.addEventListener('click', handleSelect, true);
  window.addEventListener('contextmenu', handleContextMenu, true);
  window.addEventListener('keydown', handleKeydown, true);
  window.addEventListener('message', handleChatCommand);
  // Late-joining chat iframe asks; answer with the current digest.
  window.addEventListener('message', function (ev) {
    var data = ev && ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.ns === 'ai-live-chat-hello' && ev.source) {
      try { ev.source.postMessage(buildDigest(), '*'); } catch (e) { /* ignore */ }
    }
  });

  window.__AI_LIVE_EDIT__ = {
    version: 1,
    installed: true,
    popover: supportsPopover(),
    state: state,
    baselineWireframeJson: null,
    enableSelectMode: function () { if (!state.selectMode) toggleSelectMode(); notifyChat(true); },
    disableSelectMode: function () { toggleSelectMode(false); },
    setToolbarOffset: function (rightPx) {
      if (state.toolbarPos) return;
      var toolbar = document.querySelector('#ai-live-edit-root .ai-le-toolbar');
      if (toolbar) toolbar.style.right = Number(rightPx) + 'px';
    },
    addAnnotation: function (annotation) {
      if (!annotation || !annotation.selector || !annotation.text) return false;
      state.annotations.push({
        id: 'ann_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
        type: annotation.type || 'note',
        text: annotation.text,
        selector: annotation.selector,
        createdAt: Date.now(),
        source: annotation.source || 'user',
        userNotes: '',
      });
      save();
      scheduleRender();
      return true;
    },
    exportAnnotations: function () { return state.annotations.slice(); },
    importAnnotations: function (data) {
      if (Array.isArray(data)) {
        state.annotations = data;
        save();
        scheduleRender();
        return true;
      }
      return false;
    },
    clearAnnotations: function () {
      state.annotations = [];
      save();
      notifyChat(true);
      clearOutlines();
      scheduleRender();
    },
    getPageNotes: function () { return state.pageNotes; },
    setPageNotes: function (value) {
      state.pageNotes = value || '';
      saveNotes();
      scheduleRender();
    },
    clearAll: function () {
      state.annotations = [];
      state.pageNotes = '';
      state.lastPick = null;
      state.notesVisible = false;
      state.notesCollapsed = false;
      save();
      saveNotes();
      notifyChat(true);
      clearOutlines();
      scheduleRender();
    },
  };
})();
