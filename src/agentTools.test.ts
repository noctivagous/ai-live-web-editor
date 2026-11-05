import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { activeToolsForMode, FILE_ACTIVE_TOOLS, SKETCH_ACTIVE_TOOLS } from './agentTools.js'

describe('activeToolsForMode', () => {
  it('hides patch-dom in Files and write tools in Live sketch', () => {
    const files = activeToolsForMode('files')
    const sketch = activeToolsForMode('sketch')
    assert.ok(files.includes('str-replace'))
    assert.ok(files.includes('inspect-dom'))
    assert.ok(files.includes('take-snapshot'))
    assert.equal(files.includes('patch-dom'), false)
    assert.equal(files.includes('eval-js'), false)
    assert.ok(sketch.includes('patch-dom'))
    assert.ok(sketch.includes('take-snapshot'))
    assert.ok(sketch.includes('eval-js'))
    assert.equal(sketch.includes('str-replace'), false)
    assert.equal(sketch.includes('write-real-file'), false)
    assert.deepEqual(files, [...FILE_ACTIVE_TOOLS])
    assert.deepEqual(sketch, [...SKETCH_ACTIVE_TOOLS])
  })
})
