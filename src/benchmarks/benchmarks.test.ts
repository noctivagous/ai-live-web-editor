import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeAgentChatStream } from '../chatStream.js'
import { pipeOpencodeChatStream } from '../opencode/chat.js'
import { BASIC_SUITE, EMPTY_FACTS, type TurnFacts } from './suite.js'
import { buildSummary, median, renderReport, writeRunReport, type TaskRunRecord } from './report.js'
import { FIXTURE_DIR, chatPipeForEngine, copyFixture } from './runner.js'

function tmpRunCopy(): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-suite-'))
  const dest = path.join(base, 'run')
  copyFixture(dest)
  return dest
}

function edit(runDir: string, rel: string, fn: (text: string) => string): void {
  const file = path.join(runDir, rel)
  fs.writeFileSync(file, fn(fs.readFileSync(file, 'utf-8')))
}

function taskById(id: string) {
  const task = BASIC_SUITE.tasks.find((t) => t.id === id)
  assert.ok(task, `suite has task ${id}`)
  return task
}

/** Hand-solved states: the expected edits applied programmatically,
 * the way a correct agent turn would leave the copy. */
const SOLVERS: Record<string, (runDir: string) => void> = {
  'add-counter': (runDir) => {
    edit(runDir, 'index.html', (html) => html.replace(
      '</section>',
      `</section>
  <div class="counter">
    <button id="count-btn" type="button">Count</button>
    <span id="count-value">0</span>
  </div>`,
    ))
    edit(runDir, 'src/main.ts', (ts) => `${ts}
let count = 0
const countBtn = document.querySelector('#count-btn')
const countValue = document.querySelector('#count-value')
countBtn?.addEventListener('click', () => {
  count += 1
  if (countValue) countValue.textContent = String(count)
})
`)
  },
  'restyle-card': (runDir) => {
    edit(runDir, 'src/card.css', (css) => css.replace(/\.card \{[^}]*\}/, `.card {
  background: #1f2937;
  color: #f9fafb;
  border: 1px solid #111827;
  border-radius: 16px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
  padding: 20px;
  max-width: 340px;
}`))
  },
  'fix-runtime-error': (runDir) => {
    edit(runDir, 'src/main.ts', (ts) => ts.replace("'#singup-form'", "'#signup-form'"))
  },
  'form-validation': (runDir) => {
    edit(runDir, 'src/main.ts', (ts) => `${ts}
const liveForm = document.querySelector('#signup-form')
liveForm?.addEventListener('submit', (event) => {
  const input = document.querySelector('#email') as HTMLInputElement | null
  const value = (input?.value || '').trim()
  if (!value || !/^\\S+@\\S+\\.\\S+$/.test(value)) {
    event.preventDefault()
    const note = document.querySelector('#signup-note')
    if (note) note.textContent = 'Please enter a valid email address'
  }
})
`)
  },
}

describe('basic suite shape', () => {
  it('has the five tasks with unique ids and verbatim prompts', () => {
    assert.equal(BASIC_SUITE.id, 'basic')
    assert.equal(BASIC_SUITE.tasks.length, 5)
    assert.deepEqual(
      BASIC_SUITE.tasks.map((t) => t.id),
      ['control-ok', 'add-counter', 'restyle-card', 'fix-runtime-error', 'form-validation'],
    )
    for (const t of BASIC_SUITE.tasks) {
      assert.ok(t.title.length > 0, `${t.id} has a title`)
      assert.ok(t.prompt.length > 0, `${t.id} has a prompt`)
      assert.equal(typeof t.grade, 'function')
    }
  })

  it('fixture carries the seeded runtime bug and no counter or validation', () => {
    const main = fs.readFileSync(path.join(FIXTURE_DIR, 'src/main.ts'), 'utf-8')
    const html = fs.readFileSync(path.join(FIXTURE_DIR, 'index.html'), 'utf-8')
    assert.ok(main.includes("'#singup-form'"), 'buggy selector is seeded')
    assert.ok(html.includes('id="signup-form"'), 'the form id is spelled correctly in the page')
    assert.ok(!html.includes('Count</button>'), 'no counter in the fixture')
    assert.ok(!main.includes('Please enter a valid email address'), 'no validation in the fixture')
  })
})

describe('graders', () => {
  for (const id of ['add-counter', 'restyle-card', 'fix-runtime-error', 'form-validation']) {
    it(`${id}: FAILS on the pristine fixture`, () => {
      const runDir = tmpRunCopy()
      const grade = taskById(id).grade(runDir, EMPTY_FACTS)
      assert.equal(grade.solved, false, JSON.stringify(grade.checks))
      assert.ok(grade.checks.some((c) => !c.ok), 'at least one check fails')
    })

    it(`${id}: PASSES on a hand-solved copy`, () => {
      const runDir = tmpRunCopy()
      SOLVERS[id](runDir)
      const grade = taskById(id).grade(runDir, EMPTY_FACTS)
      assert.equal(grade.solved, true, JSON.stringify(grade.checks))
    })
  }

  it('control-ok: grades the turn facts only', () => {
    const task = taskById('control-ok')
    const okFacts: TurnFacts = {
      finalText: 'OK', error: null, timedOut: false,
      toolResults: [{ name: 'read-real-file', ok: true }], toolCalls: 1,
    }
    assert.equal(task.grade(tmpRunCopy(), okFacts).solved, true)
    assert.equal(task.grade(tmpRunCopy(), { ...okFacts, finalText: 'Okay.' }).solved, false)
    assert.equal(
      task.grade(tmpRunCopy(), { ...okFacts, toolResults: [{ name: 'str-replace', ok: true }] }).solved,
      false,
      'a write tool result fails the control',
    )
    assert.equal(task.grade(tmpRunCopy(), { ...okFacts, error: 'boom' }).solved, false)
  })
})

