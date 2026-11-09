import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

type FakeEl = {
  tagName: string
  id: string
  className: string
  nodeType: number
  hidden: boolean
  children: FakeEl[]
  childNodes: Array<{ nodeType: number, textContent: string }>
  parentElement: FakeEl | null
  textContent: string
  shadowRoot: { children: FakeEl[] } | null
  getAttribute: (k: string) => string | null
  _attrs: Record<string, string>
}

function El(tag: string, extra: Partial<FakeEl> = {}): FakeEl {
  const el: FakeEl = {
    tagName: tag.toUpperCase(),
    id: extra.id || '',
    className: extra.className || '',
    nodeType: 1,
    hidden: false,
    children: [],
    childNodes: extra.childNodes || [],
    parentElement: null,
    textContent: extra.textContent || '',
    shadowRoot: null,
    _attrs: extra._attrs || {},
    getAttribute(k) {
      if (k === 'id') return el.id || null
      return el._attrs[k] ?? null
    },
  }
  if (!el.childNodes.length && el.textContent) {
    el.childNodes = [{ nodeType: 3, textContent: el.textContent }]
  }
  return el
}

function append(parent: FakeEl, child: FakeEl) {
  child.parentElement = parent
  parent.children.push(child)
  return child
}

function load() {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'pageSnapshot.js'), 'utf8')
  const ctx: { capturePageSnapshot?: (payload: unknown, document: unknown) => Record<string, unknown> } = {}
  vm.runInNewContext(`${src}\nthis.capturePageSnapshot = capturePageSnapshot`, ctx)
  return ctx.capturePageSnapshot as (payload: unknown, document: unknown) => Record<string, unknown>
}

describe('capturePageSnapshot', () => {
  it('emits roles, names, and CSS selectors for interesting nodes', () => {
    const body = El('body', { id: 'root' })
    const h1 = append(body, El('h1', { id: 'title', textContent: 'Videos' }))
    append(body, El('p', { textContent: 'quiet copy' }))
    append(body, El('button', { id: 'go', textContent: 'Watch' }))
    const overlay = append(body, El('div', { id: 'ai-live-chat-host' }))
    append(overlay, El('button', { textContent: 'Chat send' }))
    const document = {
      body,
      title: 'StreamList',
      location: { href: 'http://localhost:5173/' },
      querySelector: (sel: string) => (sel === '#root' ? body : null),
      documentElement: body,
    }
    const snap = load()({}, document)
    assert.equal(snap.ok, true)
    const text = String(snap.text)
    assert.match(text, /RootWebArea "StreamList"/)
    assert.match(text, /heading "Videos" #title/)
    assert.match(text, /button "Watch" #go/)
    assert.equal(text.includes('quiet copy'), false)
    assert.equal(text.includes('Chat send'), false)
    void h1
  })

  it('a node-capped snapshot says so in the text, with the way out', () => {
    const body = El('body', { id: 'root' })
    for (let i = 0; i < 6; i++) append(body, El('button', { id: `b${i}`, textContent: `Go ${i}` }))
    const document = {
      body,
      title: 'Many buttons',
      location: { href: 'http://localhost:5173/' },
      querySelector: () => body,
      documentElement: body,
    }
    const snap = load()({ maxNodes: 3 }, document)
    assert.equal(snap.truncated, true)
    assert.equal(snap.count, 3)
    const text = String(snap.text)
    assert.ok(text.includes('… truncated at 3 nodes'), 'cap is named in the dump itself')
    assert.ok(text.includes('scopeSelector') && text.includes('page-sections'), 'the narrower tools are named')
    // Under the cap there is no truncation line.
    const full = load()({}, document)
    assert.equal(full.truncated, false)
    assert.equal(String(full.text).includes('truncated at'), false)
  })

  it('a missing scopeSelector names the selector and the way out', () => {
    const body = El('body', { id: 'root' })
    const document = {
      body,
      title: 'Page',
      location: { href: 'http://localhost:5173/' },
      querySelector: () => null,
      documentElement: body,
    }
    const snap = load()({ scopeSelector: '#missing' }, document)
    assert.equal(snap.ok, false)
    assert.match(String(snap.error), /#missing/)
    assert.match(String(snap.error), /scopeSelector/)
  })

  it('verbose includes generic nodes', () => {
    const body = El('body', { id: 'root' })
    append(body, El('div', { id: 'box', textContent: 'generic' }))
    const document = {
      body,
      title: 'Page',
      location: { href: 'http://localhost:5173/' },
      querySelector: () => body,
      documentElement: body,
    }
    const quiet = load()({}, document)
    assert.equal(String(quiet.text).includes('#box'), false)
    const noisy = load()({ verbose: true }, document)
    assert.match(String(noisy.text), /#box/)
  })
})
