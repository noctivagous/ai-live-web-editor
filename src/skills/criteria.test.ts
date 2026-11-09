import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateCriteria,
  measureAlignmentConsistency,
  measureVisualWeightEvenness,
  parseCriteriaFile,
  parseThreshold,
  viewportsForTargets,
  type Criterion,
  type El,
  type Evidence,
  type Viewport,
} from './criteria.js'
import type { LayoutFinding } from '../verify/gate.js'

const phone = viewportsForTargets(['phone'])
const [portrait, landscape] = phone

function ev(partial: Partial<Evidence>): Evidence {
  return {
    viewports: phone.map(viewport => ({ viewport, available: true, findings: [], elements: [] })),
    console: [{ label: 'page', entries: [] }],
    readFile: () => null,
    projectCheck: { status: 'unavailable', tail: 'none' },
    ...partial,
  }
}

function withViewport(viewport: Viewport, over: Partial<{ findings: LayoutFinding[], elements: El[] }>): Evidence {
  return ev({
    viewports: phone.map(v => v.marker === viewport.marker
      ? { viewport: v, available: true, findings: over.findings ?? [], elements: over.elements ?? [] }
      : { viewport: v, available: true, findings: [], elements: [] }),
  })
}

const box = (left: number, top: number, width: number, height: number, tag = 'DIV', id?: string): El =>
  ({ id, tag, rect: { left, top, width, height } })

describe('criteria schema', () => {
  it('parses a mixed verify.json and keeps every valid criterion', () => {
    const { criteria, errors } = parseCriteriaFile(JSON.stringify({
      version: 1,
      criteria: [
        { id: 'a', say: 'No spill', check: 'layout', expect: 'no-overflow' },
        { id: 'b', say: 'Quiet', check: 'console' },
        { id: 'c', say: 'Balanced', check: 'heuristic', measure: 'visual-weight-evenness', pass: '>= 0.7' },
        { id: 'd', say: 'Big enough', check: 'layout', expect: 'min-touch-target', px: 44, at: ['phone'] },
        { id: 'e', say: 'Kept', check: 'file', expect: 'not-contains', path: 'src/x.ts', text: 'TODO' },
      ],
    }))
    assert.deepEqual(errors, [])
    assert.equal(criteria.length, 5)
    assert.equal(criteria[1].expect, 'no-errors', 'console criteria normalise to no-errors')
  })

  it('rejects bad entries with named errors and keeps valid siblings', () => {
    const { criteria, errors } = parseCriteriaFile(JSON.stringify({
      criteria: [
        { id: 'ok', say: 'Fine', check: 'project-check' },
        { id: 'ok', say: 'Dupe', check: 'console' },
        { id: 'mystery', say: 'Who knows', check: 'vibes' },
        { id: 'weak', say: 'Feels fine', check: 'heuristic', measure: 'visual-weight-evenness' },
        { id: 'touch', say: 'Tappable', check: 'layout', expect: 'min-touch-target' },
        { say: 'No id', check: 'console' },
      ],
    }))
    assert.deepEqual(criteria.map(c => c.id), ['ok'])
    assert.equal(errors.length, 5)
    assert.ok(errors.some(e => e.includes('duplicate')))
    assert.ok(errors.some(e => e.includes('unknown check')))
    assert.ok(errors.some(e => e.includes('threshold')))
    assert.ok(errors.some(e => e.includes('px')))
    assert.ok(errors.some(e => e.includes('missing id')))
  })

  it('reports malformed JSON and a missing criteria array', () => {
    assert.equal(parseCriteriaFile('{nope').criteria.length, 0)
    assert.match(parseCriteriaFile('{nope').errors[0], /not valid JSON/)
    assert.match(parseCriteriaFile('{}').errors[0], /criteria/)
  })

  it('parses thresholds and rejects loose talk', () => {
    assert.deepEqual(parseThreshold('>= 0.7'), { op: '>=', value: 0.7 })
    assert.deepEqual(parseThreshold('<0.3'), { op: '<', value: 0.3 })
    assert.equal(parseThreshold('about right'), null)
    assert.equal(parseThreshold('>= 2'), null)
    assert.equal(parseThreshold(0.7), null)
  })
})

describe('viewports', () => {
  it('derives portrait + landscape per target; desktops do not rotate', () => {
    const all = viewportsForTargets(['phone', 'tablet', 'desktop'])
    assert.equal(all.length, 5)
    assert.deepEqual(all.map(v => v.marker), ['375x800', '800x375', '768x1024', '1024x768', '1280x800'])
    assert.equal(all.filter(v => v.target === 'desktop').length, 1)
  })
})

