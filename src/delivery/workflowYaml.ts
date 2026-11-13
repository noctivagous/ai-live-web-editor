/**
 * A structural extractor for GitHub Actions workflow files
 * (Facets design §13.8): the CI section renders pipelines as
 * jobs and steps, not raw YAML, so something has to read the
 * definition's shape. The repo declares no YAML parser among
 * its own dependencies (js-yaml/yaml exist only as transitive
 * dependencies of other packages — importing those directly
 * would build on a floor that can move), so this is a small,
 * purpose-built reader for exactly the structure the facet
 * renders: the workflow `name`, the `on` triggers, and each
 * job's `name` / `needs` / `steps` (each step's `name`, `uses`,
 * `run`).
 *
 * Its limits, stated plainly: it is NOT a general YAML
 * implementation. Anchors and aliases are not resolved; flow
 * mappings (`{a: b}`) are not understood (flow sequences of
 * scalars are); multi-line plain scalars are read as their
 * first line; expressions (`${{ … }}`) pass through verbatim.
 * A workflow using those in the rendered places degrades to
 * showing less structure — never to invented structure.
 */

export interface WorkflowStepDef {
  name?: string
  uses?: string
  run?: string
}

export interface WorkflowJobDef {
  id: string
  name?: string
  needs: string[]
  steps: WorkflowStepDef[]
}

export interface WorkflowDef {
  name?: string
  /** Trigger event names: push, pull_request, workflow_dispatch, … */
  triggers: string[]
  /** True when the workflow declares workflow_dispatch —
   * the only trigger a person (or ALE) can fire by hand. */
  canDispatch: boolean
  jobs: WorkflowJobDef[]
}

interface Line { indent: number, text: string }

function toLines(text: string): Line[] {
  const out: Line[] = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\t/g, '  ')
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    out.push({ indent: line.length - line.trimStart().length, text: trimmed })
  }
  return out
}

/** A YAML scalar for display: quotes stripped, inline comment
 * dropped when it clearly trails a plain scalar. */
function scalar(raw: string): string {
  let v = raw.trim()
  if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) {
    return v.slice(1, -1)
  }
  if (!v.startsWith('"') && !v.startsWith("'")) {
    const hash = v.indexOf(' #')
    if (hash > 0) v = v.slice(0, hash).trim()
  }
  return v
}

/** `key: value` / `key:` split of one content line. The key
 * may be quoted; returns null for sequence items and prose. */
