import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GRAPH_UPDATE_TARGETS, formatGraphCurrency, graphUpdatePrompt, graphUpdateTarget, parseGraphUpdateCommand } from './graphUpdate.js'

describe('parseGraphUpdateCommand', () => {
  it('defaults the bare command to the feature graph', () => {
    assert.deepEqual(parseGraphUpdateCommand('/graph-update'), { target: 'feature' })
    assert.deepEqual(parseGraphUpdateCommand('  /graph-update  '), { target: 'feature' })
  })

  it('reads an explicit target, case-insensitively', () => {
    assert.deepEqual(parseGraphUpdateCommand('/graph-update feature'), { target: 'feature' })
    assert.deepEqual(parseGraphUpdateCommand('/graph-update Data'), { target: 'data' })
  })

  it('is not this command when the line is anything else', () => {
    assert.equal(parseGraphUpdateCommand('/graph'), null)
    assert.equal(parseGraphUpdateCommand('/graph-update feature please'), null)
    assert.equal(parseGraphUpdateCommand('please /graph-update'), null)
    assert.equal(parseGraphUpdateCommand(''), null)
  })
})

describe('graph update targets', () => {
  it('feature is the one ready target; later graphs are declared, not hidden', () => {
    assert.equal(graphUpdateTarget('feature')?.ready, true)
    const later = GRAPH_UPDATE_TARGETS.filter(t => !t.ready)
    assert.ok(later.length >= 2)
    assert.ok(later.every(t => t.id !== 'feature'))
  })

  it('formatGraphCurrency covers every stamp/HEAD combination', () => {
    const commit = 'a'.repeat(40)
    const other = 'b'.repeat(40)
    const at = new Date('2026-01-02T03:04:05Z').getTime()
    assert.equal(formatGraphCurrency(null, other, null).tone, 'warn')
    assert.match(formatGraphCurrency(null, other, null).text, /Not stamped/)
    assert.match(formatGraphCurrency({ commit: null, at }, other, null).text, /no git repo/)
    assert.match(formatGraphCurrency({ commit, at }, null, null).text, /HEAD unreadable/)
    assert.match(formatGraphCurrency({ commit, at }, commit, 0).text, /^Current/)
    assert.match(formatGraphCurrency({ commit, at }, other, 1).text, /^1 commit behind/)
    assert.match(formatGraphCurrency({ commit, at }, other, 3).text, /^3 commits behind/)
    assert.match(formatGraphCurrency({ commit, at }, other, null).text, /^Repo moved/)
  })

  it('the prompt names the feature tools and the reconcile rules', () => {
    const p = graphUpdatePrompt('feature')
    assert.match(p, /feature graph/)
    assert.match(p, /feature-add-node/)
    assert.match(p, /feature-set-status/)
    assert.match(p, /ai-features\/graph\.json/)
    assert.match(p, /reconcile instead of rebuilding/)
    assert.match(p, /drift/)
  })
})
