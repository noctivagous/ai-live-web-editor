import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { ToolResultTrimProcessor, trimPrompt, TRIM_THRESHOLD_CHARS } from './contextTrim.js'
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
