import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  fileToolsForTurn, FILE_ACTIVE_TOOLS, SKETCH_ACTIVE_TOOLS, type FilesTurnSignals,
} from '../agentTools.js'
import {
  agentIdForMode, ALE_FILES_AGENT, ALE_FS_TOOL_GROUP, ALE_SKETCH_AGENT, ALE_SKILL_TOOL_GROUP,
  ALE_TOOL_UNIVERSE, ALE_WEB_TOOL_GROUP,
  buildAleAgentsFragment, deriveAgentInstructions, filesTurnAllowed, registeredToolUniverse,
  sketchTurnAllowed, turnAllowedTools, turnDenyRules, universeCovers,
} from './agents.js'
import { PAGE_TOOL_NAMES } from './pageTools.js'
import { VERIFY_TOOL_NAMES } from './verifyTools.js'
import { GRAPH_TOOL_NAMES } from './graphTools.js'
import { PROJECT_TOOL_NAMES } from './projectTools.js'
import { CONTENT_TOOL_NAMES } from './contentTools.js'
import { WEB_TOOL_NAMES } from './webTools.js'
import { FS_TOOL_NAMES } from './fsTools.js'

/**
 * Slice 7 pins: the OpenCode agents' instructions and tool policy
 * are DERIVED from the Mastra path's sources (BASE_INSTRUCTIONS
 * via editorAgent, agentTools' computed sets). These tests fail
 * the moment either side drifts — a hand-copied second policy or
 * a restructured instruction text cannot sneak past them.
 */

const deniedActions = (allowed: string[]) => turnDenyRules(allowed).map((r) => r.action)

