import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

type FakeEl = {
  tagName: string
  id: string
  children: FakeEl[]
  parentElement: FakeEl | null
  nodeType: number
  textContent: string
  className: string
  style: { cssText: string, setProperty: (p: string, v: string) => void }
  _attrs: Record<string, string>
  firstChild: FakeEl | null
  firstElementChild: FakeEl | null
  nextSibling: FakeEl | null
  outerHTML: string
  innerHTML: string
  appendChild: (n: FakeEl) => FakeEl
  insertBefore: (n: FakeEl, ref: FakeEl | null) => FakeEl
  remove: () => void
  contains: (n: FakeEl) => boolean
  setAttribute: (k: string, v: string) => void
  getAttribute: (k: string) => string | null
  removeAttribute: (k: string) => void
  getBoundingClientRect: () => { x: number, y: number, width: number, height: number }
  querySelector: (sel: string) => FakeEl | null
}

function makeDoc() {
  const byId = new Map<string, FakeEl>()

  function El(tag: string): FakeEl {
    const el: Partial<FakeEl> = {
      tagName: tag.toUpperCase(),
      id: '',
      children: [],
      parentElement: null,
      nodeType: 1,
      textContent: '',
      className: '',
      _attrs: {},
    }
    el.style = {
      cssText: '',
      setProperty(p, v) { this.cssText += `${p}: ${v};` },
    }
    Object.defineProperty(el, 'firstChild', { get: () => el.children![0] || null })
    Object.defineProperty(el, 'firstElementChild', { get: () => el.children![0] || null })
    Object.defineProperty(el, 'nextSibling', {
      get: () => {
        const p = el.parentElement
        if (!p) return null
        const i = p.children.indexOf(el as FakeEl)
        return p.children[i + 1] || null
      },
    })
    Object.defineProperty(el, 'outerHTML', {
      get: () => {
        const id = el.id ? ` id="${el.id}"` : ''
        return `<${tag.toLowerCase()}${id}>${el.innerHTML}</${tag.toLowerCase()}>`
      },
    })
    Object.defineProperty(el, 'innerHTML', {
      get: () => el.children!.length ? el.children!.map((c) => c.outerHTML).join('') : (el.textContent || ''),
      set: (html: string) => {
        el.children = []
        el.textContent = ''
        const t = String(html).trim()
        if (!t) return
        const re = /<([a-zA-Z0-9]+)([^>]*)>([\s\S]*?)<\/\1>/g
        let m
        let found = 0
        while ((m = re.exec(t))) {
          found++
          const child = El(m[1])
          const idm = m[2].match(/id=["']([^"']+)["']/)
          if (idm) { child.id = idm[1]; byId.set(child.id, child) }
          child.textContent = m[3]
          el.appendChild!(child)
        }
        if (!found) el.textContent = t
      },
    })
    el.appendChild = (n) => {
      if (n.parentElement) n.remove()
      n.parentElement = el as FakeEl
      el.children!.push(n)
      return n
    }
    el.insertBefore = (n, ref) => {
      if (n.parentElement) n.remove()
      n.parentElement = el as FakeEl
      if (!ref) { el.children!.push(n); return n }
      const i = el.children!.indexOf(ref)
      if (i < 0) el.children!.push(n)
      else el.children!.splice(i, 0, n)
      return n
    }
    el.remove = () => {
      const p = el.parentElement
      if (!p) return
      const i = p.children.indexOf(el as FakeEl)
      if (i >= 0) p.children.splice(i, 1)
      el.parentElement = null
    }
    el.contains = (n) => n === el || el.children!.some((c) => c.contains(n))
    el.setAttribute = (k, v) => {
      el._attrs![k] = String(v)
      if (k === 'id') { el.id = String(v); byId.set(el.id, el as FakeEl) }
    }
    el.getAttribute = (k) => (k === 'id' ? (el.id || null) : (el._attrs![k] ?? null))
    el.removeAttribute = (k) => { delete el._attrs![k]; if (k === 'id') el.id = '' }
    el.getBoundingClientRect = () => ({ x: 0, y: 0, width: 10, height: 10 })
    el.querySelector = (sel) => {
      if (sel.startsWith('#')) {
        const hit = byId.get(sel.slice(1))
        if (hit) return hit
      }
      if (el.id && ('#' + el.id) === sel) return el as FakeEl
      for (const c of el.children!) {
        const f = c.querySelector(sel)
        if (f) return f
      }
      return null
    }
    return el as FakeEl
  }

  const body = El('body')
  body.id = 'root'
  byId.set('root', body)
  const title = El('h1')
  title.id = 'title'
  title.textContent = 'Hello'
  byId.set('title', title)
  body.appendChild(title)
  const main = El('main')
  main.id = 'main'
  byId.set('main', main)
  body.appendChild(main)
  const document = {
    querySelector: (sel: string) => {
      if (sel === 'body' || sel === '#root') return body
      return body.querySelector(sel)
    },
    createElement: (tag: string) => El(tag),
  }
  return { document, body, title, main }
}

function loadEngine() {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'patchEngine.js'), 'utf8')
  const ctx: { runLivePatch?: (payload: unknown, document: unknown) => Record<string, unknown> } = {}
  vm.runInNewContext(`${src}\nthis.runLivePatch = runLivePatch`, ctx)
  return ctx.runLivePatch as (payload: unknown, document: unknown) => Record<string, unknown>
}

describe('runLivePatch insert/move/restore', () => {
  it('inserts one root, records placement, and restore removes it', () => {
    const run = loadEngine()
    const { document, main } = makeDoc()
    const inserted = run({
      selector: '#main',
      op: 'insert',
      html: '<button id="go">Go</button>',
      position: 'append',
    }, document)
    assert.equal(inserted.ok, true)
    assert.equal(inserted.op, 'insert')
    const before = inserted.before as { parentSelector: string, childIndex: number }
    assert.equal(before.parentSelector, '#main')
    assert.equal(before.childIndex, 0)
    assert.equal(main.children.length, 1)
    assert.equal(main.children[0].id, 'go')
    const restored = run({
      selector: '#main',
      op: 'restore',
      restoreOp: 'insert',
      before: inserted.before,
    }, document)
    assert.equal(restored.ok, true)
    assert.equal(main.children.length, 0)
  })

  it('moves a node and restore puts it back', () => {
    const run = loadEngine()
    const { document, body, title, main } = makeDoc()
    const moved = run({ selector: '#title', op: 'move', target: '#main', position: 'append' }, document)
    assert.equal(moved.ok, true)
    assert.equal(title.parentElement, main)
    assert.equal(body.children.includes(title), false)
    const restored = run({
      selector: '#title',
      op: 'restore',
      restoreOp: 'move',
      before: moved.before,
    }, document)
    assert.equal(restored.ok, true)
    assert.equal(title.parentElement, body)
    assert.equal(body.children[0], title)
  })

  it('fails closed on multi-root insert and self-move', () => {
    const run = loadEngine()
    const { document } = makeDoc()
    const multi = run({ selector: '#main', op: 'insert', html: '<p>a</p><p>b</p>' }, document)
    assert.equal(multi.ok, false)
    const self = run({ selector: '#root', op: 'move', target: '#title' }, document)
    assert.equal(self.ok, false)
  })

  it('restore fails closed without a before snapshot', () => {
    const run = loadEngine()
    const { document, title } = makeDoc()
    const missing = run({ selector: '#title', op: 'restore', restoreOp: 'text' }, document)
    assert.equal(missing.ok, false)
    assert.equal(title.textContent, 'Hello')
  })
})
