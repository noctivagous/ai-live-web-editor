import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyCaptureSrc,
  dedupeConsoleEntries,
  isAppEntry,
  srcFromStack,
  srcFromUrl,
  tagProbeEntries,
  type SrcEntry,
} from './consoleSource.js'

const entry = (level: string, text: string, src?: SrcEntry['src'], ts?: number): SrcEntry =>
  ({ level, text, ...(src ? { src } : {}), ...(ts !== undefined ? { ts } : {}) })

describe('srcFromUrl / srcFromStack (editor script identification)', () => {
  it('recognises the plugin clients by served path', () => {
    assert.equal(srcFromUrl('http://localhost:5173/@ai-live-editor/page-bridge.js'), 'editor')
    assert.equal(srcFromUrl('http://localhost:5173/@ai-live-editor/chat-overlay.js'), 'editor')
  })

  it('recognises the annotate overlay by its served route', () => {
    assert.equal(srcFromUrl('http://localhost:5173/live-edit/overlay.js'), 'editor')
    assert.equal(srcFromUrl('http://localhost:4112/live-edit/overlay.js'), 'editor')
  })

  it('app scripts and missing values say nothing', () => {
    assert.equal(srcFromUrl('http://localhost:5173/src/main.tsx'), undefined)
    assert.equal(srcFromUrl('http://localhost:5173/@vite/client'), undefined)
    assert.equal(srcFromUrl(undefined), undefined)
    assert.equal(srcFromUrl(''), undefined)
  })

  it('a stack running through an injected client is the editor’s', () => {
    const stack = [
      'Error: chat blew up',
      '    at mountChatOverlay (http://localhost:5173/@ai-live-editor/chat-overlay.js:120:11)',
      '    at http://localhost:5173/src/main.tsx:5:1',
    ].join('\n')
    assert.equal(srcFromStack(stack), 'editor')
  })

  it('a stack running through the overlay’s served path is the editor’s', () => {
    const stack = 'Error: pick failed\n    at HTMLDocument.<anonymous> (/live-edit/overlay.js:812:9)'
    assert.equal(srcFromStack(stack), 'editor')
  })

  it('an app-only stack (or none) says nothing', () => {
    assert.equal(srcFromStack('Error: boom\n    at App (http://localhost:5173/src/App.tsx:9:3)'), undefined)
    assert.equal(srcFromStack(undefined), undefined)
    assert.equal(srcFromStack(''), undefined)
  })
})

describe('classifyCaptureSrc (the pool capture rule)', () => {
  it('location URL wins when it identifies an editor script', () => {
    assert.equal(classifyCaptureSrc({ url: 'http://localhost:5173/@ai-live-editor/chat-overlay.js' }), 'editor')
    assert.equal(classifyCaptureSrc({ url: 'http://localhost:5173/live-edit/overlay.js' }), 'editor')
  })

  it('falls back to the stack (pageerror has no location)', () => {
    assert.equal(classifyCaptureSrc({ stack: 'Error: x\n at y (http://localhost:5173/@ai-live-editor/page-bridge.js:1:1)' }), 'editor')
  })

  it('anything unidentified is the app’s', () => {
    assert.equal(classifyCaptureSrc({ url: 'http://localhost:5173/src/App.tsx' }), 'app')
    assert.equal(classifyCaptureSrc({ url: 'http://localhost:5173/src/App.tsx', stack: 'Error: x\n at App (http://localhost:5173/src/App.tsx:2:2)' }), 'app')
    assert.equal(classifyCaptureSrc({}), 'app')
  })
})

describe('isAppEntry', () => {
  it('absent src means app (pre-slice-C entries); editor/probe are not app', () => {
    assert.equal(isAppEntry({}), true)
    assert.equal(isAppEntry({ src: 'app' }), true)
    assert.equal(isAppEntry({ src: 'editor' }), false)
    assert.equal(isAppEntry({ src: 'agent-probe' }), false)
  })
})

describe('tagProbeEntries (read-time agent-probe tagging)', () => {
  it('an entry containing a declared literal becomes agent-probe', () => {
    const out = tagProbeEntries([entry('log', 'PROBE-HIT booted'), entry('log', 'ordinary')], ['PROBE-HIT'])
    assert.equal(out[0].src, 'agent-probe')
    assert.equal(out[1].src, undefined)
  })

  it('a probe logged at error level still tags (and so is not an app error)', () => {
    const out = tagProbeEntries([entry('error', 'PROBE-ERR exploded')], ['PROBE-ERR'])
    assert.equal(out[0].src, 'agent-probe')
    assert.equal(isAppEntry(out[0]), false)
  })

  it('the same text in a turn that declared nothing stays app', () => {
    const out = tagProbeEntries([entry('error', 'PROBE-ERR exploded')], [])
    assert.equal(out[0].src, undefined)
    assert.equal(isAppEntry(out[0]), true)
  })

  it('capture-time editor evidence outranks a text coincidence', () => {
    const out = tagProbeEntries([entry('error', 'PROBE-ERR inside the overlay', 'editor')], ['PROBE-ERR'])
    assert.equal(out[0].src, 'editor')
  })

  it('tagging never alters the text (expectation matching is unaffected)', () => {
    const out = tagProbeEntries([entry('log', 'PROBE-HIT booted')], ['PROBE-HIT'])
    assert.equal(out[0].text, 'PROBE-HIT booted')
  })
})

describe('dedupeConsoleEntries', () => {
  it('collapses identical (level, text, src) into the first entry with a count', () => {
    const out = dedupeConsoleEntries([
      entry('warn', 'same', undefined, 100),
      entry('warn', 'same', undefined, 200),
      entry('warn', 'same', undefined, 300),
    ])
    assert.equal(out.length, 1)
    assert.equal(out[0].count, 3)
    assert.equal(out[0].ts, 100, 'first occurrence’s ts is kept')
  })

  it('level or src differences keep entries distinct', () => {
    const out = dedupeConsoleEntries([
      entry('warn', 'same'),
      entry('error', 'same'),
      entry('warn', 'same', 'editor'),
      entry('warn', 'other'),
    ])
    assert.equal(out.length, 4)
    assert.ok(out.every((e) => e.count === 1))
  })

  it('absent src and explicit app are the same bucket', () => {
    const out = dedupeConsoleEntries([entry('warn', 'same'), entry('warn', 'same', 'app')])
    assert.equal(out.length, 1)
    assert.equal(out[0].count, 2)
  })

  it('order is preserved (first occurrence wins the slot)', () => {
    const out = dedupeConsoleEntries([entry('error', 'b'), entry('error', 'a'), entry('error', 'b')])
    assert.deepEqual(out.map((e) => e.text), ['b', 'a'])
    assert.equal(out[0].count, 2)
  })
})
