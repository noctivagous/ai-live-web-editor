import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ACTION_FACETS, ACTION_GROUPS, AGENT_ACTIONS, actionAvailability, actionsForContext, actionsForFacet,
  actionsForGroup, isCodeFile, promptTextFor, searchActions,
  type ActionContext,
} from './agentActions.js'

const PROJECT: ActionContext = { hasProject: true, activePath: '/src/App.tsx', hasFeatureGraph: true }

describe('agentActions registry', () => {
  it('ids are unique and every action is complete', () => {
    const ids = new Set<string>()
    for (const a of AGENT_ACTIONS) {
      assert.ok(!ids.has(a.id), `duplicate action id ${a.id}`)
      ids.add(a.id)
      assert.ok(a.title.length > 0, `${a.id} has no title`)
      assert.ok(a.blurb.length > 0, `${a.id} has no blurb`)
      assert.ok(ACTION_GROUPS.includes(a.group), `${a.id} has unknown group ${a.group}`)
      if (a.dispatch.kind === 'prompt') assert.ok(a.dispatch.text.length > 20, `${a.id} prompt too thin to unlock its tools`)
      if (a.dispatch.kind === 'settings') assert.ok(a.dispatch.section.length > 0, `${a.id} has no settings section`)
    }
  })

  it('every group has at least one action and groups partition the registry', () => {
    let total = 0
    for (const g of ACTION_GROUPS) {
      const list = actionsForGroup(g)
      assert.ok(list.length > 0, `group ${g} is empty`)
      total += list.length
    }
    assert.equal(total, AGENT_ACTIONS.length)
  })

  it('the {file} slot appears only on file-bound actions', () => {
    for (const a of AGENT_ACTIONS) {
      if (a.dispatch.kind !== 'prompt') continue
      if (a.dispatch.text.includes('{file}')) {
        assert.ok(a.needs === 'codeFile' || a.needs === 'file', `${a.id} uses {file} without a file need`)
        assert.equal(a.context, 'file', `${a.id} uses {file} without the file context`)
      }
    }
    const unpack = AGENT_ACTIONS.find(a => a.id === 'unpack-open-file')!
    assert.equal(promptTextFor(unpack, PROJECT), unpack.dispatch.kind === 'prompt' ? unpack.dispatch.text.replace('{file}', '/src/App.tsx') : '')
  })
})

describe('actionAvailability', () => {
  it('everything project-bound closes when no project is open', () => {
    const ctx: ActionContext = { hasProject: false }
    for (const a of AGENT_ACTIONS) {
      const v = actionAvailability(a, ctx)
      assert.equal(v.available, false, `${a.id} should be unavailable without a project`)
      assert.match(v.reason ?? '', /Open a project first/)
    }
  })

  it('unpack needs a JS/TS file open', () => {
    const unpack = AGENT_ACTIONS.find(a => a.id === 'unpack-open-file')!
    assert.equal(actionAvailability(unpack, PROJECT).available, true)
    const css: ActionContext = { hasProject: true, activePath: '/src/app.css', hasFeatureGraph: true }
    const v = actionAvailability(unpack, css)
    assert.equal(v.available, false)
    assert.match(v.reason ?? '', /JS or TS file/)
    assert.equal(isCodeFile('/a/b.mjs'), true)
    assert.equal(isCodeFile('/a/b.css'), false)
    assert.equal(isCodeFile(undefined), false)
  })

  it('facet filtering keeps facet-free actions in every facet', () => {
    for (const f of ACTION_FACETS) {
      const list = actionsForFacet(f.id)
      assert.ok(list.some(a => a.facet === f.id), `${f.id} facet has no actions of its own`)
      assert.ok(list.some(a => a.facet === 'any'), `${f.id} facet lost the facet-free actions`)
      assert.ok(list.every(a => a.facet === f.id || a.facet === 'any'), `${f.id} facet leaked another facet's actions`)
    }
    const design = actionsForFacet('graphic-design')
    assert.ok(design.some(a => a.id === 'make-responsive'))
    assert.ok(!design.some(a => a.id === 'install-pack'), 'features-facet action leaked into graphic design')
    assert.equal(actionsForFacet(null).length, AGENT_ACTIONS.length)
  })

  it('search matches every word, by title, blurb, group, or keyword', () => {
    assert.equal(searchActions('').length, AGENT_ACTIONS.length)
    assert.deepEqual(searchActions('map codebase').map(a => a.id), ['map-codebase'])
    assert.ok(searchActions('minified').some(a => a.id === 'unpack-open-file'), 'keyword search missed unpack')
    assert.ok(searchActions('mobile widths').some(a => a.id === 'make-responsive'), 'keyword search missed responsive')
    assert.equal(searchActions('zzzznope').length, 0)
    // Title hits rank before blurb/keyword hits.
    const graphHits = searchActions('feature graph')
    assert.equal(graphHits[0].id, 'open-graph')
  })

  it('context actions: file actions need an open file, page actions need a marked page', () => {
    const fileActions = actionsForContext('file')
    assert.ok(fileActions.some(a => a.id === 'explain-file'))
    assert.ok(fileActions.some(a => a.id === 'unpack-open-file'))
    const pageActions = actionsForContext('page')
    assert.ok(pageActions.some(a => a.id === 'layout-snapshot'))
    assert.ok(pageActions.some(a => a.id === 'make-responsive'))
    for (const a of [...fileActions, ...pageActions]) {
      assert.ok(a.needs === 'file' || a.needs === 'codeFile' || a.needs === 'page', `${a.id} is a context action without a context need`)
    }
    const explain = fileActions.find(a => a.id === 'explain-file')!
    assert.equal(actionAvailability(explain, { hasProject: true }).available, false)
    assert.match(actionAvailability(explain, { hasProject: true }).reason ?? '', /Open a file first/)
    assert.equal(actionAvailability(explain, PROJECT).available, true)
    const layout = pageActions.find(a => a.id === 'layout-snapshot')!
    const noPage: ActionContext = { hasProject: true, activePath: '/index.html', hasPage: false }
    assert.match(actionAvailability(layout, noPage).reason ?? '', /Mark a file for preview first/)
    assert.equal(actionAvailability(layout, { ...noPage, hasPage: true }).available, true)
    assert.equal(actionAvailability(layout, { ...noPage, hasPage: null }).available, true, 'unknown page state must not grey the action')
  })

  it('feature-graph actions close only when the graph is known absent', () => {
    const plan = AGENT_ACTIONS.find(a => a.id === 'plan-from-graph')!
    assert.equal(actionAvailability(plan, PROJECT).available, true)
    const absent: ActionContext = { hasProject: true, hasFeatureGraph: false }
    const v = actionAvailability(plan, absent)
    assert.equal(v.available, false)
    assert.match(v.reason ?? '', /No feature graph yet/)
    const unknown: ActionContext = { hasProject: true, hasFeatureGraph: null }
    assert.equal(actionAvailability(plan, unknown).available, true, 'unknown graph state must not grey the action')
  })
})
