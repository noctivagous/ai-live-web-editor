/**
 * Per-facet criteria sets (Facets design §8.3): the
 * result-verify schema gains one set per facet, in the same
 * shape skills' verify.json uses, validated by the same parser
 * (src/skills/criteria.ts parseCriteriaFile) and reported with
 * the same pass / fail / couldn't-check evidence discipline.
 * The checks themselves run against the facets' own reports —
 * architecture rules, the design report, config validity, and
 * tech-stack consistency — so a criterion's evidence is the
 * facet's own numbers, not a second scan.
 */
import fs from 'node:fs'
import path from 'node:path'
import { getFsRoot } from '../launcher.js'
import { parseCriteriaFile, type CriteriaFile } from '../skills/criteria.js'
import { checkArchitecture } from '../architecture/architecture.js'
import { designReport, getDesignGraph } from '../design/designGraph.js'
import { deriveTechStack } from '../techstack/techStack.js'
import { deriveConfigInventory } from '../configregistry/configRegistry.js'
import { flakyTestKeys, lastTestVerdict, latestFullRun, readTestRuns } from '../delivery/testStore.js'

export type FacetCriteriaId = 'architecture' | 'graphic-design' | 'configuration' | 'tech-stack' | 'delivery'

/** The declared criteria per facet, as a verify.json document. */
export const FACET_CRITERIA: Record<FacetCriteriaId, CriteriaFile> = {
  architecture: parseCriteriaFile(JSON.stringify({
    version: 1,
    criteria: [
      { id: 'arch-rules-pass', say: 'Every checkable architecture rule passes', check: 'project-check' },
      { id: 'arch-no-drift', say: 'No declared module is missing from disk', check: 'project-check' },
    ],
  })),
  'graphic-design': parseCriteriaFile(JSON.stringify({
    version: 1,
    criteria: [
      { id: 'design-contrast', say: 'No background/text token pair falls below the contrast threshold', check: 'project-check' },
      { id: 'design-no-hardcoded', say: 'Pages use tokens, not hard-coded colour values that match no token', check: 'project-check' },
    ],
  })),
  configuration: parseCriteriaFile(JSON.stringify({
    version: 1,
    criteria: [
      { id: 'config-recognised', say: 'Every config-looking file is recognised by the registry', check: 'project-check' },
      { id: 'config-json-valid', say: 'Every recognised JSON config file parses', check: 'file', expect: 'exists', path: 'package.json' },
    ],
  })),
  'tech-stack': parseCriteriaFile(JSON.stringify({
    version: 1,
    criteria: [
      { id: 'stack-no-mismatch', say: 'Installed versions satisfy the declared ranges', check: 'project-check' },
      { id: 'stack-declared-installed', say: 'Everything declared is installed', check: 'project-check' },
    ],
  })),
  // Delivery (§13.4): the gate consumes test results as
  // criteria — the verdict reads the recorded runs, it does
  // not re-run the suites. Tests stay the surface; the gate
  // stays the judge.
  delivery: parseCriteriaFile(JSON.stringify({
    version: 1,
    criteria: [
      { id: 'tests-green', say: "The project's tests pass (latest full run)", check: 'project-check' },
      { id: 'tests-no-flaky', say: 'No test is flagged flaky in the recent run history', check: 'project-check' },
    ],
  })),
}

export interface FacetCriterionResult { id: string, say: string, verdict: 'pass' | 'fail' | 'couldnt-check', evidence: string }
export interface FacetCriteriaRun { facet: FacetCriteriaId, results: FacetCriterionResult[], ranAt: number }

