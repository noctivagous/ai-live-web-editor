import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyFormatToFindings,
  consoleEpochPlan,
  consoleErrorEntries,
  consoleFindings,
  consoleInstanceOf,
  diffFindings,
  findingKey,
  formatGatePrompt,
  gateNeedsFollowUp,
  PAGE_RELOADED_NOTE,
  shouldTriggerGate,
  toLayoutFindings,
  type ConsoleEntry,
  type LayoutFinding,
} from './gate.js'
import { gatePrompt, type GateResult } from './runGate.js'

describe('shouldTriggerGate', () => {
  it('fires on Files turns that wrote files', () => {
    assert.equal(shouldTriggerGate('files', ['grep', 'str-replace']), true)
    assert.equal(shouldTriggerGate('files', ['write-real-file']), true)
  })

  it('stays quiet otherwise', () => {
    assert.equal(shouldTriggerGate('files', ['grep', 'take-snapshot']), false)
    assert.equal(shouldTriggerGate('files', []), false)
    assert.equal(shouldTriggerGate('sketch', ['str-replace']), false)
  })

  it('fires for every tool in the shared write list (slice 3)', () => {
    for (const t of ['place-template', 'install-catalog-component', 'delete-file', 'rename-file', 'make-dir']) {
      assert.equal(shouldTriggerGate('files', [t]), true, t)
    }
  })

  it('does not fire for research or adopt-registry (not project-file writes)', () => {
    assert.equal(shouldTriggerGate('files', ['research']), false)
    assert.equal(shouldTriggerGate('files', ['adopt-registry']), false)
  })
})

describe('gateNeedsFollowUp', () => {
  const finding: LayoutFinding = { key: 'k', kind: 'overlap', detail: '{}', width: 375 }
  const entry: ConsoleEntry = { seq: 2, level: 'error', text: 'boom' }
  const result = (over: Partial<GateResult>): GateResult => ({
    ran: true,
    layout: [],
    expected: [],
    console: [],
    unverified: [],
    ...over,
  })

  it('does not fire for unverified-only results', () => {
    assert.equal(gateNeedsFollowUp(result({ unverified: ['1280px via pool: no live page'] })), false)
    assert.equal(gateNeedsFollowUp(result({ unverified: ['bridge console: gone', '375px check frame: frame gone'] })), false)
  })

  it('fires for real findings, with or without unverified notes', () => {
    assert.equal(gateNeedsFollowUp(result({ layout: [finding] })), true)
    assert.equal(gateNeedsFollowUp(result({ console: [entry] })), true)
    assert.equal(gateNeedsFollowUp(result({ layout: [finding], console: [entry], unverified: ['x'] })), true)
  })

  it('does not fire when the gate found nothing at all', () => {
    assert.equal(gateNeedsFollowUp(result({})), false)
  })

  it('slice B: warnings alone never trigger a follow-up (reported, not chased)', () => {
    const warn: ConsoleEntry = { seq: 3, level: 'warn', text: 'careful now' }
    assert.equal(gateNeedsFollowUp(result({ console: [warn] })), false)
    assert.equal(gateNeedsFollowUp(result({ console: [warn], unverified: ['x'] })), false)
  })

  it('slice B: pageerror counts as an error for the follow-up', () => {
    const pageerror: ConsoleEntry = { seq: 3, level: 'pageerror', text: 'uncaught' }
    assert.equal(gateNeedsFollowUp(result({ console: [pageerror] })), true)
  })

  it('slice B: a missing console expectation alone triggers the follow-up on a write turn', () => {
    assert.equal(gateNeedsFollowUp(result({}), 1), true)
    assert.equal(gateNeedsFollowUp(result({ console: [{ seq: 1, level: 'warn', text: 'w' }] }), 2), true)
    assert.equal(gateNeedsFollowUp(result({}), 0), false)
  })

  it('slice C: an editor-attributed error alone never triggers a follow-up', () => {
    const editorError: ConsoleEntry = { seq: 4, level: 'error', text: 'chat overlay blew up', src: 'editor' }
    const editorCrash: ConsoleEntry = { seq: 5, level: 'pageerror', text: 'overlay crashed', src: 'editor' }
    assert.equal(gateNeedsFollowUp(result({ console: [editorError] })), false)
    assert.equal(gateNeedsFollowUp(result({ console: [editorCrash] })), false)
    assert.equal(gateNeedsFollowUp(result({ console: [editorError], unverified: ['x'] })), false)
  })

  it('slice C: an agent-probe error alone never triggers a follow-up', () => {
    const probe: ConsoleEntry = { seq: 4, level: 'error', text: 'PROBE-ERR exploded', src: 'agent-probe' }
    assert.equal(gateNeedsFollowUp(result({ console: [probe] })), false)
  })

  it('slice C: an app error still triggers alongside editor noise', () => {
    const editorError: ConsoleEntry = { seq: 4, level: 'error', text: 'chat overlay blew up', src: 'editor' }
    assert.equal(gateNeedsFollowUp(result({ console: [editorError, entry] })), true)
  })

  it('wiring: unverified-only is exactly where gatePrompt used to send a follow-up', () => {
    // Before this decision existed, chatStream ran the follow-up
    // whenever gatePrompt returned text — which includes unverified-only.
    const unverifiedOnly = result({ unverified: ['no live page'] })
    assert.notEqual(gatePrompt(unverifiedOnly), null)
    assert.equal(gateNeedsFollowUp(unverifiedOnly), false)
    // Clean results stay follow-up-free under both decisions.
    const clean = result({})
    assert.equal(gatePrompt(clean), null)
    assert.equal(gateNeedsFollowUp(clean), false)
    // Real findings still produce the same prompt.
    const real = result({ layout: [finding], unverified: ['no live page'] })
    assert.notEqual(gatePrompt(real), null)
    assert.equal(gateNeedsFollowUp(real), true)
  })
})