describe('ale agent tool policy derivation', () => {
  const SIGNAL_SETS: Array<{ name: string; signals: FilesTurnSignals }> = [
    { name: 'bare ask, nothing available', signals: { userText: 'hello there' } },
    { name: 'layout ask', signals: { userText: 'the layout has spacing problems on mobile' } },
    { name: 'plan + graphs in state', signals: { userText: 'keep going', hasActivePlan: true, hasFeatureGraph: true, hasUserFlowGraph: true } },
    { name: 'research with search on', signals: { userText: 'search the web for the latest docs', searchAvailable: true } },
    { name: 'research with search off', signals: { userText: 'search the web for the latest docs', searchAvailable: false } },
    { name: 'data + doc + spreadsheet ask', signals: { userText: 'update the json config, the readme markdown and the csv cells' } },
    { name: 'catalog + code ask', signals: { userText: 'install a button component and unpack the minified bundle' } },
  ]

  for (const { name, signals } of SIGNAL_SETS) {
    it(`files turn deny rules are exactly the universe minus fileToolsForTurn (${name})`, () => {
      const expected = fileToolsForTurn(signals)
      for (const consoleCheckOn of [false, true]) {
        const allowed = filesTurnAllowed(signals, consoleCheckOn)
        // The allowed set IS agentTools' set (plus console-expect
        // exactly when console checking is on).
        assert.deepEqual(
          allowed.filter((t) => t !== 'console-expect'),
          expected,
          `allowed drifted from fileToolsForTurn (consoleCheck=${consoleCheckOn})`,
        )
        assert.equal(allowed.includes('console-expect'), consoleCheckOn)
        const denied = deniedActions(allowed)
        // Nothing agentTools allows is denied; everything else in
        // the universe is.
        for (const tool of expected) assert.ok(!denied.includes(tool), `${tool} must not be denied`)
        for (const tool of ALE_TOOL_UNIVERSE) {
          if (!allowed.includes(tool)) assert.ok(denied.includes(tool), `${tool} must be denied`)
        }
        assert.equal(denied.length + allowed.length, ALE_TOOL_UNIVERSE.length)
      }
    })
  }

  it('sketch turn deny rules are exactly the universe minus the sketch set', () => {
    for (const consoleCheckOn of [false, true]) {
      const allowed = sketchTurnAllowed(consoleCheckOn)
      assert.deepEqual(allowed.filter((t) => t !== 'console-expect'), [...SKETCH_ACTIVE_TOOLS])
      const denied = deniedActions(allowed)
      for (const tool of SKETCH_ACTIVE_TOOLS) assert.ok(!denied.includes(tool), `${tool} must not be denied`)
      // The sketch contract's hard edge: no project-write ALE tool survives.
      for (const tool of ['write-real-file', 'str-replace', 'delete-file', 'feature-add-node', 'data-set', 'doc-set-text', 'plan-finish']) {
        assert.ok(denied.includes(tool), `${tool} must be denied in sketch`)
      }
    }
  })

  it('turnAllowedTools routes by mode, and agentIdForMode names the agents', () => {
    assert.equal(agentIdForMode('files'), ALE_FILES_AGENT)
    assert.equal(agentIdForMode('sketch'), ALE_SKETCH_AGENT)
    assert.deepEqual(
      turnAllowedTools('sketch', { userText: 'a plan for the feature graph' }, false),
      [...SKETCH_ACTIVE_TOOLS],
      'sketch ignores files signals entirely',
    )
    assert.deepEqual(
      turnAllowedTools('files', { userText: 'hello' }, false),
      fileToolsForTurn({ userText: 'hello' }),
    )
  })

  it('deny rules are well-formed permission rules (bare-name action, *, deny, sorted)', () => {
    const rules = turnDenyRules(['get-console'])
    assert.ok(rules.length > 0)
    for (const r of rules) {
      assert.equal(r.resource, '*')
      assert.equal(r.effect, 'deny')
      assert.ok(!r.action.includes('*'), 'actions are bare tool names, never wildcards')
    }
    const actions = rules.map((r) => r.action)
    assert.deepEqual(actions, [...actions].sort())
  })

  it('the universe is exactly the plugin inventory: handler tables + get-console + console-expect', () => {
    const fromHandlers = new Set<string>([
      'get-console',
      ...PAGE_TOOL_NAMES, ...VERIFY_TOOL_NAMES, ...GRAPH_TOOL_NAMES,
      ...PROJECT_TOOL_NAMES, ...CONTENT_TOOL_NAMES, ...WEB_TOOL_NAMES, ...FS_TOOL_NAMES,
      'console-expect',
    ])
    assert.deepEqual(new Set(ALE_TOOL_UNIVERSE), fromHandlers)
    assert.equal(ALE_TOOL_UNIVERSE.length, fromHandlers.size, 'no duplicates in the universe')
    assert.equal(ALE_TOOL_UNIVERSE.length, 78)
    // And every name agentTools can compute is covered.
    for (const name of [...FILE_ACTIVE_TOOLS, ...SKETCH_ACTIVE_TOOLS]) {
      assert.ok(universeCovers(name), `${name} missing from the universe`)
    }
  })

  it('the override groups are exactly the handler tables they gate (slice 8)', () => {
    assert.deepEqual([...ALE_FS_TOOL_GROUP].sort(), [...FS_TOOL_NAMES].sort())
    assert.deepEqual([...ALE_WEB_TOOL_GROUP].sort(), [...WEB_TOOL_NAMES].sort())
    assert.deepEqual(ALE_SKILL_TOOL_GROUP, ['read-skill'])
    assert.ok(PROJECT_TOOL_NAMES.includes('read-skill'), 'read-skill is a project-table tool on the host side')
    assert.ok(!ALE_SKILL_TOOL_GROUP.includes('run-skill-checks'), 'run-skill-checks has no native counterpart — never grouped')
  })

  it('registeredToolUniverse shrinks by exactly the off groups, per combination', () => {
    const all = registeredToolUniverse({ fs: true, web: true, skill: true })
    assert.deepEqual(all, [...ALE_TOOL_UNIVERSE])
    const none = registeredToolUniverse({ fs: false, web: false, skill: false })
    assert.equal(none.length, 78 - 9 - 3 - 1)
    for (const name of [...ALE_FS_TOOL_GROUP, ...ALE_WEB_TOOL_GROUP, ...ALE_SKILL_TOOL_GROUP]) {
      assert.ok(!none.includes(name), `${name} must leave the universe with its toggle off`)
    }
    assert.ok(none.includes('get-console') && none.includes('run-skill-checks'), 'unconditional tools stay')
    const fsOnly = registeredToolUniverse({ fs: true, web: false, skill: false })
    assert.equal(fsOnly.length, 78 - 3 - 1)
    assert.ok(fsOnly.includes('grep') && !fsOnly.includes('web-search') && !fsOnly.includes('read-skill'))
    const webSkill = registeredToolUniverse({ fs: false, web: true, skill: true })
    assert.equal(webSkill.length, 78 - 9)
    assert.ok(webSkill.includes('research') && webSkill.includes('read-skill') && !webSkill.includes('grep'))
  })

  it('deny rules over a shrunk universe are exactly that universe minus the allowed set', () => {
    const signals: FilesTurnSignals = { userText: 'hello', hasActivePlan: false, hasFeatureGraph: false, hasUserFlowGraph: false, searchAvailable: false }
    const allowed = filesTurnAllowed(signals, true)
    for (const toggles of [
      { fs: true, web: true, skill: true },
      { fs: false, web: false, skill: false },
      { fs: true, web: false, skill: true },
      { fs: false, web: true, skill: false },
    ]) {
      const universe = registeredToolUniverse(toggles)
      const denied = turnDenyRules(allowed, universe).map((r) => r.action)
      const expected = universe.filter((n) => !allowed.includes(n)).sort()
      assert.deepEqual(denied, expected, `toggles ${JSON.stringify(toggles)}`)
      // An allowed-but-unregistered tool (e.g. read-skill with
      // the skill override off) simply has no rule — it is not
      // registered, so there is nothing to deny or allow.
      for (const name of denied) assert.ok(universe.includes(name), 'deny rules never name an unregistered tool')
    }
  })
})

