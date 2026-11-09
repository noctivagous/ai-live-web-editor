/**
 * Accessibility-style text snapshot for the live page.
 * Same idea as chrome-devtools-mcp take_snapshot, but handles are CSS
 * selectors (for patch-dom) instead of Puppeteer uids. No imports/exports.
 */
function capturePageSnapshot(payload, document) {
  payload = payload || {}
  var verbose = Boolean(payload.verbose)
  var maxNodes = Math.max(1, Math.min(800, Number(payload.maxNodes || (verbose ? 400 : 180))))
  var textMax = Math.max(1000, Math.min(20000, Number(payload.textMax || 12000)))
  var root = payload.scopeSelector
    ? document.querySelector(String(payload.scopeSelector))
    : (document.body || document.documentElement)
  if (!root) {
    var sel = payload.scopeSelector ? String(payload.scopeSelector) : ''
    return { ok: false, error: sel ? ('snapshot root not found for scopeSelector "' + sel + '" — drop scopeSelector for the whole page, or run page-sections first for a valid selector') : 'snapshot root not found: the page has no body yet — open the app and retry once it loads' }
  }
  var t0 = Date.now()
  var lines = []
  var count = 0
  var truncated = false
  var nodeCapped = false
  var uid = 0

  function cssPath(el) {
    if (typeof liveCssPath === 'function') return liveCssPath(el)
    var parts = []
    var n = el
    while (n && n.nodeType === 1 && parts.length < 8) {
      if (n.id) {
        parts.unshift('#' + n.id)
        break
      }
      var tag = String(n.tagName || '').toLowerCase()
      var parent = n.parentElement
      if (!parent) {
        parts.unshift(tag)
        break
      }
      var same = []
      for (var i = 0; i < parent.children.length; i++) {
        if (parent.children[i].tagName === n.tagName) same.push(parent.children[i])
      }
      var idx = same.indexOf(n) + 1
      parts.unshift(same.length > 1 ? tag + ':nth-of-type(' + idx + ')' : tag)
      n = parent
    }
    return parts.join('>')
  }

  function skipHost(el) {
    var n = el
    while (n && n.nodeType === 1) {
      var id = n.id || ''
      var cls = String(n.className || '')
      if (id === 'ai-live-edit-root' || id === 'ai-live-chat-host') return true
      if (cls.indexOf('ai-le-toolbar') >= 0 || cls.indexOf('ai-le-notes') >= 0) return true
      n = n.parentElement
    }
    return false
  }

  function isHidden(el) {
    if (el.hidden) return true
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return true
    try {
      var view = (el.ownerDocument || document).defaultView
      if (view && view.getComputedStyle) {
        var cs = view.getComputedStyle(el)
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return true
      }
    } catch (e) { /* ignore */ }
    return false
  }

  var SKIP_TAG = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, META: 1, LINK: 1,
    HEAD: 1, BR: 1, WBR: 1, PATH: 1, DEFS: 1,
  }
  var INTERESTING = {
    A: 1, BUTTON: 1, INPUT: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1, IMG: 1,
    H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, NAV: 1, MAIN: 1, HEADER: 1,
    FOOTER: 1, ASIDE: 1, FORM: 1, LABEL: 1, SUMMARY: 1, TABLE: 1, DIALOG: 1,
    VIDEO: 1, AUDIO: 1, CANVAS: 1, IFRAME: 1,
  }

  function roleOf(el) {
    var explicit = el.getAttribute && el.getAttribute('role')
    if (explicit) return explicit
    var tag = el.tagName
    if (tag === 'A') return el.getAttribute && el.getAttribute('href') ? 'link' : 'generic'
    if (tag === 'BUTTON') return 'button'
    if (tag === 'NAV') return 'navigation'
    if (tag === 'MAIN') return 'main'
    if (tag === 'HEADER') return 'banner'
    if (tag === 'FOOTER') return 'contentinfo'
    if (tag === 'ASIDE') return 'complementary'
    if (tag === 'FORM') return 'form'
    if (tag === 'IMG') return 'image'
    if (tag === 'DIALOG') return 'dialog'
    if (tag === 'SELECT') return 'combobox'
    if (tag === 'TEXTAREA') return 'textbox'
    if (tag === 'LABEL') return 'label'
    if (tag === 'TABLE') return 'table'
    if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') return 'heading'
    if (tag === 'INPUT') {
      var type = String((el.getAttribute && el.getAttribute('type')) || el.type || 'text').toLowerCase()
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      if (type === 'submit' || type === 'button') return 'button'
      if (type === 'search') return 'searchbox'
      return 'textbox'
    }
    if (el.isContentEditable) return 'textbox'
    return 'generic'
  }

  function ownText(el) {
    var bits = []
    var kids = el.childNodes
    if (!kids) return String(el.textContent || '').trim()
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].nodeType === 3) bits.push(String(kids[i].textContent || ''))
    }
    return bits.join(' ').replace(/\s+/g, ' ').trim()
  }

  function nameOf(el) {
    var labelled = el.getAttribute && el.getAttribute('aria-label')
    if (labelled) return labelled
    var alt = el.getAttribute && el.getAttribute('alt')
    if (alt) return alt
    var title = el.getAttribute && el.getAttribute('title')
    if (title) return title
    var ph = el.getAttribute && el.getAttribute('placeholder')
    if (ph) return ph
    var tag = el.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return String(el.value || ownText(el) || '')
    }
    if (tag === 'IMG') return ''
    return ownText(el)
  }

  function interesting(el) {
    if (verbose) return true
    if (INTERESTING[el.tagName]) return true
    if (el.getAttribute && (el.getAttribute('role') || el.getAttribute('aria-label'))) return true
    if (el.isContentEditable) return true
    if (typeof el.tabIndex === 'number' && el.tabIndex >= 0) return true
    return false
  }

  function emit(el, depth) {
    if (count >= maxNodes) {
      truncated = true
      nodeCapped = true
      return
    }
    var role = roleOf(el)
    var name = nameOf(el).replace(/\s+/g, ' ').trim().slice(0, 80)
    var selector = cssPath(el)
    var id = '1_' + uid++
    var indent = ''
    for (var i = 0; i < depth; i++) indent += '  '
    var line = indent + 'uid=' + id + ' ' + role
    if (name) line += ' "' + name.replace(/"/g, "'") + '"'
    line += ' ' + selector
    // Exact join: carry the dev-only data-ai-loc stamp only when present,
    // so unstamped pages pay zero extra tokens.
    try {
      var stamped = el.closest ? el.closest('[data-ai-loc]') : null
      var loc = stamped && stamped.getAttribute ? stamped.getAttribute('data-ai-loc') : null
      if (loc) line += ' [data-ai-loc="' + String(loc).replace(/"/g, "'") + '"]'
    } catch (e) { /* stamp is best-effort */ }
    lines.push(line)
    count++
  }

  function walk(el, depth, ancestorEmitted) {
    if (truncated || !el || el.nodeType !== 1) return
    var tag = el.tagName
    if (SKIP_TAG[tag] || skipHost(el) || isHidden(el)) return
    var show = interesting(el)
    if (show) emit(el, ancestorEmitted ? depth : 0)
    var nextDepth = show ? (ancestorEmitted ? depth + 1 : 1) : depth
    var kids = el.children || []
    for (var i = 0; i < kids.length; i++) walk(kids[i], nextDepth, ancestorEmitted || show)
    if (el.shadowRoot && el.shadowRoot.children) {
      var shadow = el.shadowRoot.children
      for (var s = 0; s < shadow.length; s++) walk(shadow[s], nextDepth, ancestorEmitted || show)
    }
  }

  var title = ''
  try { title = String((document.title) || '') } catch (e) { title = '' }
  var url = ''
  try {
    url = String((document.location && document.location.href) || '')
  } catch (e) { url = '' }
  lines.push('uid=1_' + uid++ + ' RootWebArea "' + (title || 'page').replace(/"/g, "'") + '" ' + cssPath(root))
  count++
  walk(root, 1, true)
  if (nodeCapped) {
    lines.push('… truncated at ' + maxNodes + ' nodes — narrow with scopeSelector, or map the page with page-sections')
  }
  var text = lines.join('\n')
  if (text.length > textMax) {
    text = text.slice(0, textMax) + '\n… truncated'
    truncated = true
  }
  return {
    ok: true,
    text: text,
    count: count,
    verbose: verbose,
    truncated: truncated,
    url: url,
    title: title,
    elapsedMs: Date.now() - t0,
  }
}
