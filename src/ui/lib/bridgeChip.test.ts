import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deriveBridgeChip } from './bridgeChip.js'
import type { PluginEnsureInfo } from './api.js'

function ensure(state: PluginEnsureInfo['state'], extra: Partial<PluginEnsureInfo> = {}): PluginEnsureInfo {
  return { state, ...extra }
}

describe('deriveBridgeChip', () => {
  it('shows nothing for a project with no live Vite page', () => {
    assert.equal(deriveBridgeChip(ensure('not-vite'), 0).state, 'none')
    assert.equal(deriveBridgeChip(ensure('not-vite'), null).state, 'none')
    // Even a stray client count cannot invent a page for it.
    assert.equal(deriveBridgeChip(ensure('not-vite'), 2).state, 'none')
  })

  it('is bridged when a live page client is connected', () => {
    for (const state of ['registered', 'added', 'standalone'] as const) {
      const chip = deriveBridgeChip(ensure(state), 1)
      assert.equal(chip.state, 'bridged')
      assert.equal(chip.label, 'Bridged')
      assert.equal(chip.tone, 'good')
      assert.match(chip.tooltip, /connected to the editor/)
    }
  })

  it('lets an observed connection outrank a missing-plugin classification', () => {
    // Detection said the plugin could not be verified, but a page is
    // answering on the bridge — the observation is the truth.
    assert.equal(deriveBridgeChip(ensure('cannot'), 1).state, 'bridged')
    assert.equal(deriveBridgeChip(ensure('missing-declined'), 3).state, 'bridged')
    assert.equal(deriveBridgeChip(null, 1).state, 'bridged')
  })

  it('counts multiple connected pages in the tooltip', () => {
    assert.match(deriveBridgeChip(ensure('registered'), 2).tooltip, /2 live pages/)
  })

  it('is not bridged when the plugin is in place but no client answers', () => {
    for (const state of ['registered', 'added', 'standalone'] as const) {
      for (const clients of [0, null]) {
        const chip = deriveBridgeChip(ensure(state), clients)
        assert.equal(chip.state, 'not-bridged', `${state} / clients=${clients}`)
        assert.equal(chip.label, 'Not bridged')
        assert.match(chip.tooltip, /no live page is connected/)
      }
    }
  })

  it('reads a failed status probe as not bridged, never as an error or as bridged', () => {
    // clients === null is the launcher status route failing to
    // produce a count (its relay found nothing answering).
    const chip = deriveBridgeChip(ensure('registered'), null)
    assert.equal(chip.state, 'not-bridged')
    assert.doesNotMatch(chip.tooltip, /error/i)
  })

  it('is plugin missing when ensure could not add the plugin', () => {
    const chip = deriveBridgeChip(ensure('cannot', { configFile: 'vite.config.ts' }), 0)
    assert.equal(chip.state, 'plugin-missing')
    assert.equal(chip.label, 'Plugin missing')
    assert.equal(chip.tone, 'bad')
    assert.match(chip.tooltip, /not in this project's vite config \(vite\.config\.ts\)/)
    assert.match(chip.tooltip, /[Cc]lick/)
    // A failed probe does not mask the plugin problem either.
    assert.equal(deriveBridgeChip(ensure('cannot'), null).state, 'plugin-missing')
  })

  it('is plugin missing when the user declined the plugin', () => {
    const chip = deriveBridgeChip(ensure('missing-declined'), 0)
    assert.equal(chip.state, 'plugin-missing')
    assert.match(chip.tooltip, /off for this project/)
  })

  it('shows nothing when there is no ensure state and no observed client', () => {
    assert.equal(deriveBridgeChip(null, null).state, 'none')
    assert.equal(deriveBridgeChip(null, 0).state, 'none')
  })
})
