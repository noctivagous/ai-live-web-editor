import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  activeToolsForMode,
  FILE_ACTIVE_TOOLS,
  FILE_CATALOG_TOOLS,
  FILE_CODE_TOOLS,
  FILE_CORE_TOOLS,
  FILE_FEATURE_TOOLS,
  FILE_LAYOUT_TOOLS,
  FILE_PLAN_TOOLS,
  FILE_DATA_TOOLS,
  FILE_DOC_TOOLS,
  FILE_RESEARCH_TOOLS,
  FILE_SPREADSHEET_TOOLS,
  FILE_USERFLOW_TOOLS,
  fileToolsForTurn,
  isWriteTool,
  SKETCH_ACTIVE_TOOLS,
  WRITE_TOOLS,
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
    for (const t of [...FILE_LAYOUT_TOOLS, ...FILE_CATALOG_TOOLS, ...FILE_CODE_TOOLS, ...FILE_RESEARCH_TOOLS, ...FILE_PLAN_TOOLS]) {
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

  it('adds the data group for structured-data asks only', () => {
    for (const t of FILE_DATA_TOOLS) {
      assert.ok(fileToolsForTurn({ userText: 'bump the version in package.json' }).includes(t), t)
      assert.ok(fileToolsForTurn({ userText: 'change the timeout in the workflow yaml' }).includes(t), t)
      assert.equal(fileToolsForTurn({ userText: 'fix the typo in the greeting function' }).includes(t), false, t)
    }
  })

  it('adds the doc group for document asks only', () => {
    for (const t of FILE_DOC_TOOLS) {
      assert.ok(fileToolsForTurn({ userText: 'rewrite the second paragraph of the readme' }).includes(t), t)
      assert.ok(fileToolsForTurn({ userText: 'make the markdown heading bigger' }).includes(t), t)
      assert.equal(fileToolsForTurn({ userText: 'fix the typo in the greeting function' }).includes(t), false, t)
    }
  })

  it('adds the spreadsheet group for spreadsheet asks only', () => {
    for (const t of FILE_SPREADSHEET_TOOLS) {
      assert.ok(fileToolsForTurn({ userText: 'update the price cell in sales.csv' }).includes(t), t)
      assert.ok(fileToolsForTurn({ userText: 'add a row to the spreadsheet' }).includes(t), t)
      assert.equal(fileToolsForTurn({ userText: 'lay the cards out in two columns' }).includes(t), false, t)
    }
  })

  it('adds the workbench code group for dense-code asks', () => {
    for (const t of FILE_CODE_TOOLS) {
      assert.ok(fileToolsForTurn({ userText: 'unpack the minified vendor bundle' }).includes(t), t)
      assert.ok(fileToolsForTurn({ userText: 'look inside dist/app.min.js' }).includes(t), t)
      assert.equal(fileToolsForTurn({ userText: 'fix the typo' }).includes(t), false, t)
    }
  })

  it('offers read-symbol on every Files turn', () => {
    assert.ok(FILE_CORE_TOOLS.includes('read-symbol'))
    assert.ok(fileToolsForTurn({ userText: 'fix the typo' }).includes('read-symbol'))
    assert.equal(FILE_CODE_TOOLS.includes('read-symbol' as typeof FILE_CODE_TOOLS[number]), false)
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

  it('adds feature tools on feature-graph state or feature-graph talk, not otherwise', () => {
    for (const t of FILE_FEATURE_TOOLS) {
      assert.ok(fileToolsForTurn({ userText: 'fix the typo', hasFeatureGraph: true }).includes(t), t)
      assert.ok(fileToolsForTurn({ userText: 'what does the feature graph say is blocked?' }).includes(t), t)
      assert.equal(fileToolsForTurn({ userText: 'add a feature to the header' }).includes(t), false, t)
    }
  })

  it('adds user flow tools on user-flow state or user-flow talk, not otherwise', () => {
    for (const t of FILE_USERFLOW_TOOLS) {
      assert.ok(fileToolsForTurn({ userText: 'fix the typo', hasUserFlowGraph: true }).includes(t), t)
      assert.ok(fileToolsForTurn({ userText: 'what does the user flow say is blocked?' }).includes(t), t)
      assert.ok(fileToolsForTurn({ userText: 'update the flow graph' }).includes(t), t)
      assert.equal(fileToolsForTurn({ userText: 'add a feature to the header' }).includes(t), false, t)
      assert.equal(fileToolsForTurn({ userText: 'fix the typo' }).includes(t), false, t)
    }
  })

  it('the groups partition the full set, and a fully-triggered turn gets all of it', () => {
    const grouped = [...FILE_CORE_TOOLS, ...FILE_LAYOUT_TOOLS, ...FILE_CATALOG_TOOLS, ...FILE_CODE_TOOLS, ...FILE_RESEARCH_TOOLS, ...FILE_PLAN_TOOLS, ...FILE_FEATURE_TOOLS, ...FILE_USERFLOW_TOOLS, ...FILE_SPREADSHEET_TOOLS, ...FILE_DATA_TOOLS, ...FILE_DOC_TOOLS]
    assert.deepEqual([...grouped].sort(), [...FILE_ACTIVE_TOOLS].sort())
    const all = fileToolsForTurn({
      userText: 'check the layout of the pricing page, search the latest docs, unpack the bundle, then update the plan and the feature graph and fix the sales spreadsheet and the app config json and rewrite the readme heading',
      hasActivePlan: true,
      hasFeatureGraph: true,
      hasUserFlowGraph: true,
      searchAvailable: true,
    })
    assert.deepEqual(all, [...FILE_ACTIVE_TOOLS])
  })
})

describe('WRITE_TOOLS (slice 3)', () => {
  it('is exactly the tools that write project files', () => {
    assert.deepEqual([...WRITE_TOOLS].sort(), [
      'data-add',
      'data-remove',
      'data-set',
      'delete-file',
      'doc-add-block',
      'doc-remove-block',
      'doc-set-item',
      'doc-set-style',
      'doc-set-text',
      'feature-build-node',
      'feature-set-param',
      'install-catalog-component',
      'make-dir',
      'place-template',
      'rename-file',
      'spreadsheet-add-row',
      'spreadsheet-set-cell',
      'str-replace',
      'write-real-file',
    ])
    for (const t of WRITE_TOOLS) assert.equal(isWriteTool(t), true, t)
    for (const t of ['grep', 'read-real-file', 'research', 'adopt-registry', 'patch-dom', 'plan-update-task']) {
      assert.equal(isWriteTool(t), false, t)
    }
  })

  it('every write tool is a registered Files tool', () => {
    for (const t of WRITE_TOOLS) assert.ok((FILE_ACTIVE_TOOLS as readonly string[]).includes(t), t)
  })
})
