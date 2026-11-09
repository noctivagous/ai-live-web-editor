import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { lastSkillCheckRun, loadSkillCheckRuns, recordSkillCheckRun } from './skillChecks.js'
import type { CriterionResult } from './criteria.js'

const results: CriterionResult[] = [
  { id: 'no-spill', say: 'No spill', check: 'layout', verdict: 'pass', evidence: 'No overflow findings.' },
  { id: 'feel', say: 'Balanced', check: 'heuristic', verdict: 'fail', evidence: 'Scores 0.31.', score: 0.31 },
]

describe('skill check run records', () => {
  it('round-trips the last run per skill, independently', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skill-checks-')), 'skill-checks.json')
    assert.equal(lastSkillCheckRun('making-layouts', file), null)
    const run = recordSkillCheckRun('making-layouts', results, file)
    recordSkillCheckRun('paper-js', [results[0]], file)
    const back = lastSkillCheckRun('making-layouts', file)
    assert.ok(back)
    assert.equal(back.at, run.at)
    assert.deepEqual(back.results, results)
    assert.equal(lastSkillCheckRun('paper-js', file)?.results.length, 1)
    // A re-run replaces, never appends.
    recordSkillCheckRun('making-layouts', [results[1]], file)
    assert.equal(lastSkillCheckRun('making-layouts', file)?.results.length, 1)
  })

  it('reads a missing or corrupt file as no runs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-checks-'))
    assert.deepEqual(loadSkillCheckRuns(path.join(dir, 'nope.json')), {})
    const bad = path.join(dir, 'bad.json')
    fs.writeFileSync(bad, '{not json')
    assert.deepEqual(loadSkillCheckRuns(bad), {})
  })
})