describe('layout criteria', () => {
  const noSpill: Criterion = { id: 'no-spill', say: 'No spill', check: 'layout', expect: 'no-overflow' }

  it('passes when no viewport reports overflow', () => {
    const [r] = evaluateCriteria([noSpill], ev({}))
    assert.equal(r.verdict, 'pass')
  })

  it('fails with the offending viewport and element in the evidence', () => {
    const finding: LayoutFinding = { key: 'k', kind: 'overflow', axis: 'x', detail: '{"stableId":"hero","right":430}' }
    const [r] = evaluateCriteria([noSpill], withViewport(portrait, { findings: [finding] }))
    assert.equal(r.verdict, 'fail')
    assert.match(r.evidence, /phone portrait/)
    assert.match(r.evidence, /hero/)
  })

  it('honours the axis filter', () => {
    const yOnly: LayoutFinding = { key: 'k', kind: 'overflow', axis: 'y', detail: '{}' }
    const xCriterion: Criterion = { ...noSpill, axis: 'x' }
    const [r] = evaluateCriteria([xCriterion], withViewport(portrait, { findings: [yOnly] }))
    assert.equal(r.verdict, 'pass')
  })

  it('treats y-overflow as the document growing in a page-format project', () => {
    const y: LayoutFinding = { key: 'k', kind: 'overflow', axis: 'y', detail: '{"stableId":"body"}' }
    const evidence = withViewport(portrait, { findings: [y] })
    evidence.format = 'page'
    const [asPage] = evaluateCriteria([noSpill], evidence)
    assert.equal(asPage.verdict, 'pass')
    evidence.format = 'app'
    const [asApp] = evaluateCriteria([noSpill], evidence)
    assert.equal(asApp.verdict, 'fail')
  })

  it("couldn't-checks when no live viewport is available", () => {
    const gone = ev({ viewports: phone.map(viewport => ({ viewport, available: false, note: 'frame gone', findings: [], elements: [] })) })
    const [r] = evaluateCriteria([noSpill], gone)
    assert.equal(r.verdict, 'couldnt-check')
  })

  it('scopes to the declared targets and orientations', () => {
    const finding: LayoutFinding = { key: 'k', kind: 'overflow', axis: 'x', detail: '{}' }
    const landscapeOnly: Criterion = { ...noSpill, orientation: 'landscape' }
    const [r] = evaluateCriteria([landscapeOnly], withViewport(portrait, { findings: [finding] }))
    assert.equal(r.verdict, 'pass', 'the overflow is in portrait, the criterion only watches landscape')
  })
})

