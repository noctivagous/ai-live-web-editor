import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { DIET_MIN_CHARS, dietFindComponentResult, dietGrepResult, dietLayoutResult, ToolResultTrimProcessor, trimPrompt, TRIM_THRESHOLD_CHARS } from './contextTrim.js'
import { saveAgentSettings, setAgentSettingsPath } from './agentSettings.js'

type Part = Record<string, unknown>
type Msg = { role: string, content: unknown }

const BIG_FILE_BODY = `export function Widget({ title, count }) {\n${'  const filler = "DEEP_MARKER_LINE of generated content that the model does not need twice"\n'.repeat(60)}  return <div>{title}{count}</div>\n}\n`

function readResult(id: string, body = BIG_FILE_BODY): Msg {
  return {
    role: 'tool',
    content: [{
      type: 'tool-result', toolCallId: id, toolName: 'read-real-file',
      output: { type: 'json', value: { path: '/src/Widget.jsx', content: body, startLine: 1, endLine: 62, totalLines: 62, truncated: false } },
    }],
  }
}
function call(id: string, name: string): Msg {
  return { role: 'assistant', content: [{ type: 'tool-call', toolCallId: id, toolName: name, input: {} }] }
}
function toolMsg(id: string, name: string, output: unknown): Msg {
  return { role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: name, output }] }
}
function partText(msg: Msg): string {
  const part = (msg.content as Part[])[0]
  const out = part.output as { type: string, value: unknown }
  return out.type === 'json' ? JSON.stringify(out.value) : String(out.value)
}

describe('trimPrompt (§2 in-turn trimming)', () => {
  it('keeps the newest tool result in full and folds the older one to a signature', () => {
    const prompt: Msg[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: [{ type: 'text', text: 'fix the widget' }] },
      call('a', 'read-real-file'),
      readResult('a'),
      call('b', 'grep'),
      toolMsg('b', 'grep', { type: 'json', value: { hits: [{ path: '/src/Widget.jsx', line: 3 }], count: 1 } }),
    ]
    const { prompt: next, stats, changed } = trimPrompt(prompt)
    assert.equal(changed, true)
    assert.equal(stats.trimmed, 1)
    assert.ok(stats.savedChars > 2000)
    const folded = partText(next[3])
    assert.ok(!folded.includes('DEEP_MARKER_LINE'), 'body is gone after folding')
    assert.ok(folded.includes('read-real-file /src/Widget.jsx'))
    assert.ok(folded.includes('lines 1–62 of 62'))
    assert.ok(folded.includes('Widget(title, count)'), 'signature keeps component + props')
    assert.ok(folded.length <= 700)
    // The newest result (grep) is untouched.
    assert.equal(partText(next[5]), partText(prompt[5]))
  })

  it('a result survives exactly one step in full, then folds on the next call', () => {
    const step1: Msg[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
      call('a', 'read-real-file'),
      readResult('a'),
    ]
    const after1 = trimPrompt(step1)
    assert.equal(after1.changed, false, 'fresh result is not folded for the step that uses it')
    const step2: Msg[] = [...step1, call('b', 'grep'), toolMsg('b', 'grep', { type: 'text', value: 'ok' })]
    const after2 = trimPrompt(step2)
    assert.equal(after2.changed, true)
    assert.ok(!partText(after2.prompt[2]).includes('DEEP_MARKER_LINE'))
  })

  it('folds inspect-dom HTML and snapshot dumps with a head + note', () => {
    const html = '<div class="app">' + '<p>row</p>'.repeat(300) + '</div>'
    const prompt: Msg[] = [
      { role: 'user', content: [{ type: 'text', text: 'look' }] },
      call('a', 'inspect-dom'),
      toolMsg('a', 'inspect-dom', { type: 'json', value: { selector: 'main > div', tagName: 'div', text: 'Hello page', outerHTML: html } }),
      call('b', 'take-snapshot'),
      toolMsg('b', 'take-snapshot', { type: 'text', value: '- main\n' + '  - button "OK"\n'.repeat(200) }),
      call('c', 'grep'),
      toolMsg('c', 'grep', { type: 'text', value: 'small' }),
    ]
    const { prompt: next, stats } = trimPrompt(prompt)
    assert.equal(stats.trimmed, 2)
    const dom = partText(next[2])
    assert.ok(dom.includes('inspect-dom'))
    assert.ok(dom.includes('main > div'))
    assert.ok(dom.includes('Hello page'))
    assert.ok(!dom.includes('<p>row</p><p>row</p><p>row</p><p>row</p><p>row</p><p>row</p><p>row</p><p>row</p>'))
    const snap = partText(next[4])
    assert.ok(snap.includes('take-snapshot'))
    assert.ok(snap.length <= 700)
  })

  it('leaves small results and prompts without tool calls untouched', () => {
    const small: Msg[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      call('a', 'grep'),
      toolMsg('a', 'grep', { type: 'text', value: 'x'.repeat(TRIM_THRESHOLD_CHARS - 10) }),
      call('b', 'grep'),
      toolMsg('b', 'grep', { type: 'text', value: 'y' }),
    ]
    assert.equal(trimPrompt(small).changed, false)
    assert.equal(trimPrompt([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]).changed, false)
  })

  it('also folds tool-result parts carried inside an assistant message', () => {
    const prompt: Msg[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
      call('a', 'read-real-file'),
      { role: 'assistant', content: [{ type: 'tool-result', toolCallId: 'a', toolName: 'read-real-file', output: { type: 'json', value: { path: '/src/Widget.jsx', content: BIG_FILE_BODY, startLine: 1, endLine: 62, totalLines: 62 } } }] },
      call('b', 'grep'),
      toolMsg('b', 'grep', { type: 'text', value: 'ok' }),
    ]
    const { prompt: next, changed } = trimPrompt(prompt)
    assert.equal(changed, true)
    assert.ok(!partText(next[2]).includes('DEEP_MARKER_LINE'))
  })
})