describe('fixture copy / reset', () => {
  it('copies are independent and the template is never touched', () => {
    const before = fs.readFileSync(path.join(FIXTURE_DIR, 'index.html'), 'utf-8')
    const a = tmpRunCopy()
    edit(a, 'index.html', (html) => `${html}\n<!-- agent was here -->`)
    const b = tmpRunCopy()
    assert.equal(fs.readFileSync(path.join(b, 'index.html'), 'utf-8'), before)
    assert.equal(fs.readFileSync(path.join(FIXTURE_DIR, 'index.html'), 'utf-8'), before)
    // Re-copying over a dirty dest resets it.
    copyFixture(a)
    assert.equal(fs.readFileSync(path.join(a, 'index.html'), 'utf-8'), before)
  })
})

describe('report', () => {
  it('median handles empty, odd and even inputs', () => {
    assert.equal(median([]), null)
    assert.equal(median([7]), 7)
    assert.equal(median([3, 1, 2]), 2)
    assert.equal(median([100, 200]), 150)
  })

  it('summary.json carries the aggregate math (median, cost per solved, floor)', () => {
    const usage = (total: number) => ({ input: total - 10, output: 10, total })
    const rec = (taskId: string, rep: number, total: number, solved: boolean): TaskRunRecord => ({
      taskId, title: taskId, rep,
      usage: usage(total), durationMs: 1000 * rep, toolCalls: 2,
      solved, checks: [], error: null,
    })
    const summary = buildSummary({
      runId: 'test-run',
      startedAt: '2026-11-07T00:00:00.000Z',
      model: 'muse-spark-1.3-contributor',
      engine: 'mastra',
      suiteId: BASIC_SUITE.id,
      tasks: BASIC_SUITE.tasks,
      records: [
        rec('control-ok', 1, 100, true),
        rec('add-counter', 1, 300, true),
        rec('add-counter', 2, 500, false),
      ],
    })
    assert.equal(summary.aggregates.totalTokens, 900)
    assert.equal(summary.aggregates.solvedCount, 2)
    assert.equal(summary.aggregates.costPerSolvedTaskTokens, 450)
    assert.equal(summary.aggregates.controlFloorTokens, 100)
    assert.equal(summary.aggregates.perTask['add-counter'].medianTokens, 400)
    assert.equal(summary.aggregates.perTask['restyle-card'].reps, 0)
    assert.match(summary.promptHashes['control-ok'], /^[0-9a-f]{64}$/)

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-report-'))
    const { summaryPath, reportPath } = writeRunReport(outDir, summary)
    const written = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as typeof summary
    assert.equal(written.aggregates.costPerSolvedTaskTokens, 450)
    assert.equal(written.engine, 'mastra')
    const md = fs.readFileSync(reportPath, 'utf-8')
    assert.match(md, /fixed floor/)
    assert.match(md, /Cost per solved task/)
    assert.match(md, /add-counter/)
    assert.match(md, /engine `mastra`/)
    assert.match(md, /60,071/, 'the recorded baseline anchor rides every report')
  })
})

describe('engine selection (slice 9)', () => {
  it('the pipe for an engine is that engine\u2019s chat-stream function', () => {
    assert.equal(chatPipeForEngine('opencode'), pipeOpencodeChatStream)
    assert.equal(chatPipeForEngine('mastra'), pipeAgentChatStream)
  })

  it('an opencode run\u2019s summary names the engine; its report keeps the Mastra anchor with the keyed-run caveat', () => {
    const summary = buildSummary({
      runId: 'test-opencode-run',
      startedAt: '2026-11-09T00:00:00.000Z',
      model: 'stub-1',
      engine: 'opencode',
      suiteId: BASIC_SUITE.id,
      tasks: BASIC_SUITE.tasks,
      records: [{
        taskId: 'control-ok', title: 'Control', rep: 1,
        usage: { input: 90, output: 10, total: 100 }, durationMs: 500, toolCalls: 0,
        solved: true, checks: [], error: null,
      }],
    })
    assert.equal(summary.engine, 'opencode')
    const md = renderReport(summary)
    assert.match(md, /engine `opencode`/)
    assert.match(md, /Comparison anchor/)
    assert.match(md, /60,071/)
    assert.match(md, /awaits a keyed run/)
  })
})