describe('touch targets', () => {
  const tap: Criterion = { id: 'tap', say: 'Tappable', check: 'layout', expect: 'min-touch-target', px: 44, at: ['phone'] }

  it('fails on an undersized button and names it', () => {
    const [r] = evaluateCriteria([tap], withViewport(portrait, { elements: [box(10, 10, 30, 20, 'BUTTON', 'save')] }))
    assert.equal(r.verdict, 'fail')
    assert.match(r.evidence, /button#save is 30×20/)
  })

  it('passes when interactive elements meet the size, ignoring plain boxes', () => {
    const [r] = evaluateCriteria([tap], withViewport(portrait, {
      elements: [box(10, 10, 48, 48, 'BUTTON'), box(0, 0, 8, 8, 'DIV')],
    }))
    assert.equal(r.verdict, 'pass')
  })

  it("couldn't-checks when there is nothing interactive to measure", () => {
    const [r] = evaluateCriteria([tap], withViewport(portrait, { elements: [box(0, 0, 100, 100, 'DIV')] }))
    assert.equal(r.verdict, 'couldnt-check')
  })
})

describe('console, file and project-check criteria', () => {
  it('fails on console errors, counts warnings without failing', () => {
    const quiet: Criterion = { id: 'q', say: 'Quiet', check: 'console' }
    const [warnOnly] = evaluateCriteria([quiet], ev({ console: [{ label: 'page', entries: [{ level: 'warn', text: 'meh' }] }] }))
    assert.equal(warnOnly.verdict, 'pass')
    assert.match(warnOnly.evidence, /1 warning/)
    const [withError] = evaluateCriteria([quiet], ev({ console: [{ label: 'page', entries: [{ level: 'error', text: 'boom' }] }] }))
    assert.equal(withError.verdict, 'fail')
    assert.match(withError.evidence, /boom/)
    const [noConsole] = evaluateCriteria([quiet], ev({ console: [] }))
    assert.equal(noConsole.verdict, 'couldnt-check')
  })

  it('judges file existence and contents', () => {
    const files: Record<string, string> = { 'src/a.ts': 'export const x = 1 // TODO remove' }
    const read = (p: string) => files[p] ?? null
    const exists: Criterion = { id: 'e', say: 'Exists', check: 'file', expect: 'exists', path: 'src/a.ts' }
    const missing: Criterion = { id: 'm', say: 'Missing', check: 'file', expect: 'exists', path: 'src/b.ts' }
    const clean: Criterion = { id: 'c', say: 'Clean', check: 'file', expect: 'not-contains', path: 'src/a.ts', text: 'TODO' }
    const [a, b, c] = evaluateCriteria([exists, missing, clean], ev({ readFile: read }))
    assert.equal(a.verdict, 'pass')
    assert.equal(b.verdict, 'fail')
    assert.equal(c.verdict, 'fail')
  })

  it('maps the project check onto verdicts', () => {
    const pc: Criterion = { id: 'p', say: 'Builds', check: 'project-check' }
    const [pass] = evaluateCriteria([pc], ev({ projectCheck: { status: 'pass' } }))
    const [fail] = evaluateCriteria([pc], ev({ projectCheck: { status: 'fail', tail: 'tsc: error TS1' } }))
    const [un] = evaluateCriteria([pc], ev({ projectCheck: { status: 'unavailable', tail: 'no build script' } }))
    assert.equal(pass.verdict, 'pass')
    assert.equal(fail.verdict, 'fail')
    assert.match(fail.evidence, /TS1/)
    assert.equal(un.verdict, 'couldnt-check')
  })
})

describe('heuristic measures', () => {
  it('scores a quadrant-balanced page high and a corner-loaded one low', () => {
    const balanced = [
      box(20, 20, 160, 300), box(195, 20, 160, 300),
      box(20, 420, 160, 300), box(195, 420, 160, 300),
    ]
    const corner = [box(0, 0, 360, 700), box(10, 720, 40, 40), box(70, 720, 40, 40), box(130, 720, 40, 40)]
    const even = measureVisualWeightEvenness(balanced, portrait)
    const loaded = measureVisualWeightEvenness(corner, portrait)
    assert.ok(even && even.score > 0.9, `balanced scored ${even?.score}`)
    assert.ok(loaded && loaded.score < 0.3, `corner-loaded scored ${loaded?.score}`)
    assert.match(even!.note, /quadrant weight/)
  })

  it('scores a fully aligned grid 1 and jitters lower', () => {
    const grid = [box(0, 0, 100, 50), box(120, 0, 100, 50), box(0, 70, 100, 50), box(120, 70, 100, 50)]
    const jitter = [box(3, 1, 100, 50), box(127, 9, 100, 50), box(11, 83, 100, 50), box(133, 61, 100, 50)]
    assert.equal(measureAlignmentConsistency(grid, portrait)?.score, 1)
    assert.ok((measureAlignmentConsistency(jitter, portrait)?.score ?? 1) < 0.5)
  })

  it('verdicts follow the threshold, worst viewport governs, too-little is couldnt-check', () => {
    const feel: Criterion = { id: 'feel', say: 'Balanced', check: 'heuristic', measure: 'visual-weight-evenness', pass: '>= 0.7' }
    const balanced = [
      box(20, 20, 160, 300), box(195, 20, 160, 300),
      box(20, 420, 160, 300), box(195, 420, 160, 300),
    ]
    const [pass] = evaluateCriteria([feel], withViewport(portrait, { elements: balanced }))
    assert.equal(pass.verdict, 'pass')
    assert.ok(pass.score !== undefined && pass.score > 0.9)
    const [fail] = evaluateCriteria([feel], ev({
      viewports: [
        { viewport: portrait, available: true, findings: [], elements: balanced },
        { viewport: landscape, available: true, findings: [], elements: [box(0, 0, 780, 340), box(5, 345, 30, 20), box(45, 345, 30, 20), box(85, 345, 30, 20)] },
      ],
    }))
    assert.equal(fail.verdict, 'fail', 'the unbalanced landscape drags the verdict down')
    assert.match(fail.evidence, /landscape/)
    const [tooLittle] = evaluateCriteria([feel], withViewport(portrait, { elements: [box(0, 0, 50, 50)] }))
    assert.equal(tooLittle.verdict, 'couldnt-check')
  })
})