describe('ToolResultTrimProcessor', () => {
  // Hermetic agent settings: the processor consults the Agent & Chat
  // settings, so point them at a temp file instead of the repo's.
  before(async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-proc-'))
    setAgentSettingsPath(path.join(dir, 'agent-settings.json'))
  })

  it('returns a modified prompt only when something folded', async () => {
    const proc = new ToolResultTrimProcessor()
    assert.equal(proc.id, 'tool-result-trim')
    const plain = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
    assert.equal(await proc.processLLMRequest({ prompt: plain } as never), undefined)
    const prompt: Msg[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
      call('a', 'read-real-file'),
      readResult('a'),
      call('b', 'grep'),
      toolMsg('b', 'grep', { type: 'text', value: 'ok' }),
    ]
    const result = await proc.processLLMRequest({ prompt } as never) as { prompt?: Msg[] } | undefined
    assert.ok(result?.prompt)
    assert.ok(!partText(result!.prompt![2]).includes('DEEP_MARKER_LINE'))
  })

  it('does nothing while the Agent & Chat context-trim setting is off', async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-toggle-'))
    setAgentSettingsPath(path.join(dir, 'agent-settings.json'))
    try {
      const proc = new ToolResultTrimProcessor()
      const prompt: Msg[] = [
        { role: 'user', content: [{ type: 'text', text: 'go' }] },
        call('a', 'read-real-file'),
        readResult('a'),
        call('b', 'grep'),
        toolMsg('b', 'grep', { type: 'text', value: 'ok' }),
      ]
      saveAgentSettings({ contextTrim: false })
      assert.equal(await proc.processLLMRequest({ prompt } as never), undefined)
      saveAgentSettings({ contextTrim: true })
      const result = await proc.processLLMRequest({ prompt } as never) as { prompt?: Msg[] } | undefined
      assert.ok(result?.prompt)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})


const DEFAULT_HEAVY_STYLES = {
  display: 'block', position: 'static', top: 'auto', right: 'auto', bottom: 'auto', left: 'auto',
  'z-index': 'auto', 'flex-direction': 'row', 'flex-wrap': 'nowrap', 'margin-top': '0px', 'margin-left': '0px',
  'padding-top': '0px', 'padding-left': '12px', width: 'auto', height: 'auto',
  overflow: 'visible', 'overflow-x': 'visible', visibility: 'visible', opacity: '1', transform: 'none',
}

function layoutElements(n: number, section = 'Pricing plans') {
  return Array.from({ length: n }, (_, i) => ({
    stableId: `e${i + 1}`,
    tagName: i % 3 === 0 ? 'SECTION' : 'DIV',
    classList: ['card', 'wide'],
    depth: 2,
    section,
    rect: { x: 16 + i, y: 84 + i * 10, width: 300, height: 120 },
    textSnippet: `Pricing card number ${i + 1} with some copy in it`,
    computedStyles: { ...DEFAULT_HEAVY_STYLES, ...(i === 0 ? { display: 'flex', gap: '16px' } : {}) },
  }))
}

function layoutMsg(id: string, elements: unknown[]): Msg {
  return toolMsg(id, 'layout-snapshot', {
    type: 'json',
    value: { viewport: { width: 1280, height: 800 }, elements, analysis: { overlaps: [] } },
  })
}

describe('layout-snapshot payload diet (fresh results)', () => {
  it('serializes fresh layout elements as legend + rows and drops default styles', () => {
    const prompt: Msg[] = [
      { role: 'user', content: [{ type: 'text', text: 'fix the pricing layout' }] },
      call('a', 'layout-snapshot'),
      layoutMsg('a', layoutElements(14)),
    ]
    const before = partText(prompt[2])
    const { prompt: next, stats, changed } = trimPrompt(prompt)
    assert.equal(changed, true)
    assert.equal(stats.dieted, 1)
    assert.equal(stats.trimmed, 0)
    const after = partText(next[2])
    assert.ok(after.length < before.length * 0.6, `diet should cut >40% (${before.length} -> ${after.length})`)
    assert.ok(after.includes('elements as rows'), 'legend present')
    assert.ok(after.includes('## Pricing plans'), 'section header present')
    assert.ok(after.includes('e1 section.card.wide 2 16,84 300x120'), 'row shape: id tag.classes depth rect')
    assert.ok(after.includes('display:flex') && after.includes('gap:16px'), 'non-default styles kept')
    assert.ok(after.includes('padding-left:12px'), 'non-default padding kept')
    assert.equal(after.includes('position:static'), false, 'default styles dropped')
    assert.equal(after.includes('overflow:visible'), false)
    assert.equal(after.includes('"computedStyles"'), false, 'no per-element JSON keys remain')
  })

  it('an older layout result still folds to a summary instead of dieting', () => {
    const prompt: Msg[] = [
      { role: 'user', content: [{ type: 'text', text: 'fix it' }] },
      call('a', 'layout-snapshot'),
      layoutMsg('a', layoutElements(14)),
      call('b', 'grep'),
      toolMsg('b', 'grep', { type: 'json', value: { hits: [], count: 0 } }),
    ]
    const { prompt: next, stats } = trimPrompt(prompt)
    assert.equal(stats.trimmed, 1)
    assert.equal(stats.dieted || 0, 0)
    assert.ok(partText(next[2]).includes('[trimmed: layout-snapshot'))
  })

  it('a small layout result stays in full JSON', () => {
    const tiny = [
      { stableId: 'a', tagName: 'DIV', rect: { x: 0, y: 0, width: 10, height: 10 } },
      { stableId: 'b', tagName: 'P', rect: { x: 0, y: 12, width: 10, height: 8 } },
    ]
    const prompt: Msg[] = [
      { role: 'user', content: [{ type: 'text', text: 'peek' }] },
      call('a', 'layout-snapshot'),
      layoutMsg('a', tiny),
    ]
    assert.ok(partText(prompt[2]).length <= DIET_MIN_CHARS)
    const { prompt: next, stats, changed } = trimPrompt(prompt)
    assert.equal(changed, false)
    assert.equal(stats.dieted || 0, 0)
    assert.equal(partText(next[2]), partText(prompt[2]))
  })

  it('the diet drops empty style values and engine-flavoured initial values', () => {
    // Real captures carry '' for n/a properties (e.g. on #document),
    // inset:auto, and min-width/min-height as 0px — all no-information.
    const elements = Array.from({ length: 10 }, (_, i) => ({
      stableId: `s${i}`, tagName: 'DIV', depth: 1,
      rect: { x: 0, y: i * 20, width: 100, height: 20 },
      computedStyles: {
        display: '', position: '', inset: 'auto', top: 'auto',
        'min-width': '0px', 'min-height': '0px', width: '100px',
      },
    }))
    const out = dietLayoutResult({ elements })
    assert.ok(out, 'diet should still win on ten elements')
    const rows = String(out.value.elements)
    assert.ok(rows.includes('width:100px'), 'the one real value survives')
    assert.equal(rows.includes('min-width'), false)
    assert.equal(rows.includes('inset'), false)
    assert.equal(rows.includes('display:'), false, 'empty values never reach a row')
    assert.equal(rows.includes('{}'), false, 'no empty style braces')
  })

  it('dietLayoutResult refuses non-layout values and no-win diets', () => {
    assert.equal(dietLayoutResult({ hits: [] }), null)
    assert.equal(dietLayoutResult({ elements: [] }), null)
    assert.equal(dietLayoutResult('not json'), null)
    // One tiny element: the legend costs more than the JSON keys save.
    assert.equal(dietLayoutResult({ elements: [{ stableId: 'x', tagName: 'DIV', rect: { x: 0, y: 0, width: 1, height: 1 } }] }), null)
  })
})


function grepMsg(id: string, hits: unknown[]): Msg {
  return toolMsg(id, 'grep', { type: 'json', value: { hits, count: hits.length, truncated: false } })
}

function bigHits() {
  const hits: Array<{ path: string, line: number, text: string }> = []
  for (let f = 0; f < 4; f++) {
    for (let i = 0; i < 6; i++) {
      hits.push({
        path: `src/module${f}/file.ts`,
        line: 10 + i * 7,
        text: `  const value${f}${i} = computeSomething(argumentOne, argumentTwo) // call site number ${i}`,
      })
    }
  }
  return hits
}

describe('grep + find-component payload diet (fresh results)', () => {
  it('serializes fresh grep hits as rows grouped by file', () => {
    const prompt: Msg[] = [
      { role: 'user', content: [{ type: 'text', text: 'find computeSomething' }] },
      call('a', 'grep'),
      grepMsg('a', bigHits()),
    ]
    const before = partText(prompt[2])
    assert.ok(before.length > TRIM_THRESHOLD_CHARS)
    const { prompt: next, stats, changed } = trimPrompt(prompt)
    assert.equal(changed, true)
    assert.equal(stats.dieted, 1)
    const after = partText(next[2])
    assert.ok(after.length < before.length * 0.8, `diet should cut >20% (${before.length} -> ${after.length})`)
    assert.ok(after.includes('hits as rows'))
    assert.equal(after.split('src/module0/file.ts').length - 1, 1, 'path paid once for its run of hits')
    assert.ok(after.includes('  10 const value00 = computeSomething'), 'row: line + text (whitespace collapsed)')
    assert.equal(after.includes('"path"'), false, 'per-hit JSON keys are gone')
  })

  it('keeps a grep window as exact source through the diet', () => {
    const hits = Array.from({ length: 8 }, (_, i) => ({
      path: 'src/App.tsx',
      line: 10 + i,
      text: `  const value${i} = computeSomething(argumentOne, argumentTwo)`,
      window: `function keep() {\n  const value${i} = computeSomething(argumentOne, argumentTwo)\n}`,
      windowStart: 9 + i,
      windowEnd: 11 + i,
    }))
    const out = dietGrepResult({ hits, count: hits.length, truncated: false })
    assert.ok(out)
    const text = String(out.value.hits)
    assert.ok(text.includes('exact-window 9-11'))
    assert.ok(text.includes('function keep() {\n  const value0 = computeSomething(argumentOne, argumentTwo)\n}'))
    assert.ok(text.includes('end-window'))
  })

  it('an older grep result folds generically instead of dieting', () => {
    const prompt: Msg[] = [
      { role: 'user', content: [{ type: 'text', text: 'find it' }] },
      call('a', 'grep'),
      grepMsg('a', bigHits()),
      call('b', 'grep'),
      toolMsg('b', 'grep', { type: 'json', value: { hits: [], count: 0, truncated: false } }),
    ]
    const { prompt: next, stats } = trimPrompt(prompt)
    assert.equal(stats.trimmed, 1)
    assert.equal(stats.dieted || 0, 0)
    assert.ok(partText(next[2]).includes('[trimmed: grep result'))
  })

  it('dietGrepResult refuses errors, empty hits, and malformed hits', () => {
    assert.equal(dietGrepResult({ error: 'invalid pattern' }), null)
    assert.equal(dietGrepResult({ hits: [], count: 0 }), null)
    assert.equal(dietGrepResult({ hits: [{ line: 3, text: 'x' }] }), null)
  })

  // Descriptions sized like the real one-liners (the catalog's
  // oneLiner caps at 120 chars; a 6-summary search runs ~1.7k chars).
  const SUMMARIES = [
    { tag: 'button', category: 'inputs', description: 'A clickable button with variant and size styling for primary actions, secondary actions and form submission.', props: ['variant', 'size', 'asChild', 'disabled'], stock: 'shadcn' },
    { tag: 'dialog', category: 'overlays', description: 'A modal dialog that traps focus, closes on Escape and renders its content in a portal above the page.', props: ['open', 'onOpenChange', 'title', 'description'], stock: 'shadcn' },
    { tag: 'noct-app-shell', category: 'layout', description: 'Application shell with a title bar, a sidebar region, a status bar and a scrolling content area.', props: ['title', 'sidebarWidth', 'statusText'], runtime: 'lit', stock: 'appkit' },
    { tag: 'data-table', category: 'data', description: 'A sortable, paginated table over row data with column definitions, row selection and empty states.', props: ['columns', 'rows', 'pageSize', 'onSelect'], stock: 'shadcn' },
    { tag: 'tabs', category: 'navigation', description: 'Tabbed panels with full keyboard navigation following the WAI-ARIA tabs design pattern.', props: ['value', 'onValueChange', 'orientation'], stock: 'shadcn' },
    { tag: 'settings-row', category: 'forms', description: 'One settings line: a label, a short description and a control slot, aligned in a two-column grid.', props: ['label', 'description', 'controlId'], stock: 'shadcn' },
  ]

  it('serializes a fresh find-component summary result as one row per component', () => {
    const prompt: Msg[] = [
      { role: 'user', content: [{ type: 'text', text: 'need a dialog' }] },
      call('a', 'find-component'),
      toolMsg('a', 'find-component', {
        type: 'json',
        value: { ok: true, tier: 'summary', components: SUMMARIES, note: 'Summaries only (names + prop names).' },
      }),
    ]
    const before = partText(prompt[2])
    assert.ok(before.length > DIET_MIN_CHARS, `fixture must cross the diet floor (${before.length})`)
    const { prompt: next, stats } = trimPrompt(prompt)
    assert.equal(stats.dieted, 1)
    const after = partText(next[2])
    // Descriptions dominate these payloads, so the win is bounded
    // (~16% on this fixture) — the keys are a minority of the chars,
    // unlike layout elements. Assert a real but honest cut.
    assert.ok(after.length < before.length * 0.87, `diet should cut >13% (${before.length} -> ${after.length})`)
    assert.ok(after.includes('components as rows'))
    assert.ok(after.includes('button [shadcn/inputs] — A clickable button'), 'row: tag [stock/category] — description')
    assert.ok(after.includes('(props: variant, size, asChild, disabled)'), 'prop names kept')
    assert.ok(after.includes('noct-app-shell [appkit/layout · lit]'), 'runtime shown when present')
    assert.ok(after.includes('Summaries only'), 'the note survives as JSON')
    assert.equal(after.includes('"description"'), false)
  })

  it('never diets a full catalog entry, however big', () => {
    const full = {
      ok: true, tier: 'full',
      component: { tag: 'dialog', description: 'x'.repeat(2400), props: [{ name: 'open', type: 'boolean' }] },
    }
    assert.equal(dietFindComponentResult(full), null)
    const prompt: Msg[] = [
      { role: 'user', content: [{ type: 'text', text: 'show me the dialog entry' }] },
      call('a', 'find-component'),
      toolMsg('a', 'find-component', { type: 'json', value: full }),
    ]
    const { prompt: next, stats, changed } = trimPrompt(prompt)
    assert.equal(changed, false)
    assert.equal(stats.dieted || 0, 0)
    assert.equal(partText(next[2]), partText(prompt[2]))
  })

  it('dietFindComponentResult refuses non-summary shapes', () => {
    assert.equal(dietFindComponentResult({ ok: false, error: 'Pass a query or a tag' }), null)
    assert.equal(dietFindComponentResult({ ok: true, tier: 'summary', components: [] }), null)
    assert.equal(dietFindComponentResult({ ok: true, tier: 'summary', components: [{ category: 'x' }] }), null)
  })
})
