import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { detectDemoMode, DEMO_HOSTS, type DemoModeSources } from './demoMode'

const base: DemoModeSources = { envFlag: false, hostname: 'localhost', search: '', storedFlag: false }
const on = (patch: Partial<DemoModeSources>) => detectDemoMode({ ...base, ...patch })

describe('demoMode detection matrix', () => {
  it('is off for an ordinary local run', () => {
    assert.equal(on({}), false)
    assert.equal(on({ hostname: '127.0.0.1' }), false)
    assert.equal(on({ hostname: 'editor.example.com', search: '?x=1' }), false)
  })

  it('the build flag turns it on anywhere', () => {
    assert.equal(on({ envFlag: true }), true)
    assert.equal(on({ envFlag: true, hostname: 'anything.example' }), true)
  })

  it('any *.vercel.app host turns it on', () => {
    assert.equal(on({ hostname: 'ai-live-web-editor.vercel.app' }), true)
    assert.equal(on({ hostname: 'ale-git-feat-vercel-demo.vercel.app' }), true)
  })

  it('listed demo hosts turn it on, lookalikes do not', () => {
    for (const h of DEMO_HOSTS) assert.equal(on({ hostname: h }), true)
    assert.equal(on({ hostname: 'notvercel.app' }), false)
    assert.equal(on({ hostname: 'vercel.app.evil.example' }), false)
  })

  it('?demo=1 turns it on; other values do not', () => {
    assert.equal(on({ search: '?demo=1' }), true)
    assert.equal(on({ search: '?x=2&demo=1' }), true)
    assert.equal(on({ search: '?demo=0' }), false)
    assert.equal(on({ search: '?demo=true' }), false)
  })

  it('the stored offer flag turns it on', () => {
    assert.equal(on({ storedFlag: true }), true)
  })
})