describe('instruction derivation', () => {
  const SYNTHETIC = [
    '',
    'You are a live code editor. You write real files on disk under the active Vite project.',
    '',
    'Chat has two workflows (header pill): Files (default) and Live sketch.',
    '- Files: grep and str-replace. patch-dom is not in this workflow.',
    '- Live sketch: disk write tools are not available. patch-dom on the live page.',
    'Routing: the host may switch a files-only turn from sketch to Files.',
    '',
    'Web research (Files only): web-search for quick current facts.',
    '',
    'Edits (token-efficient):',
    '- Default to str-replace on existing files.',
    '',
    'Efficient workflow:',
    '1. grep for the window first',
    '2. page-sections to see the page structure',
    '3. str-replace for lasting source changes',
    '4. In Live sketch, patch-dom using selectors from take-snapshot',
    '5. eval-js only in Live sketch to run JS in the Vite page',
    '6. check get-console before claiming done',
    '',
    'Live-edit mode: the user may annotate elements on the page.',
    '1. resolve-source on each annotated selector',
    '',
  ].join('\n')

  it('drops the other workflow’s lines and blocks, keeps the shared contract verbatim', () => {
    const files = deriveAgentInstructions(SYNTHETIC, 'files')
    assert.ok(files.includes('You are a live code editor.'))
    assert.ok(files.includes('- Files: grep and str-replace. patch-dom is not in this workflow.'))
    assert.ok(!files.includes('- Live sketch:'))
    assert.ok(files.includes('Web research (Files only):'))
    assert.ok(files.includes('Default to str-replace on existing files.'))
    assert.ok(files.includes('Live-edit mode:'))
    assert.ok(files.includes('1. grep for the window first'))
    assert.ok(files.includes('3. str-replace for lasting source changes'))
    assert.ok(!files.includes('4. In Live sketch, patch-dom'))
    assert.ok(!files.includes('5. eval-js only in Live sketch'))
    assert.ok(files.includes('6. check get-console before claiming done'))
    assert.ok(files.includes('Routing: the host may switch'))

    const sketch = deriveAgentInstructions(SYNTHETIC, 'sketch')
    assert.ok(sketch.includes('You are a live code editor.'))
    assert.ok(sketch.includes('- Live sketch: disk write tools are not available.'))
    assert.ok(!sketch.includes('- Files:'))
    assert.ok(!sketch.includes('Web research (Files only):'))
    assert.ok(!sketch.includes('Default to str-replace'))
    assert.ok(!sketch.includes('Live-edit mode:'))
    assert.ok(!sketch.includes('1. grep for the window first'))
    assert.ok(!sketch.includes('3. str-replace for lasting source changes'))
    assert.ok(sketch.includes('4. In Live sketch, patch-dom'))
    assert.ok(sketch.includes('5. eval-js only in Live sketch'))
    assert.ok(sketch.includes('2. page-sections to see the page structure'))
    assert.ok(sketch.includes('Routing: the host may switch'))
  })

  it('every surviving line is byte-identical to a source line (no paraphrase)', () => {
    const sourceLines = new Set(SYNTHETIC.split('\n'))
    for (const mode of ['files', 'sketch'] as const) {
      for (const line of deriveAgentInstructions(SYNTHETIC, mode).split('\n')) {
        assert.ok(sourceLines.has(line), `derived line not in source: ${line}`)
      }
    }
  })
})