export function runFacetCriteria(facet: FacetCriteriaId, root: string = getFsRoot()): FacetCriteriaRun {
  const declared = FACET_CRITERIA[facet].criteria
  const byId = new Map<string, FacetCriterionResult>()
  const put = (id: string, verdict: FacetCriterionResult['verdict'], evidence: string) => {
    const c = declared.find(x => x.id === id)
    if (c) byId.set(id, { id, say: c.say, verdict, evidence })
  }

  if (facet === 'architecture') {
    const report = checkArchitecture(root)
    if (!report.designated) {
      put('arch-rules-pass', 'couldnt-check', 'No architecture is designated yet.')
      put('arch-no-drift', 'couldnt-check', 'No architecture is designated yet.')
    } else {
      const failing = report.rules.filter(r => r.verdict === 'fail')
      const unchecked = report.rules.filter(r => r.verdict === 'couldnt-check')
      put('arch-rules-pass',
        failing.length ? 'fail' : unchecked.length && !report.rules.some(r => r.verdict === 'pass') ? 'couldnt-check' : 'pass',
        failing.length ? failing.map(r => `${r.id}: ${r.evidence}`).join('; ') : `${report.rules.length} rule(s) checked, none failing.`)
      put('arch-no-drift',
        report.drift.declaredNotFound.length ? 'fail' : 'pass',
        report.drift.declaredNotFound.length ? `Missing on disk: ${report.drift.declaredNotFound.join(', ')}` : 'Every declared module is on disk.')
    }
  } else if (facet === 'graphic-design') {
    const graph = getDesignGraph(root)
    if (!graph) {
      put('design-contrast', 'couldnt-check', 'The design graph has not been derived yet.')
      put('design-no-hardcoded', 'couldnt-check', 'The design graph has not been derived yet.')
    } else {
      const report = designReport(root, graph)
      put('design-contrast',
        report.contrastFlags.length ? 'fail' : 'pass',
        report.contrastFlags.length ? report.contrastFlags.map(f => `${f.text} on ${f.background} (${f.ratio})`).join('; ') : 'No token pair below 4.5:1.')
      put('design-no-hardcoded',
        report.hardcoded.length ? 'fail' : 'pass',
        report.hardcoded.length ? report.hardcoded.slice(0, 5).map(h => `${h.value} ×${h.count}`).join(' · ') : 'No hard-coded colour values found.')
    }
  } else if (facet === 'configuration') {
    const inv = deriveConfigInventory(root)
    put('config-recognised',
      inv.unrecognised.length ? 'fail' : 'pass',
      inv.unrecognised.length ? `Unrecognised: ${inv.unrecognised.slice(0, 8).join(', ')}` : 'Every config-looking file is recognised.')
    // config-json-valid: every recognised .json entry parses.
    const jsonFiles = [...new Set(inv.groups.flatMap(g => g.entries.map(e => e.file)).filter(f => f.endsWith('.json')))]
    const bad: string[] = []
    for (const f of jsonFiles) {
      try { JSON.parse(fs.readFileSync(path.join(root, f), 'utf-8')) } catch { bad.push(f) }
    }
    put('config-json-valid',
      jsonFiles.length === 0 ? 'couldnt-check' : bad.length ? 'fail' : 'pass',
      jsonFiles.length === 0 ? 'No JSON config files were recognised.' : bad.length ? `Do not parse: ${bad.join(', ')}` : `${jsonFiles.length} JSON config file(s) parse.`)
  } else if (facet === 'delivery') {
    const verdict = lastTestVerdict(root)
    if (!verdict) {
      put('tests-green', 'couldnt-check', 'No full test run has been recorded yet — run the tests from the Delivery facet.')
    } else if (verdict.fail > 0) {
      const failing = (latestFullRun(root)?.results ?? []).filter(r => r.status === 'fail').map(r => r.key)
      put('tests-green', 'fail', `${verdict.fail} of ${verdict.total} failing in the run at ${verdict.at}: ${failing.slice(0, 6).join(', ')}`)
    } else {
      put('tests-green', 'pass', `${verdict.pass} passed, 0 failed (${verdict.runnerId}, ${verdict.at}).`)
    }
    const flaky = flakyTestKeys(root)
    const anyRuns = readTestRuns(root).runs.length > 0
    put('tests-no-flaky',
      !anyRuns ? 'couldnt-check' : flaky.length ? 'fail' : 'pass',
      !anyRuns ? 'No test runs have been recorded yet.' : flaky.length ? `Flaky: ${flaky.slice(0, 6).join(', ')}` : 'No test has flipped between pass and fail in the recent history.')
  } else {
    const stack = deriveTechStack(root)
    put('stack-no-mismatch',
      stack.report.versionMismatches.length ? 'fail' : 'pass',
      stack.report.versionMismatches.length ? stack.report.versionMismatches.map(m => `${m.name} (declared ${m.declared}, installed ${m.installed})`).join('; ') : 'Installed versions satisfy the declared ranges.')
    put('stack-declared-installed',
      stack.packages.length === 0 ? 'couldnt-check' : stack.report.declaredNotInstalled.length ? 'fail' : 'pass',
      stack.packages.length === 0 ? 'No packages are declared.' : stack.report.declaredNotInstalled.length ? `Not installed: ${stack.report.declaredNotInstalled.join(', ')}` : 'Everything declared is installed.')
  }

  return { facet, results: declared.map(c => byId.get(c.id) ?? { id: c.id, say: c.say, verdict: 'couldnt-check' as const, evidence: 'Not run.' }), ranAt: Date.now() }
}
