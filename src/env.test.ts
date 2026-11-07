import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { uiServing } from './env.js'

describe('uiServing', () => {
  it('defaults to source — editing the editor needs no build in the loop', () => {
    assert.equal(uiServing({}), 'source')
    assert.equal(uiServing({ AI_LIVE_UI: '' }), 'source')
    assert.equal(uiServing({ AI_LIVE_UI: 'source' }), 'source')
    assert.equal(uiServing({ AI_LIVE_UI: 'anything-else' }), 'source')
  })

  it('serves the built bundle only when asked', () => {
    assert.equal(uiServing({ AI_LIVE_UI: 'build' }), 'build')
    assert.equal(uiServing({ AI_LIVE_UI: 'BUILD' }), 'build')
    assert.equal(uiServing({ AI_LIVE_UI: ' built ' }), 'build')
    assert.equal(uiServing({ AI_LIVE_UI: 'dist' }), 'build')
  })
})