describe('generated agent definitions (from the real BASE_INSTRUCTIONS)', () => {
  it('carries both agents with derived systems, the step cap and the route boundaries', async () => {
    const fragment = await buildAleAgentsFragment()
    assert.equal(fragment.default_agent, ALE_FILES_AGENT)
    assert.deepEqual(Object.keys(fragment.agents).sort(), [ALE_FILES_AGENT, ALE_SKETCH_AGENT].sort())

    const files = fragment.agents[ALE_FILES_AGENT] as { system: string; steps: number; mode: string; permissions: unknown }
    const sketch = fragment.agents[ALE_SKETCH_AGENT] as { system: string; steps: number; mode: string; permissions: unknown }
    assert.equal(files.mode, 'primary')
    assert.equal(sketch.mode, 'primary')
    assert.equal(files.steps, 12, 'mirrors the Mastra path maxSteps (CHAT_MAX_STEPS)')
    assert.equal(sketch.steps, 12)

    // Shared contract on both.
    for (const system of [files.system, sketch.system]) {
      assert.ok(system.includes('You are a live code editor. You write real files on disk'), 'shared intro')
      assert.ok(system.includes('Step budget: this turn ends after 12 tool steps'), 'shared step budget')
      assert.ok(system.includes('Call tools by their exact name only'), 'shared routing paragraph')
    }
    // Files-only contract on the files agent only.
    assert.ok(files.system.includes('Default to str-replace on existing files'), 'files edits block')
    assert.ok(files.system.includes('Web research (Files only):'), 'files research block')
    assert.ok(files.system.includes('Live-edit mode:'), 'files live-edit block')
    assert.ok(files.system.includes('patch-dom is not in this workflow'), 'files workflow bullet')
    assert.ok(!files.system.includes('- Live sketch:'), 'no sketch bullets on the files agent')
    assert.ok(!files.system.includes('disk write tools are not available'), 'no sketch contract line on the files agent')
    // Sketch-only contract on the sketch agent only.
    assert.ok(sketch.system.includes('Live sketch: disk write tools are not available'), 'sketch workflow bullet')
    assert.ok(sketch.system.includes('In Live sketch, patch-dom'), 'sketch efficient-workflow step')
    assert.ok(sketch.system.includes('The user Accepts, Undoes, or Discards in Chat'), 'accept/undo/discard is the user’s')
    assert.ok(!sketch.system.includes('- Files:'), 'no files bullets on the sketch agent')
    assert.ok(!sketch.system.includes('Default to str-replace'), 'no edits block on the sketch agent')
    assert.ok(!sketch.system.includes('Web research (Files only):'), 'no research block on the sketch agent')
    assert.ok(!sketch.system.includes('Live-edit mode:'), 'no live-edit block on the sketch agent')

    // Route boundaries as agent permissions (layer 1).
    assert.deepEqual(files.permissions, [
      { action: 'patch-dom', resource: '*', effect: 'deny' },
      { action: 'eval-js', resource: '*', effect: 'deny' },
    ])
    assert.deepEqual(sketch.permissions, [
      { action: 'edit', resource: '*', effect: 'deny' },
      { action: 'shell', resource: '*', effect: 'deny' },
      { action: 'execute', resource: '*', effect: 'deny' },
    ])
  })

  it('the fragment hash is stable for identical inputs (respawn fingerprint input)', async () => {
    const a = await buildAleAgentsFragment()
    const b = await buildAleAgentsFragment()
    assert.equal(a.hash, b.hash)
    assert.match(a.hash, /^[0-9a-f]{16}$/)
  })
})
