/**
 * Shared live-page patch + restore. Concatenated into the Vite page bridge
 * and inlined into Playwright evaluate. No imports, no exports.
 */
function runLivePatch(payload, document) {
  payload = payload || {}
  var selector = String(payload.selector || 'body')
  var op = inferLivePatchOp(payload)
  var t0 = Date.now()
  if (op === 'restore') {
    var restored = restoreLivePatch(selector, payload, document)
    restored.elapsedMs = Date.now() - t0
    return restored
  }
  var el = document.querySelector(selector)
  if (!el) return { ok: false, error: 'Selector not found: ' + selector }
  var before = captureLiveBefore(el, op, payload)
  var applied = applyLiveOp(el, op, payload, document)
  if (applied && applied.error) return { ok: false, error: applied.error }
  if (op === 'insert' && applied && applied.placed) {
    before.parentSelector = applied.placed.parentSelector
    before.childIndex = applied.placed.childIndex
    before.outerHTML = applied.placed.outerHTML
    before.position = applied.placed.position
  }
  if (op !== 'remove' && op !== 'insert') {
    var stamp = op === 'move' ? el : document.querySelector(selector)
    if (stamp && stamp.setAttribute) stamp.setAttribute('data-ai-patched', 'true')
  }
  var node = op === 'remove' ? null : op === 'insert' ? applied.node : document.querySelector(selector) || el
  var r = node && node.getBoundingClientRect ? node.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 }
  return {
    ok: true,
    selector: selector,
    op: op,
    before: before,
    after: {
      html: payload.html,
      text: payload.text,
      style: payload.style,
      className: payload.className,
      target: payload.target,
      position: payload.position,
    },
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    htmlLen: node ? String(node.innerHTML || '').length : 0,
    elapsedMs: Date.now() - t0,
  }
}

function inferLivePatchOp(payload) {
  if (payload.op) return String(payload.op)
  if (payload.target) return 'move'
  if (payload.html !== undefined) return 'html'
  if (payload.text !== undefined) return 'text'
  if (payload.style !== undefined) return 'style'
  if (payload.className !== undefined || payload.class !== undefined) return 'class'
  if (payload.attr) return 'attr'
  return 'html'
}

function liveCssPath(el) {
  var parts = []
  var n = el
  while (n && n.nodeType === 1 && parts.length < 8) {
    if (n.id) {
      parts.unshift('#' + n.id)
      break
    }
    var tag = n.tagName.toLowerCase()
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

function livePosition(payload) {
  var p = String(payload.position || 'append')
  if (p === 'before' || p === 'after' || p === 'prepend' || p === 'append') return p
  return 'append'
}

function placeLiveNode(node, target, position) {
  var parent = target.parentElement
  if (position === 'before') {
    if (!parent) return { error: 'target has no parent' }
    parent.insertBefore(node, target)
  } else if (position === 'after') {
    if (!parent) return { error: 'target has no parent' }
    parent.insertBefore(node, target.nextSibling)
  } else if (position === 'prepend') {
    target.insertBefore(node, target.firstChild)
  } else {
    target.appendChild(node)
  }
  return { ok: true }
}

function captureLiveBefore(el, op, payload) {
  if (op === 'insert') {
    return { position: livePosition(payload) }
  }
  var parent = el.parentElement
  var before = {
    innerHTML: el.innerHTML,
    textContent: el.textContent,
    cssText: el.style && el.style.cssText,
    className: el.className,
    outerHTML: el.outerHTML,
    parentSelector: parent ? liveCssPath(parent) : '',
    childIndex: parent ? Array.prototype.indexOf.call(parent.children, el) : 0,
  }
  if (op === 'attr' && payload.attr && payload.attr.name) {
    before.attrName = payload.attr.name
    before.attrValue = el.getAttribute(payload.attr.name)
  }
  if (op === 'insert' || op === 'move') before.position = livePosition(payload)
  if (op === 'move') before.targetSelector = String(payload.target || '')
  return before
}

function applyLiveStyle(el, style) {
  if (!style || typeof style !== 'string') return
  var parts = style.split(';')
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i]
    var cut = part.indexOf(':')
    if (cut < 0) continue
    var prop = part.slice(0, cut).trim()
    var val = part.slice(cut + 1).trim()
    if (prop) el.style.setProperty(prop, val)
  }
}

function applyLiveOp(el, op, payload, document) {
  if (op === 'html') el.innerHTML = payload.html ?? ''
  else if (op === 'text') el.textContent = payload.text ?? ''
  else if (op === 'style') applyLiveStyle(el, payload.style)
  else if (op === 'class') el.className = payload.className ?? payload.class ?? ''
  else if (op === 'attr' && payload.attr && payload.attr.name) {
    if (payload.attr.value == null || payload.attr.value === '') el.removeAttribute(payload.attr.name)
    else el.setAttribute(payload.attr.name, String(payload.attr.value))
  }
  else if (op === 'remove') el.remove()
  else if (op === 'insert') return insertLiveNode(el, payload, document)
  else if (op === 'move') return moveLiveNode(el, payload, document)
  else return { error: 'unknown op ' + op }
  return { ok: true }
}