describe('consoleEpochPlan (page-instance epoch)', () => {
  it('same instance keeps the baseline watermark', () => {
    assert.deepEqual(consoleEpochPlan({ seq: 47, instance: 'abc' }, 'abc'), { sinceSeq: 47, reloaded: false })
  })

  it('a different instance means the page reloaded: read from seq 0', () => {
    assert.deepEqual(consoleEpochPlan({ seq: 47, instance: 'abc' }, 'xyz'), { sinceSeq: 0, reloaded: true })
  })

  it('a baseline without an instance still counts as a reload when the page now reports one', () => {
    assert.deepEqual(consoleEpochPlan({ seq: 47 }, 'xyz'), { sinceSeq: 0, reloaded: true })
    assert.deepEqual(consoleEpochPlan({ seq: 0 }, 'xyz'), { sinceSeq: 0, reloaded: true })
  })

  it('no instance from the current page (old client) falls back to seq semantics', () => {
    assert.deepEqual(consoleEpochPlan({ seq: 47, instance: 'abc' }, undefined), { sinceSeq: 47, reloaded: false })
    assert.deepEqual(consoleEpochPlan({ seq: 47 }, undefined), { sinceSeq: 47, reloaded: false })
  })

  it('pool generations (numbers) compare the same way', () => {
    assert.deepEqual(consoleEpochPlan({ seq: 12, instance: 3 }, 3), { sinceSeq: 12, reloaded: false })
    assert.deepEqual(consoleEpochPlan({ seq: 12, instance: 3 }, 4), { sinceSeq: 0, reloaded: true })
  })

  it('the reload note alone never triggers a follow-up', () => {
    const r: GateResult = { ran: true, layout: [], expected: [], console: [], unverified: [PAGE_RELOADED_NOTE] }
    assert.equal(gateNeedsFollowUp(r), false)
  })
})

describe('consoleInstanceOf', () => {
  it('extracts string and number instances, rejects everything else', () => {
    assert.equal(consoleInstanceOf({ instance: 'abc' }), 'abc')
    assert.equal(consoleInstanceOf({ instance: 7 }), 7)
    assert.equal(consoleInstanceOf({ instance: '' }), undefined)
    assert.equal(consoleInstanceOf({ instance: null }), undefined)
    assert.equal(consoleInstanceOf({}), undefined)
    assert.equal(consoleInstanceOf(null), undefined)
    assert.equal(consoleInstanceOf('nope'), undefined)
  })
})

describe('findingKey', () => {
  it('keys overlaps independent of pair order', () => {
    const a = findingKey({ a: 'id:x', b: 'id:y' }, 375)
    const b = findingKey({ b: 'id:y', a: 'id:x' }, 375)
    assert.equal(a, b)
    assert.ok(a.includes('@375'))
  })

  it('keys clipping and overflow distinctly', () => {
    assert.ok(findingKey({ target: 'id:a', clippedBy: 'id:p' }).startsWith('clip:'))
    assert.ok(findingKey({ stableId: 'id:o', axis: 'x' }).startsWith('overflow:'))
  })
})

describe('toLayoutFindings + diffFindings', () => {
  const before = toLayoutFindings({ overlaps: [{ a: 'id:x', b: 'id:y' }] }, 375)
  const after = toLayoutFindings({
    overlaps: [{ a: 'id:x', b: 'id:y' }, { a: 'id:m', b: 'id:n' }],
    clippings: [{ target: 'id:c', clippedBy: 'id:p' }],
  }, 375)

  it('keeps only new findings', () => {
    const diff = diffFindings(before, after)
    assert.equal(diff.length, 2)
    assert.ok(diff.every((f) => f.width === 375))
  })

  it('returns empty when nothing changed', () => {
    assert.deepEqual(diffFindings(before, before), [])
  })

  it('tolerates missing analysis', () => {
    assert.deepEqual(toLayoutFindings(null), [])
    assert.deepEqual(toLayoutFindings(undefined), [])
  })
})

