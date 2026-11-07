import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import vm from 'node:vm'
import { buildRunProgram, MAX_RUN_VALUE_CHARS, normalizeRunResult } from './runInPage.js'

/**
 * The program is exercised for real: built, then evaluated in a
 * fresh vm context (console + timers provided, like a page) and the
 * resolved result normalized — the same path the pool channel takes,
 * minus the browser.
 */
async function runInVm(code: string, timeoutMs?: number): Promise<unknown> {
  const sandbox: Record<string, unknown> = { console, setTimeout, clearTimeout }
  vm.createContext(sandbox)
  const program = buildRunProgram(code, timeoutMs)
  return await vm.runInContext(program, sandbox)
}

/** vm-realm arrays fail deepStrictEqual prototype checks; re-home them. */
const host = (a: unknown): unknown[] => [...(a as unknown[])]

describe('run-in-page program (run in a vm)', () => {
  it('returns the value the code returns', async () => {
    const r = normalizeRunResult(await runInVm('return 1 + 1'))
    assert.equal(r?.ok, true)
    assert.equal(r?.value, 2)
    assert.deepEqual(host(r?.console), [])
  })

  it('awaits promises in the code', async () => {
    const r = normalizeRunResult(await runInVm('const v = await Promise.resolve(41); return v + 1'))
    assert.equal(r?.ok, true)
    assert.equal(r?.value, 42)
  })

  it('captures console output during the run, formatted', async () => {
    const r = normalizeRunResult(await runInVm("console.log('checking', { total: 3 }); console.warn('careful'); return 'done'"))
    assert.equal(r?.ok, true)
    assert.deepEqual(host(r?.console), ['log: checking {"total":3}', 'warn: careful'])
  })

  it('a throw comes back as a structured error, not a rejection', async () => {
    const r = normalizeRunResult(await runInVm("throw new TypeError('boom')"))
    assert.equal(r?.ok, false)
    assert.equal(r?.error?.name, 'TypeError')
    assert.equal(r?.error?.message, 'boom')
    assert.ok(r?.error?.stack?.includes('TypeError'))
  })

  it('a syntax error is a run failure with the parser message', async () => {
    const r = normalizeRunResult(await runInVm('return 1 +'))
    assert.equal(r?.ok, false)
    assert.equal(r?.error?.name, 'SyntaxError')
  })

  it('times out a run that never settles', async () => {
    const r = normalizeRunResult(await runInVm('await new Promise(() => {})', 300))
    assert.equal(r?.ok, false)
    assert.match(r?.error?.message || '', /timed out after 300ms/)
  })

  it('serializes awkward values safely: circular, function, element-shaped, deep', async () => {
    const r = normalizeRunResult(await runInVm(`
      const o = { a: 1 }; o.self = o
      return {
        circ: o,
        fn: function greet() {},
        el: { nodeType: 1, tagName: 'SECTION', id: 'pricing', className: 'pricing wide' },
        nothing: undefined,
        big: 10n,
      }
    `))
    assert.equal(r?.ok, true)
    const v = r?.value as Record<string, unknown>
    assert.equal((v.circ as Record<string, unknown>).self, '[circular]')
    assert.equal(v.fn, '[function greet]')
    assert.equal(v.el, '[Element section#pricing.pricing.wide]')
    assert.equal(v.nothing, '[undefined]')
    assert.equal(v.big, '10n')
  })

  it('the embedding cannot be broken out of by quotes or backslashes', async () => {
    const code = 'return "a \\"quoted\\" \\\\ string"'
    const r = normalizeRunResult(await runInVm(code))
    assert.equal(r?.ok, true)
    assert.equal(r?.value, 'a "quoted" \\ string')
  })
})

describe('normalizeRunResult', () => {
  it('unwraps the channel envelopes', () => {
    const inner = { ok: true, value: 7, console: [], elapsedMs: 5 }
    assert.equal(normalizeRunResult(inner)?.value, 7)
    assert.equal(normalizeRunResult({ result: inner })?.value, 7)
    assert.equal(normalizeRunResult({ result: JSON.stringify(inner) })?.value, 7)
    assert.equal(normalizeRunResult({ via: 'pool', result: inner })?.value, 7)
  })

  it('rejects non-results', () => {
    assert.equal(normalizeRunResult(null), null)
    assert.equal(normalizeRunResult('yes'), null)
    assert.equal(normalizeRunResult({ sections: [] }), null)
    assert.equal(normalizeRunResult({ ok: 'true' }), null)
  })

  it('replaces an oversized value with a note instead of passing it through', () => {
    const big = { ok: true, value: 'x'.repeat(MAX_RUN_VALUE_CHARS + 100), console: [] }
    const r = normalizeRunResult(big)
    assert.match(String(r?.value), /value too large/)
  })

  it('bounds console lines and clips error fields', () => {
    const many = { ok: false, error: { name: 'E', message: 'm'.repeat(900) }, console: Array.from({ length: 80 }, (_, i) => `line ${i}`), elapsedMs: 3 }
    const r = normalizeRunResult(many)
    assert.equal(r?.console.length, 50)
    assert.ok((r?.error?.message.length || 0) <= 500)
  })
})