function insertLiveNode(target, payload, document) {
  var html = payload.html
  if (html == null || String(html).trim() === '') return { error: 'insert requires html' }
  var tmp = document.createElement('div')
  tmp.innerHTML = String(html)
  if (!tmp.children || tmp.children.length !== 1) {
    return { error: 'insert html must have exactly one root element' }
  }
  var node = tmp.firstElementChild
  var position = livePosition(payload)
  var placed = placeLiveNode(node, target, position)
  if (placed.error) return placed
  if (node.setAttribute) node.setAttribute('data-ai-patched', 'true')
  var parent = node.parentElement
  return {
    ok: true,
    node: node,
    placed: {
      parentSelector: parent ? liveCssPath(parent) : '',
      childIndex: parent ? Array.prototype.indexOf.call(parent.children, node) : 0,
      outerHTML: node.outerHTML,
      position: position,
    },
  }
}

function moveLiveNode(el, payload, document) {
  var targetSel = String(payload.target || '')
  if (!targetSel) return { error: 'move requires target' }
  var target = document.querySelector(targetSel)
  if (!target) return { error: 'Target not found: ' + targetSel }
  if (el === target || (el.contains && el.contains(target))) return { error: 'cannot move a node into itself' }
  var placed = placeLiveNode(el, target, livePosition(payload))
  if (placed.error) return placed
  return { ok: true, moved: el }
}

function restoreLivePatch(selector, payload, document) {
  var before = payload.before || {}
  var restoreOp = String(payload.restoreOp || payload.fromOp || '')
  if (!restoreOp) return { ok: false, error: 'restoreOp required' }
  if (restoreOp === 'remove' || restoreOp === 'insert') {
    return restoreLiveInsertOrRemove(selector, restoreOp, before, document)
  }
  if (restoreOp === 'move') return restoreLiveMove(selector, before, document)
  var el = document.querySelector(selector)
  if (!el) return { ok: false, error: 'Selector not found: ' + selector }
  if (restoreOp === 'html') {
    if (before.innerHTML == null) return { ok: false, error: 'restore missing before.innerHTML' }
    el.innerHTML = before.innerHTML
  } else if (restoreOp === 'text') {
    if (before.textContent == null) return { ok: false, error: 'restore missing before.textContent' }
    el.textContent = before.textContent
  } else if (restoreOp === 'style') {
    if (before.cssText == null) return { ok: false, error: 'restore missing before.cssText' }
    el.style.cssText = before.cssText
  } else if (restoreOp === 'class') {
    if (before.className == null) return { ok: false, error: 'restore missing before.className' }
    el.className = before.className
  } else if (restoreOp === 'attr') {
    if (!before.attrName) return { ok: false, error: 'restore missing before.attrName' }
    if (before.attrValue == null) el.removeAttribute(before.attrName)
    else el.setAttribute(before.attrName, before.attrValue)
  } else {
    return { ok: false, error: 'unknown restore op ' + restoreOp }
  }
  if (el.removeAttribute) el.removeAttribute('data-ai-patched')
  return { ok: true, op: 'restore', selector: selector }
}

function restoreLiveInsertOrRemove(selector, restoreOp, before, document) {
  if (restoreOp === 'insert') {
    var parent = before.parentSelector ? document.querySelector(String(before.parentSelector)) : null
    if (!parent || before.childIndex == null) return { ok: false, error: 'restore insert parent not found' }
    var node = parent.children[Number(before.childIndex)]
    if (!node) return { ok: false, error: 'restore insert node not found' }
    node.remove()
    return { ok: true, op: 'restore', selector: selector }
  }
  var parentR = before.parentSelector ? document.querySelector(String(before.parentSelector)) : null
  if (!parentR || !before.outerHTML) return { ok: false, error: 'restore parent not found' }
  var tmp = document.createElement('div')
  tmp.innerHTML = String(before.outerHTML)
  var restored = tmp.firstElementChild
  if (!restored) return { ok: false, error: 'restore html empty' }
  var ref = parentR.children[Number(before.childIndex) || 0] || null
  parentR.insertBefore(restored, ref)
  return { ok: true, op: 'restore', selector: selector }
}

function restoreLiveMove(selector, before, document) {
  var el = document.querySelector(selector)
  if (!el) return { ok: false, error: 'Selector not found: ' + selector }
  var parent = before.parentSelector ? document.querySelector(String(before.parentSelector)) : null
  if (!parent) return { ok: false, error: 'restore move parent not found' }
  if (before.childIndex == null) return { ok: false, error: 'restore missing before.childIndex' }
  var ref = parent.children[Number(before.childIndex)] || null
  if (ref === el) {
    if (el.removeAttribute) el.removeAttribute('data-ai-patched')
    return { ok: true, op: 'restore', selector: selector }
  }
  parent.insertBefore(el, ref)
  if (el.removeAttribute) el.removeAttribute('data-ai-patched')
  return { ok: true, op: 'restore', selector: selector }
}