function keyValue(text: string): { key: string, value: string } | null {
  const m = /^(['"]?)([A-Za-z0-9_.\-/ ]+?)\1\s*:(?:\s+(.*))?$/.exec(text)
  if (!m) return null
  return { key: m[2].trim(), value: (m[3] ?? '').trim() }
}

/** Scalars from an inline value: a flow sequence `[a, b]`, a
 * single scalar, or '' (meaning a block follows). */
function inlineList(value: string): string[] {
  const v = value.trim()
  if (!v) return []
  if (v.startsWith('[') && v.endsWith(']')) {
    return v.slice(1, -1).split(',').map(s => scalar(s)).filter(Boolean)
  }
  return [scalar(v)]
}

/** The `[start, end)` line range of the block belonging to
 * the key at line `i`: every following line more indented
 * than the key's line. */
function blockRange(lines: Line[], i: number): [number, number] {
  const base = lines[i].indent
  let end = i + 1
  while (end < lines.length && lines[end].indent > base) end++
  return [i + 1, end]
}

/** Event names from an `on` block: child keys are events;
 * child sequence items are events too (`on: [push]` written
 * as a block list). Nested config (branches:, inputs:) is
 * shape we deliberately do not render. */
function parseTriggers(lines: Line[], start: number, end: number): string[] {
  const events: string[] = []
  if (start >= end) return events
  const childIndent = Math.min(...lines.slice(start, end).map(l => l.indent))
  for (let i = start; i < end; i++) {
    const l = lines[i]
    if (l.text.startsWith('- ')) {
      if (l.indent === childIndent) {
        const item = scalar(l.text.slice(2).split(':')[0])
        if (item) events.push(item)
      }
      continue
    }
    if (l.indent !== childIndent) continue
    const kv = keyValue(l.text)
    if (kv) events.push(kv.key)
  }
  return events
}

/** A `needs` value: inline (scalar or flow list) or a block
 * sequence of job ids at deeper indent. */
function parseNeeds(lines: Line[], i: number, end: number, inline: string): string[] {
  if (inline) return inlineList(inline)
  const needs: string[] = []
  const base = lines[i].indent
  for (let j = i + 1; j < end && lines[j].indent > base; j++) {
    if (lines[j].text.startsWith('- ')) needs.push(scalar(lines[j].text.slice(2)))
  }
  return needs
}

function isBlockScalar(v: string): boolean {
  return /^[|>][+-]?\d*$/.test(v.trim())
}

/** The steps of one job: sequence items under the job's
 * `steps:` key. An item's first line may carry its first key
 * inline (`- uses: …`); the item's remaining keys follow at
 * the item-content indent. Only name/uses/run are rendered. */
function parseSteps(lines: Line[], start: number, end: number): WorkflowStepDef[] {
  const steps: WorkflowStepDef[] = []
  // The item indent is the shallowest `- ` line in the block.
  const itemLines = lines.slice(start, end).filter(l => l.text.startsWith('- '))
  if (!itemLines.length) return steps
  const itemIndent = Math.min(...itemLines.map(l => l.indent))
  let current: WorkflowStepDef | null = null
  // Returns the last line index consumed (a block scalar's
  // body), so script lines are never re-read as step keys.
  const assign = (step: WorkflowStepDef, key: string, value: string, at: number, limit: number): number => {
    if (key === 'name') step.name = scalar(value)
    else if (key === 'uses') step.uses = scalar(value)
    else if (key === 'run') {
      if (isBlockScalar(value)) {
        // A block scalar: the script is the deeper-indented
        // lines that follow, captured whole (capped) — the
        // section shows the command a step runs.
        const parts: string[] = []
        let j = at + 1
        for (; j < limit && lines[j].indent > lines[at].indent; j++) parts.push(lines[j].text)
        step.run = parts.join('\n').slice(0, 500)
        return j - 1
      }
      step.run = scalar(value)
    }
    return at
  }
  for (let i = start; i < end; i++) {
    const l = lines[i]
    if (l.text.startsWith('- ') && l.indent === itemIndent) {
      current = {}
      steps.push(current)
      const rest = l.text.slice(2)
      const kv = keyValue(rest)
      if (kv) i = Math.max(i, assign(current, kv.key, kv.value, i, end))
      continue
    }
    if (!current || l.indent < itemIndent) continue
    const kv = keyValue(l.text)
    if (kv && (kv.key === 'name' || kv.key === 'uses' || kv.key === 'run')) {
      i = Math.max(i, assign(current, kv.key, kv.value, i, end))
    }
  }
  return steps
}

function parseJobs(lines: Line[], start: number, end: number): WorkflowJobDef[] {
  const jobs: WorkflowJobDef[] = []
  if (start >= end) return jobs
  const jobIndent = Math.min(...lines.slice(start, end).map(l => l.indent))
  const jobStarts: number[] = []
  for (let i = start; i < end; i++) {
    if (lines[i].indent === jobIndent && keyValue(lines[i].text)) jobStarts.push(i)
  }
  jobStarts.forEach((s, idx) => {
    const jobEnd = idx + 1 < jobStarts.length ? jobStarts[idx + 1] : end
    const id = keyValue(lines[s].text)!.key
    const job: WorkflowJobDef = { id, needs: [], steps: [] }
    // The job's own keys sit at the shallowest indent below
    // the job id within its range.
    const inner = lines.slice(s + 1, jobEnd)
    if (inner.length) {
      const keyIndent = Math.min(...inner.map(l => l.indent))
      for (let i = s + 1; i < jobEnd; i++) {
        if (lines[i].indent !== keyIndent) continue
        const kv = keyValue(lines[i].text)
        if (!kv) continue
        if (kv.key === 'name') job.name = scalar(kv.value)
        else if (kv.key === 'needs') job.needs = parseNeeds(lines, i, jobEnd, kv.value)
        else if (kv.key === 'steps') {
          const [ss, se] = blockRange(lines, i)
          job.steps = parseSteps(lines, ss, Math.min(se, jobEnd))
        }
      }
    }
    jobs.push(job)
  })
  return jobs
}

/** Read a workflow definition's rendered structure. Never
 * throws: a file too strange to read yields an empty def,
 * which the section shows as an unreadable definition
 * rather than a broken screen. */
export function parseWorkflow(text: string): WorkflowDef {
  const def: WorkflowDef = { triggers: [], canDispatch: false, jobs: [] }
  try {
    const lines = toLines(text)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indent !== 0) continue
      const kv = keyValue(lines[i].text)
      if (!kv) continue
      if (kv.key === 'name') def.name = scalar(kv.value)
      else if (kv.key === 'on' || kv.key === 'true') {
        // `on` is YAML 1.1's boolean-true word; some writers
        // quote it. The key we meet in raw text is 'on' — the
        // 'true' arm covers files a 1.1 tool round-tripped.
        if (kv.value) def.triggers = inlineList(kv.value)
        else {
          const [s, e] = blockRange(lines, i)
          def.triggers = parseTriggers(lines, s, e)
        }
      } else if (kv.key === 'jobs') {
        const [s, e] = blockRange(lines, i)
        def.jobs = parseJobs(lines, s, e)
      }
    }
  } catch { /* the empty def stands */ }
  def.canDispatch = def.triggers.includes('workflow_dispatch')
  return def
}
