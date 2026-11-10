import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  beginConsoleExpectations,
  collectConsoleExpectations,
  declareConsoleExpectation,
  endConsoleExpectations,
  leftoverProbeNotes,
  matchExpectations,
  resetConsoleExpectationsForTests,
} from './consoleExpectations.js'
import type { ConsoleEntry } from './gate.js'

const entry = (seq: number, level: string, text: string): ConsoleEntry => ({ seq, level, text })

describe('console expectation registry (turn scoping)', () => {
  afterEach(() => resetConsoleExpectationsForTests())

  it('declaring with no active turn is an honest error, not a silent drop', () => {
    const r = declareConsoleExpectation('PROBE-1')
    assert.ok('error' in r)
  })

  it('declarations accumulate for the turn; duplicates collapse', () => {
    assert.equal(beginConsoleExpectations('turn-a'), true)
    assert.deepEqual(declareConsoleExpectation('PROBE-1'), { ok: true, declared: 1 })
    assert.deepEqual(declareConsoleExpectation('PROBE-2'), { ok: true, declared: 2 })
    assert.deepEqual(declareConsoleExpectation('PROBE-1'), { ok: true, declared: 2 })
    assert.deepEqual(collectConsoleExpectations('turn-a'), ['PROBE-1', 'PROBE-2'])
  })

  it('blank literals are refused', () => {
    beginConsoleExpectations('turn-a')
    assert.ok('error' in declareConsoleExpectation('   '))
    assert.ok('error' in declareConsoleExpectation(''))
  })

  it('collect is keyed: another turn id gets nothing, never this turn’s list', () => {
    beginConsoleExpectations('turn-a')
    declareConsoleExpectation('PROBE-1')
    assert.deepEqual(collectConsoleExpectations('turn-b'), [])
    assert.deepEqual(collectConsoleExpectations('turn-a'), ['PROBE-1'])
  })

  it('a second concurrent turn cannot steal the scope — its declarations go nowhere', () => {
    beginConsoleExpectations('turn-a')
    declareConsoleExpectation('A-PROBE')
    assert.equal(beginConsoleExpectations('turn-b'), false, 'begin refuses while a scope is live')
    // turn-b's agent calls the tool: the literal lands in turn-a's
    // scope only if it were mis-keyed — it must not reach turn-b's
    // report either way; turn-b collects nothing.
    assert.deepEqual(collectConsoleExpectations('turn-b'), [])
    endConsoleExpectations('turn-a')
    assert.equal(beginConsoleExpectations('turn-b'), true, 'after the first turn ends, the scope frees')
    assert.deepEqual(collectConsoleExpectations('turn-b'), [])
  })

  it('an abandoned scope expires: a later turn can begin after the TTL', () => {
    const t0 = 1_000_000
    assert.equal(beginConsoleExpectations('turn-a', t0), true)
    assert.equal(beginConsoleExpectations('turn-b', t0 + 60_000), false)
    assert.equal(beginConsoleExpectations('turn-b', t0 + 11 * 60_000), true)
  })

  it('end closes only its own turn’s scope', () => {
    beginConsoleExpectations('turn-a')
    endConsoleExpectations('turn-b')
    assert.deepEqual(declareConsoleExpectation('STILL-OPEN'), { ok: true, declared: 1 })
    endConsoleExpectations('turn-a')
    assert.ok('error' in declareConsoleExpectation('CLOSED'))
  })
})

describe('matchExpectations', () => {
  it('matched: literal substring of an entry, any level counts, matched entry reported', () => {
    const results = matchExpectations(['PROBE-1'], [entry(3, 'log', 'boot PROBE-1 done')])
    assert.deepEqual(results, [{ text: 'PROBE-1', matched: true, matchedText: 'boot PROBE-1 done' }])
  })

  it('missing: no entry contains the literal', () => {
    const results = matchExpectations(['PROBE-X'], [entry(1, 'error', 'unrelated boom')])
    assert.deepEqual(results, [{ text: 'PROBE-X', matched: false }])
  })

  it('multiple declarations are judged independently, in declaration order', () => {
    const entries = [entry(1, 'warn', 'has B inside'), entry(2, 'pageerror', 'has A')]
    const results = matchExpectations(['A', 'B', 'C'], entries)
    assert.deepEqual(results.map((r) => [r.text, r.matched]), [['A', true], ['B', true], ['C', false]])
  })

  it('matching is a literal substring, not a pattern', () => {
    const results = matchExpectations(['a.c'], [entry(1, 'log', 'abc')])
    assert.equal(results[0].matched, false)
    const literal = matchExpectations(['a.c'], [entry(1, 'log', 'xa.cy')])
    assert.equal(literal[0].matched, true)
  })

  it('no declarations → no results', () => {
    assert.deepEqual(matchExpectations([], [entry(1, 'log', 'x')]), [])
  })
})

describe('leftoverProbeNotes', () => {
  it('a literal still present in a written file is noted once per file', () => {
    const notes = leftoverProbeNotes(['PROBE-1'], [
      { path: 'src/main.ts', content: 'console.log("PROBE-1")' },
      { path: 'src/other.ts', content: 'clean' },
    ])
    assert.deepEqual(notes, ['probe left in src/main.ts'])
  })

  it('a removed probe (literal absent) earns no note', () => {
    assert.deepEqual(leftoverProbeNotes(['PROBE-1'], [{ path: 'a.ts', content: 'nothing here' }]), [])
  })

  it('two literals in one file still produce one note for that file', () => {
    const notes = leftoverProbeNotes(['P1', 'P2'], [{ path: 'a.ts', content: 'P1 and P2' }])
    assert.deepEqual(notes, ['probe left in a.ts'])
  })
})
