import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  activeToolsForMode,
  FILE_ACTIVE_TOOLS,
  FILE_CATALOG_TOOLS,
  FILE_CORE_TOOLS,
  FILE_LAYOUT_TOOLS,
  FILE_PLAN_TOOLS,
  FILE_RESEARCH_TOOLS,
  fileToolsForTurn,
  SKETCH_ACTIVE_TOOLS,
} from './agentTools.js'

describe('activeToolsForMode', () => {
  it('hides patch-dom in Files and write tools in Live sketch', () => {
    const files = activeToolsForMode('files')
    const sketch = activeToolsForMode('sketch')
    assert.ok(files.includes('str-replace'))
    assert.ok(files.includes('codebase-map'))
    assert.equal(sketch.includes('codebase-map'), false)
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

describe('fileToolsForTurn', () => {
  it('sends only the core set for a plain file fix', () => {
    const tools: string[] = fileToolsForTurn({ userText: 'fix the typo in the greeting function' })
    for (const t of [...FILE_LAYOUT_TOOLS, ...FILE_CATALOG_TOOLS, ...FILE_RESEARCH_TOOLS, ...FILE_PLAN_TOOLS]) {
      assert.equal(tools.includes(t), false, `${t} should not ride a copy fix`)
    }
    // Last: deepEqual's assertion signature narrows `tools` to the core type.
    assert.deepEqual(tools, [...FILE_CORE_TOOLS])
  })

  it('adds the layout group for page/layout asks and bare URLs', () => {
    const tools = fileToolsForTurn({ userText: 'the cards overlap on mobile, check the layout' })
    for (const t of FILE_LAYOUT_TOOLS) assert.ok(tools.includes(t), t)
    assert.equal(tools.includes('plan-finish'), false)
    assert.ok(fileToolsForTurn({ userText: 'open https://example.com and compare' }).includes('pool-open'))
  })

  it('adds the catalog group for component/template asks', () => {
    const tools = fileToolsForTurn({ userText: 'add a pricing section with a call-to-action button' })
    for (const t of FILE_CATALOG_TOOLS) assert.ok(tools.includes(t), t)
  })

  it('adds research tools only when a backend exists AND the ask needs the web', () => {
    const ask = 'check the latest docs for the stripe api'
    for (const t of FILE_RESEARCH_TOOLS) {
      assert.ok(fileToolsForTurn({ userText: ask, searchAvailable: true }).includes(t), t)
      assert.equal(fileToolsForTurn({ userText: ask, searchAvailable: false }).includes(t), false, t)
      assert.equal(fileToolsForTurn({ userText: 'fix the typo', searchAvailable: true }).includes(t), false, t)
    }
  })

  it('adds plan tools on plan state or plan talk, not otherwise', () => {
    for (const t of FILE_PLAN_TOOLS) {
      assert.ok(fileToolsForTurn({ userText: 'fix the typo', hasActivePlan: true }).includes(t), t)
      assert.ok(fileToolsForTurn({ userText: 'revise the plan questions' }).includes(t), t)
      assert.equal(fileToolsForTurn({ userText: 'fix the typo' }).includes(t), false, t)
    }
  })

  it('the groups partition the full set, and a fully-triggered turn gets all of it', () => {
    const grouped = [...FILE_CORE_TOOLS, ...FILE_LAYOUT_TOOLS, ...FILE_CATALOG_TOOLS, ...FILE_RESEARCH_TOOLS, ...FILE_PLAN_TOOLS]
    assert.deepEqual([...grouped].sort(), [...FILE_ACTIVE_TOOLS].sort())
    const all = fileToolsForTurn({
      userText: 'check the layout of the pricing page, search the latest docs, then update the plan',
      hasActivePlan: true,
      searchAvailable: true,
    })
    assert.deepEqual(all, [...FILE_ACTIVE_TOOLS])
  })
})
