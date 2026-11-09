import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fileToolsForTurn } from '../../agentTools.js'
import { GRAPH_UPDATE_TARGETS, dogfoodRunPrompt, formatGraphCurrency, graphUpdatePrompt, graphUpdateTarget, parseGraphUpdateCommand } from './graphUpdate.js'

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

  it('userflow is a ready target beside feature; architecture and data stay stubbed', () => {
    assert.deepEqual(parseGraphUpdateCommand('/graph-update userflow'), { target: 'userflow' })
    assert.equal(graphUpdateTarget('userflow')?.ready, true)
    assert.equal(graphUpdateTarget('architecture')?.ready, false)
    assert.equal(graphUpdateTarget('data')?.ready, false)
  })

  it('the userflow prompt drives the userflow tools and keeps verification earned', () => {
    const p = graphUpdatePrompt('userflow')
    assert.match(p, /userflow-query/)
    assert.match(p, /userflow-add-step/)
    assert.match(p, /userflow-set-verification/)
    assert.match(p, /userflow-link/)
    assert.match(p, /ai-user-flows\/graph\.json/)
    assert.match(p, /reconcile instead of rebuilding/)
    assert.match(p, /stays untested/)
    assert.match(p, /exercises/)
    assert.doesNotMatch(graphUpdatePrompt('feature'), /ai-user-flows/)
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

describe('dogfood run prompt', () => {
  const p = dogfoodRunPrompt()

  it('drives the userflow tools and lands in the flow graph store', () => {
    assert.match(p, /user flow graph/)
    assert.match(p, /userflow-query/)
    assert.match(p, /userflow-set-verification/)
    assert.match(p, /userflow-link/)
    assert.match(p, /ai-user-flows\/graph\.json/)
  })

  it('the no-page check comes first and forbids simulating a drive', () => {
    assert.match(p, /FIRST CHECK/)
    assert.ok(p.indexOf('FIRST CHECK') < p.indexOf('Start with userflow-query (overview)'))
    assert.match(p, /no live Vite page is connected/)
    assert.match(p, /Do not simulate driving/)
    assert.match(p, /do not change any\s+verification/)
    // The static alternative keeps steps untested rather than guessed.
    assert.match(p, /\/graph-update userflow/)
    assert.match(p, /untested/)
  })

  it('one run id stamps every verification in the run', () => {
    assert.match(p, /ONE run id/)
    assert.match(p, /same runId to every userflow-set-verification call/)
  })

  it('records each step immediately, so an interrupted run stays honest', () => {
    assert.match(p, /Record each step IMMEDIATELY/)
    assert.match(p, /honest partial state/)
  })

  it('actuation is honest about the hands a Files turn really has', () => {
    assert.match(p, /page-sections/)
    assert.match(p, /take-snapshot/)
    assert.match(p, /get-console/)
    assert.match(p, /run-in-page/)
    assert.match(p, /no separate click tool/)
    assert.match(p, /the app's\s+own handlers run/)
  })

  it('a blocked prerequisite propagates as state-blocked, naming the step', () => {
    assert.match(p, /state-blocked/)
    assert.match(p, /evidence naming the prerequisite step/)
    assert.match(p, /never left unrecorded/)
    assert.match(p, /requires edge/)
  })

  it('the run marks, it does not patch', () => {
    assert.match(p, /MARKS, it does not patch/)
    assert.match(p, /Never edit the project's files/)
    assert.match(p, /never\s+fix a block you find/)
    // The only graph writes beyond verification: an obvious exercises link.
    assert.match(p, /obvious cases only, never a guess/)
  })

  it('a re-run re-earns every state; unreached steps keep their older records', () => {
    assert.match(p, /re-earns every state/)
    assert.match(p, /keep their earlier\s+records/)
  })

  it('the final report has a fixed shape that matches the graph', () => {
    assert.match(p, /Dogfood run <runId> — <N> steps attempted, <M> ok/)
    assert.match(p, /one line per blocked or error step/)
    assert.match(p, /must match what you wrote to the graph/)
  })

  it('closes by deriving suggestions into the feature graph, and reports their counts', () => {
    assert.match(p, /userflow-derive-suggestions/)
    // Derivation happens after the verifications, before the report.
    assert.ok(p.indexOf('Reflect the run into the feature graph') > p.indexOf('Record each step IMMEDIATELY'))
    assert.ok(p.indexOf('Reflect the run into the feature graph') < p.indexOf('Finish with the run report'))
    // The suggestions are the system's derivations, never the agent's inventions.
    assert.match(p, /never invent, rename or hand-write suggestions/)
    assert.match(p, /never accept or dismiss/)
    assert.match(p, /Suggestions — <C> created, <W> withdrawn/)
  })

  it('the seed opens the turn\'s tool gates: userflow, layout and run-in-page groups', () => {
    const tools = fileToolsForTurn({ userText: p, hasUserFlowGraph: true })
    for (const t of ['userflow-query', 'userflow-set-verification', 'userflow-link', 'userflow-add-step', 'userflow-derive-suggestions']) {
      assert.ok(tools.includes(t), `userflow tool ${t} offered`)
    }
    for (const t of ['page-sections', 'layout-snapshot', 'run-in-page', 'runtime-state-set']) {
      assert.ok(tools.includes(t), `page tool ${t} offered`)
    }
    for (const t of ['take-snapshot', 'inspect-dom', 'get-console', 'get-network-failures']) {
      assert.ok(tools.includes(t), `core page sense ${t} offered`)
    }
    // The text signal alone (no graph state) opens the userflow gate too.
    const textOnly = fileToolsForTurn({ userText: p })
    assert.ok(textOnly.includes('userflow-set-verification'))
  })
})
