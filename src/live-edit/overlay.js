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
    dragLink: null,
    notifyAt: 0,
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
        return { id: a.id, selector: a.selector, abbr: abbrSelector(a.selector), text: a.text || '' };
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
      '#ai-live-edit-root .ai-le-toolbar, #ai-live-edit-root .ai-le-toolbar[popover] { position: fixed; inset: unset; right: 16px; bottom: 16px; margin: 0; width: max-content; height: fit-content; overflow: visible; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid #26262c; border-radius: 12px; background: #141417; color: #e4e4e7; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12px; pointer-events: auto; box-shadow: 0 12px 40px rgba(0,0,0,.45); }',
      '#ai-live-edit-root .ai-le-toolbar button { background: #1a1a1e; border: 1px solid #26262c; color: #e4e4e7; padding: 6px 10px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 500; }',
      '#ai-live-edit-root .ai-le-toolbar button:hover { background: #1f1f24; border-color: #34343e; }',
      '#ai-live-edit-root .ai-le-toolbar button[data-active="true"] { background: rgba(34,197,94,.18); border-color: rgba(34,197,94,.5); color: #bbf7d0; }',
      '#ai-live-edit-root .ai-le-toolbar button:disabled { opacity: .45; cursor: default; }',
      '#ai-live-edit-root .ai-le-label { font-weight: 600; }',
      '#ai-live-edit-root .ai-le-status { color: #a1a1aa; font-size: 11.5px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '#ai-live-edit-root .ai-le-status[data-error="true"] { color: #fca5a5; }',
      '#ai-live-edit-root .ai-le-error { position: fixed; right: 16px; bottom: 16px; display: flex; align-items: center; gap: 8px; max-width: 340px; padding: 8px 10px; background: #141417; color: #fecaca; border: 1px solid rgba(239,68,68,.4); border-radius: 12px; font-size: 12px; pointer-events: auto; box-shadow: 0 12px 40px rgba(0,0,0,.45); }',
      '#ai-live-edit-root .ai-le-error button { background: #1a1a1e; border: 1px solid #26262c; color: #e4e4e7; padding: 4px 8px; border-radius: 8px; cursor: pointer; font-size: 11px; }',
      '#ai-live-edit-root .ai-le-tag { position: absolute; max-width: 240px; background: #1a1a1e; color: #e4e4e7; border: 1px solid #26262c; border-radius: 10px; padding: 6px 8px 4px; font-size: 12px; pointer-events: auto; box-shadow: 0 4px 12px rgba(0,0,0,.4); }',
      '#ai-live-edit-root .ai-le-tag-content { outline: none; min-height: 16px; white-space: pre-wrap; }',
      '#ai-live-edit-root .ai-le-tag-content:empty:before { content: attr(data-placeholder); color: #71717a; }',
      '#ai-live-edit-root .ai-le-tag-footer { margin-top: 4px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 10px; color: #93c5fd; border-top: 1px dashed #26262c; padding-top: 3px; word-break: break-all; }',
      '#ai-live-edit-root .ai-le-close { margin-left: 8px; border: 1px solid #26262c; background: #1a1a1e; border-radius: 6px; padding: 0 6px; line-height: 18px; cursor: pointer; color: #a1a1aa; font-weight: 700; }',
      '#ai-live-edit-root .ai-le-close:hover { color: #fecaca; border-color: rgba(239,68,68,.4); }',
      '#ai-live-edit-root .ai-le-tag[data-source="ai"] { border-color: #3b82f6; }',
      '#ai-live-edit-root .ai-le-highlight { position: fixed; border: 2px solid #3b82f6; border-radius: 6px; box-shadow: 0 0 0 2px rgba(59,130,246,0.2); pointer-events: none; }',
      '#ai-live-edit-root .ai-le-highlight-label { position: fixed; background: #141417; color: #bfdbfe; border: 1px solid rgba(59,130,246,.4); padding: 2px 6px; font-size: 11px; border-radius: 6px; pointer-events: none; font-family: ui-monospace, Menlo, Consolas, monospace; }',
      '#ai-live-edit-root .ai-le-menu { position: fixed; background: #141417; color: #e4e4e7; border: 1px solid #26262c; border-radius: 10px; padding: 6px; min-width: 180px; box-shadow: 0 8px 20px rgba(0,0,0,.45); pointer-events: auto; display: none; }',
      '#ai-live-edit-root .ai-le-menu button { display: block; width: 100%; text-align: left; background: transparent; border: none; padding: 6px 8px; cursor: pointer; font-size: 12px; color: #e4e4e7; border-radius: 6px; }',
      '#ai-live-edit-root .ai-le-menu button:hover { background: #1f1f24; }',
      '#ai-live-edit-root .ai-le-notes, #ai-live-edit-root .ai-le-notes[popover] { position: fixed; inset: unset; margin: 0; width: 280px; overflow: visible; background: #141417; color: #e4e4e7; border: 1px solid #26262c; border-radius: 12px; box-shadow: 0 12px 24px rgba(0,0,0,.45); pointer-events: auto; }',
      '#ai-live-edit-root .ai-le-notes-titlebar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; font-size: 12px; font-weight: 600; cursor: move; background: #1a1a1e; color: #e4e4e7; border-bottom: 1px solid #1e1e23; border-top-left-radius: 12px; border-top-right-radius: 12px; }',
      '#ai-live-edit-root .ai-le-notes-titlebar button { background: #1a1a1e; border: 1px solid #26262c; color: #e4e4e7; font-size: 11px; padding: 4px 6px; border-radius: 6px; cursor: pointer; }',
      '#ai-live-edit-root .ai-le-notes-titlebar button:hover { background: #1f1f24; }',
      '#ai-live-edit-root .ai-le-notes-body { padding: 8px; }',
      '#ai-live-edit-root .ai-le-notes textarea { width: 100%; min-height: 140px; resize: vertical; background: #0f0f12; border: 1px solid #26262c; border-radius: 8px; padding: 6px; font-size: 12px; font-family: ui-sans-serif, system-ui, sans-serif; color: #e4e4e7; box-sizing: border-box; }',
      '#ai-live-edit-root .ai-le-notes textarea:focus { outline: none; border-color: #3b82f6; }',
      '#ai-live-edit-root .ai-le-connector { position: fixed; inset: 0; pointer-events: none; }',
      '#ai-live-edit-root .ai-le-port { display: inline-flex; align-items: center; justify-content: center; width: 12px; height: 12px; border-radius: 999px; background: #141417; border: 2px solid #ef4444; margin-left: 8px; cursor: crosshair; }',
      '#ai-live-edit-root .ai-le-port-inner { width: 4px; height: 4px; border-radius: 999px; background: #ef4444; }',
      '#ai-live-edit-root .ai-le-outline { outline: 2px solid #3b82f6 !important; outline-offset: 2px; }',
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
    var els = document.querySelectorAll('.ai-le-outline');
    for (var i = 0; i < els.length; i++) els[i].classList.remove('ai-le-outline');
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
    var btn = document.getElementById('ai-le-btn');
    if (btn) {
      btn.setAttribute('data-active', state.selectMode ? 'true' : 'false');
      btn.textContent = state.selectMode ? 'Click element' : 'Add note';
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

  function elementFromPointIgnoringOverlay(x, y) {
    var root = document.getElementById('ai-live-edit-root');
    var chat = document.getElementById('ai-live-chat-host');
    var toolbar = root ? root.querySelector('.ai-le-toolbar') : null;
    var notes = root ? root.querySelector('.ai-le-notes') : null;
    var els = [root, chat, toolbar, notes].filter(Boolean);
    var prev = [];
    for (var i = 0; i < els.length; i++) {
      prev[i] = els[i].style.pointerEvents;
      els[i].style.pointerEvents = 'none';
    }
    var el = document.elementFromPoint(x, y);
    for (var j = 0; j < els.length; j++) {
      els[j].style.pointerEvents = prev[j];
    }
    return el;
  }

  function render() {
    var root = createRoot();
    clearTags(root);
    renderConnectors(root);
    clearOutlines();
    for (var i = 0; i < state.annotations.length; i++) {
      (function (annotation) {
        var el = document.querySelector(annotation.selector);
        if (!el) return;
        var rect = el.getBoundingClientRect();
        el.classList.add('ai-le-outline');
        var tag = document.createElement('div');
        tag.className = 'ai-le-tag';
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
        if (annotation.type === 'move') {
          var port = document.createElement('span');
          port.className = 'ai-le-port';
          port.title = 'Drag onto the move target';
          var inner = document.createElement('span');
          inner.className = 'ai-le-port-inner';
          port.appendChild(inner);
          port.addEventListener('mousedown', function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            var r = el.getBoundingClientRect();
            state.dragLink = {
              annotationId: annotation.id,
              startX: r.right,
              startY: r.top + r.height / 2,
              currentX: ev.clientX,
              currentY: ev.clientY,
            };
            scheduleRender();
          });
          tag.appendChild(port);
        }
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
        footer.textContent = annotation.selector;
        tag.appendChild(footer);
        tag.style.left = Math.max(8, rect.left) + 'px';
        tag.style.top = Math.max(8, rect.top - 28) + 'px';
        root.appendChild(tag);
      })(state.annotations[i]);
    }
    renderHighlight(root);
    renderMenu(root);
    renderNotes(root);
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

  function openMenu(selector, x, y) {
    state.menuVisible = true;
    state.menuSelector = selector;
    state.menuX = x;
    state.menuY = y;
  }

  function closeMenu() {
    state.menuVisible = false;
    state.menuSelector = null;
  }

  function pushAnnotation(type, text, selector, targetSelector) {
    var id = 'ann_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    state.annotations.push({
      id: id,
      type: type,
      text: text,
      selector: selector,
      targetSelector: targetSelector,
      createdAt: Date.now(),
      source: 'user',
      userNotes: '',
    });
    save();
    notifyChat(true);
    return id;
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
      addButton('Move this here', function () {
        focusTag(pushAnnotation('move', '', selector));
        setStatus('Drag the red port onto the move target');
      });
      addButton('Delete annotations for element', function () {
        state.annotations = state.annotations.filter(function (a) { return a.selector !== selector; });
        save();
        notifyChat(true);
      });
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
    function addLine(x1, y1, x2, y2, color) {
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(x1));
      line.setAttribute('y1', String(y1));
      line.setAttribute('x2', String(x2));
      line.setAttribute('y2', String(y2));
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '2');
      line.setAttribute('marker-end', 'url(#ai-le-arrow)');
      svg.appendChild(line);
    }
    var defs = svg.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      var marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', 'ai-le-arrow');
      marker.setAttribute('markerWidth', '10');
      marker.setAttribute('markerHeight', '10');
      marker.setAttribute('refX', '8');
      marker.setAttribute('refY', '3');
      marker.setAttribute('orient', 'auto');
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M0,0 L8,3 L0,6 Z');
      path.setAttribute('fill', '#ef4444');
      marker.appendChild(path);
      defs.appendChild(marker);
      svg.appendChild(defs);
    }
    for (var i = 0; i < state.annotations.length; i++) {
      var ann = state.annotations[i];
      if (ann.type !== 'move' || !ann.targetSelector) continue;
      var sourceEl = document.querySelector(ann.selector);
      var targetEl = document.querySelector(ann.targetSelector);
      if (!sourceEl || !targetEl) continue;
      var s = sourceEl.getBoundingClientRect();
      var t = targetEl.getBoundingClientRect();
      addLine(s.right, s.top + s.height / 2, t.left, t.top + t.height / 2, '#ef4444');
    }
    if (state.dragLink) {
      addLine(state.dragLink.startX, state.dragLink.startY, state.dragLink.currentX, state.dragLink.currentY, '#f97316');
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
    if (state.dragLink) {
      state.dragLink.currentX = ev.clientX;
      state.dragLink.currentY = ev.clientY;
      scheduleRender();
      return;
    }
    if (!state.selectMode) return;
    var target = pickTarget(ev);
    state.hoveredSelector = target ? buildSelector(target) : null;
    scheduleRender();
  }

  function handleSelect(ev) {
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

  function handleMouseUp(ev) {
    if (!state.dragLink) return;
    ev.preventDefault();
    ev.stopPropagation();
    var target = elementFromPointIgnoringOverlay(ev.clientX, ev.clientY);
    if (target && target instanceof Element) {
      var selector = buildSelector(target);
      for (var i = 0; i < state.annotations.length; i++) {
        if (state.annotations[i].id === state.dragLink.annotationId) {
          state.annotations[i].targetSelector = selector;
          save();
          break;
        }
      }
    }
    state.dragLink = null;
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
      closeMenu();
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
      annotations: state.annotations.filter(function (a) { return (a.text || '').trim(); }),
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

  function createToolbar() {
    var root = createRoot();
    var toolbar = root.querySelector('.ai-le-toolbar');
    if (toolbar) return;
    toolbar = document.createElement('div');
    toolbar.className = 'ai-le-toolbar';
    var label = document.createElement('div');
    label.className = 'ai-le-label';
    label.textContent = 'Live editing';
    var status = document.createElement('div');
    status.className = 'ai-le-status';
    var btn = document.createElement('button');
    btn.id = 'ai-le-btn';
    btn.textContent = 'Add note';
    btn.setAttribute('data-active', 'false');
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      toggleSelectMode();
    });
    var notesBtn = document.createElement('button');
    notesBtn.id = 'ai-le-notes-btn';
    notesBtn.textContent = 'Notes';
    notesBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      state.notesVisible = !state.notesVisible;
      saveNotes();
      notifyChat(true);
      scheduleRender();
    });
    toolbar.appendChild(label);
    toolbar.appendChild(status);
    toolbar.appendChild(btn);
    toolbar.appendChild(notesBtn);
    if (window.__AI_LIVE_LAUNCHER__) {
      var submitBtn = document.createElement('button');
      submitBtn.id = 'ai-le-submit-btn';
      submitBtn.textContent = 'Submit notes';
      submitBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        submitNotesToLauncher();
      });
      toolbar.appendChild(submitBtn);
    }
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
  window.addEventListener('mouseup', handleMouseUp, true);
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