describe('consoleFindings', () => {
  it('keeps only new error-ish entries', () => {
    const entries = [
      { seq: 1, level: 'log', text: 'old' },
      { seq: 5, level: 'log', text: 'fine' },
      { seq: 6, level: 'error', text: 'boom' },
      { seq: 7, level: 'pageerror', text: 'crash' },
      { seq: 8, level: 'warn', text: 'hmm' },
      { seq: 9, level: 'info', text: 'info' },
    ]
    const found = consoleFindings(entries, 5)
    assert.deepEqual(found.map((e) => e.seq), [6, 7, 8])
  })

  it('slice C: editor-attributed entries are not findings, however loud', () => {
    const entries: ConsoleEntry[] = [
      { seq: 6, level: 'error', text: 'app boom' },
      { seq: 7, level: 'error', text: 'overlay exploded', src: 'editor' },
      { seq: 8, level: 'pageerror', text: 'chat crashed', src: 'editor' },
      { seq: 9, level: 'warn', text: 'overlay grumble', src: 'editor' },
      { seq: 10, level: 'warn', text: 'app hmm' },
    ]
    const found = consoleFindings(entries, 5)
    assert.deepEqual(found.map((e) => e.seq), [6, 10])
  })
})

describe('formatGatePrompt', () => {
  it('renders both signals and unverified notes', () => {
    const prompt = formatGatePrompt({
      layout: [{ key: 'k', kind: 'overlap', detail: '{"a":"x"}', width: 375 }],
      console: [{ seq: 2, level: 'error', text: 'boom' }],
      unverified: ['1280px: no live page'],
    })
    assert.ok(prompt.includes('@375px'))
    assert.ok(prompt.includes('[error] boom'))
    assert.ok(prompt.includes('Could not verify'))
    assert.ok(prompt.includes('waive'))
  })

  it('slice C: the prompt’s console section carries app errors only, repeats collapsed', () => {
    const mixed: ConsoleEntry[] = [
      { seq: 2, level: 'error', text: 'overlay exploded', src: 'editor' },
      { seq: 3, level: 'error', text: 'app boom' },
      { seq: 4, level: 'error', text: 'app boom' },
      { seq: 5, level: 'error', text: 'app boom' },
    ]
    const prompt = formatGatePrompt({
      layout: [],
      console: consoleErrorEntries(mixed),
      unverified: [],
    })
    assert.ok(prompt.includes('[error] app boom ×3'), 'identical repeats render once with a ×N suffix')
    assert.ok(!prompt.includes('overlay exploded'), 'the editor’s own error is not the app’s to fix')
    assert.equal(prompt.split('app boom').length - 1, 1, 'the repeated line appears exactly once')
  })

  it('slice B: missing expectations join the prompt as their own section', () => {
    const prompt = formatGatePrompt({
      layout: [],
      console: [],
      unverified: [],
      missingExpectations: ['PROBE-READY', 'PROBE-SAVED'],
    })
    assert.ok(prompt.includes('Expected in console'))
    assert.ok(prompt.includes('"PROBE-READY"'))
    assert.ok(prompt.includes('"PROBE-SAVED"'))
    // And without them the section is absent (older callers unaffected).
    const plain = formatGatePrompt({ layout: [], console: [], unverified: [] })
    assert.ok(!plain.includes('Expected in console'))
  })
})

describe('format interpretation (§B2)', () => {
  const overflow = (axis: 'x' | 'y'): LayoutFinding => ({
    key: `overflow:el:${axis} @375`,
    kind: 'overflow',
    detail: '{}',
    width: 375,
    axis,
  })
  const overlap: LayoutFinding = { key: 'overlap:a|b @375', kind: 'overlap', detail: '{}', width: 375 }

  it('overflow findings carry their axis from the snapshot shape', () => {
    const fromAxis = toLayoutFindings({ overflow: [{ stableId: 'n1', axis: 'y' }] }, 375)
    assert.equal(fromAxis[0].axis, 'y')
    const fromRight = toLayoutFindings({ overflowXOffenders: [{ stableId: 'n2', right: 12 }] }, 375)
    assert.equal(fromRight[0].axis, 'x')
    const fromBottom = toLayoutFindings({ overflow: [{ stableId: 'n3', bottom: 4 }] }, 375)
    assert.equal(fromBottom[0].axis, 'y')
  })

  it('page format: y-overflow is expected, x-overflow and overlaps stay issues', () => {
    const { issues, expected } = applyFormatToFindings([overflow('y'), overflow('x'), overlap], 'page')
    assert.deepEqual(expected.map(f => f.axis), ['y'])
    assert.equal(issues.length, 2)
  })

  it('app format and undesignated keep every finding an issue', () => {
    for (const fmt of ['app', undefined] as const) {
      const { issues, expected } = applyFormatToFindings([overflow('y')], fmt)
      assert.equal(issues.length, 1)
      assert.equal(expected.length, 0)
    }
  })

  it('gate prompt notes expected findings without counting them as issues', () => {
    const text = formatGatePrompt({ layout: [overflow('x')], console: [], unverified: [], expected: [overflow('y'), overflow('y')] })
    assert.match(text, /Not issues: 2 vertical-overflow/)
  })
})
