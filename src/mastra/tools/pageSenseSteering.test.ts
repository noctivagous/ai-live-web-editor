import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { layoutSnapshotTool, pageSectionsTool } from './layoutTools.js'
import { inspectDOMTool, takeSnapshotTool } from './realFsTools.js'

/**
 * The page senses steer by description: the model picks between
 * page-sections / layout-snapshot / inspect-dom / take-snapshot from
 * these texts alone, so the reciprocal pointers are pinned here
 * (slice 4). If a rewrite drops a pointer, this fails before a turn
 * does.
 */
describe('page-sense steering (tool descriptions)', () => {
  it('every sense names page-sections as the structural first look', () => {
    for (const tool of [takeSnapshotTool, inspectDOMTool, layoutSnapshotTool]) {
      assert.ok(tool.description?.includes('page-sections'), `${tool.id} description must point at page-sections`)
    }
  })

  it('take-snapshot is positioned as selectors/accessibility, not structure', () => {
    assert.ok(takeSnapshotTool.description?.includes('scopeSelector'))
    assert.equal(takeSnapshotTool.description?.includes('Prefer this over inspect-dom'), false)
  })

  it('inspect-dom is positioned as the last step on one element', () => {
    assert.ok(inspectDOMTool.description?.includes('layout-snapshot'))
    assert.ok(inspectDOMTool.description?.includes('sourceLoc'))
  })

  it('layout-snapshot teaches the scopeSelector join with page-sections', () => {
    assert.ok(layoutSnapshotTool.description?.includes('scopeSelector'))
  })

  it('page-sections points onward to the drill-in tools', () => {
    assert.ok(pageSectionsTool.description?.includes('inspect-dom'))
    assert.ok(pageSectionsTool.description?.includes('layout-snapshot'))
  })
})
