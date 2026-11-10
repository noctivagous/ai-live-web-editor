/**
 * Project-shaped tools as plain host functions (re-platform
 * slice 5, tool wave 4 — group A).
 *
 * Plans, skills, catalog/codebase-map/templates, runtime-state
 * and the workbench code tools, served to the OpenCode plugin
 * through their own dispatch endpoint, POST /api/project/tool
 * (registered in both server.ts and apiApp.ts). They do NOT ride
 * /api/page/tool (that dispatch is for live-page reads) or
 * /api/graph/tool (the two graph stores): these tools resolve
 * against the project's plan store, the editor's skill/catalog
 * state, the page's runtime storage, and the workbench unpack
 * pipeline.
 *
 * Each function below is the Mastra tool's execute body
 * (src/mastra/tools/planTools.ts, skillTools.ts, catalogTools.ts,
 * codebaseMapTools.ts, templateTools.ts, runtimeStateTools.ts,
 * codeTools.ts) with the wrapper removed — the SAME host modules
 * (plans/plans.ts + plans/planFromGraph.ts, skills/*, catalog/*,
 * codebaseMap/*, workbench/runtimeState.ts, workbench/unpack.ts),
 * resolving against the active fs root exactly as the Mastra
 * bodies do, so results match the Mastra path's exactly. The
 * Mastra tools themselves are untouched.
 *
 * Known stance (slices 1–4 carry it): NO per-turn gating on the
 * opencode path — all project tools are simply available to
 * OpenCode's default build agent.
 */
import fs from 'node:fs'
import path from 'node:path'
import { withDispatchDebugLog } from '../chatDebug.js'
import { getComponent, searchSummaries } from '../catalog/catalog.js'
import { getPack, searchPacks } from '../catalog/packs.js'
import { getTemplate, loadTemplates, placeTemplate as placeTemplateInProject } from '../catalog/templates.js'
import { formatCodebaseMap, findRegistryComponent } from '../codebaseMap/codebaseMap.js'
import {
  adoptRegistry as adoptProjectRegistry, buildAndPersistMap,
  installCatalogComponent as installComponentIntoProject,
} from '../codebaseMap/mapStore.js'
import { getFsRoot } from '../launcher.js'
import { livePageOp } from '../liveTarget.js'
import {
  addQuestion, getActivePlan, removeQuestion, savePlan,
} from '../plans/plans.js'
import { planFromGraph } from '../plans/planFromGraph.js'
import { resolveProjectPath } from '../projectPath.js'
import { loadSkillCriteria } from '../skills/criteria.js'
import { runCriteriaForSkill } from '../skills/criteriaGather.js'
import { activeSkills, getSkill } from '../skills/skills.js'
import {
  buildScanProgram, buildSetProgram, normalizeScanResult, normalizeSetResult,
} from '../workbench/runtimeState.js'
import { extractSymbol, loaderForPath, primaryName, unpackSource, type UnpackOutput } from '../workbench/unpack.js'

type Input = Record<string, any>

/* ------------------------------------------------------------------ */
/* Plans (src/mastra/tools/planTools.ts)                               */
/* ------------------------------------------------------------------ */

function noPlan() {
  return { ok: false, error: 'No active plan in this project. The user opens one with /plan in the chat.' }
}

async function planAddQuestion(input: Input) {
  const { label, control, options, defaultProposal } = input ?? {}
  const doc = getActivePlan()
  if (!doc) return noPlan()
  const q = addQuestion(doc, {
    label,
    control: control === 'choice' && options?.length ? 'choice' : 'text',
    options: control === 'choice' ? options : undefined,
    default: defaultProposal,
  })
  savePlan(doc)
  return { ok: true, plan: doc.slug, question: q, totalQuestions: doc.questions.length }
}

async function planRemoveQuestion(input: Input) {
  const { id } = input ?? {}
  const doc = getActivePlan()
  if (!doc) return noPlan()
  if (!removeQuestion(doc, id)) return { ok: false, error: `No question with id ${id} in plan ${doc.slug}.` }
  savePlan(doc)
  return { ok: true, plan: doc.slug, totalQuestions: doc.questions.length }
}

async function planReviseQuestion(input: Input) {
  const { id, label, options, defaultProposal } = input ?? {}
  const doc = getActivePlan()
  if (!doc) return noPlan()
  const q = doc.questions.find(x => x.id === id)
  if (!q) return { ok: false, error: `No question with id ${id} in plan ${doc.slug}.` }
  if (label) q.label = label
  if (options?.length) { q.options = options; q.control = 'choice' }
  if (defaultProposal) q.default = defaultProposal
  q.revised = true
  savePlan(doc)
  return { ok: true, plan: doc.slug, question: q }
}

async function planFromGraphTool(input: Input) {
  const { nodeId, packId } = input ?? {}
  const result = planFromGraph({ nodeId, packId })
  if (result.ok === false) return { ok: false, error: result.error }
  const { plan, skippedBuilt } = result
  return {
    ok: true,
    plan: plan.slug,
    title: plan.title,
    kind: plan.kind,
    tasks: plan.tasks.map(t => ({ id: t.id, text: t.text, nodeId: t.nodeId })),
    skippedBuilt,
  }
}

async function planUpdateTask(input: Input) {
  const { id, status, detail } = input ?? {}
  const doc = getActivePlan()
  if (!doc) return noPlan()
  const task = doc.tasks.find(t => t.id === id)
  if (!task) return { ok: false, error: `No task with id ${id} in plan ${doc.slug}.` }
  task.status = status
  if (detail !== undefined) task.detail = detail || undefined
  if (doc.status === 'approved' && status !== 'todo') doc.status = 'executing'
  savePlan(doc)
  return { ok: true, plan: doc.slug, task, done: doc.tasks.filter(t => t.status === 'done').length, total: doc.tasks.length }
}

async function planFinish(input: Input) {
  const { summary } = input ?? {}
  const doc = getActivePlan()
  if (!doc) return noPlan()
  doc.review = { summary, at: Date.now() }
  doc.status = 'done'
  savePlan(doc)
  return { ok: true, plan: doc.slug }
}

/* ------------------------------------------------------------------ */
/* Skills (src/mastra/tools/skillTools.ts)                             */
/* ------------------------------------------------------------------ */

async function readSkill(input: Input) {
  const { name } = input ?? {}
  const skill = getSkill(name, activeSkills())
  if (!skill) {
    return { ok: false, error: `No skill named ${name}`, available: activeSkills().map(s => s.name) }
  }
  return {
    ok: true,
    name: skill.name,
    body: skill.body,
    bodyTokens: skill.bodyTokens,
    ...(skill.overBudget ? { warning: `This body is ${skill.bodyTokens} tokens, over the 5,000-token contract budget — treat it as due for a trim.` } : {}),
  }
}

async function runSkillChecks(input: Input) {
  const { skill } = input ?? {}
  const found = getSkill(skill, activeSkills())
  if (!found) {
    return { ok: false, error: `No skill named ${skill}`, available: activeSkills().map(s => s.name) }
  }
  const { criteria } = loadSkillCriteria(skill)
  if (!criteria.length) {
    return { ok: false, error: `${skill} carries no checks — it declares no verify.json criteria, so there is nothing to run.` }
  }
  const outcome = await runCriteriaForSkill(skill)
  if (!outcome) return { ok: false, error: `${skill} carries no checks.` }
  const counts = { pass: 0, fail: 0, couldntCheck: 0 }
  for (const r of outcome.results) {
    if (r.verdict === 'pass') counts.pass++
    else if (r.verdict === 'fail') counts.fail++
    else counts.couldntCheck++
  }
  return {
    ok: true,
    skill,
    summary: `${counts.pass} pass, ${counts.fail} fail, ${counts.couldntCheck} couldn't-check of ${outcome.results.length} criteria`,
    results: outcome.results,
  }
}

/* ------------------------------------------------------------------ */
/* Catalog, codebase map, templates                                   */
/* (src/mastra/tools/catalogTools.ts, codebaseMapTools.ts,             */
/*  templateTools.ts)                                                  */
/* ------------------------------------------------------------------ */

async function findComponent(input: Input) {
  const { query, tag, pack, limit, includeAppkit } = input ?? {}
  if (pack) {
    const entry = getPack(pack)
    return entry
      ? { ok: true, tier: 'full' as const, pack: entry }
      : { ok: false, error: `No feature pack with id ${pack}` }
  }
  if (tag) {
    const entry = getComponent(tag)
    return entry
      ? { ok: true, tier: 'full' as const, component: entry }
      : { ok: false, error: `No catalog component tagged ${tag}` }
  }
  if (!query) return { ok: false, error: 'Pass a query, a tag, or a pack id' }
  const packs = searchPacks(query)
  const components = searchSummaries(query, limit ?? 6, undefined, { includeAppkit: includeAppkit ?? false })
  return {
    ok: true,
    tier: 'summary' as const,
    ...(packs.length ? { packs } : {}),
    components,
    note: packs.length
      ? 'A feature pack matches — a whole feature, not pieces. Pass its pack id for the full subgraph before deciding; installing it (an install plan) beats assembling the components below one by one. Component summaries carry names + prop names only; pass a tag for one full entry before you use it.'
      : components.length
        ? 'Summaries only (names + prop names). Pass a tag for one full entry (typed props, slots, emits, examples, source file) before you use it.'
        : 'No catalog match — building from scratch is appropriate here.',
  }
}

async function codebaseMap(input: Input) {
  const { budgetTokens, focus } = input ?? {}
  const map = buildAndPersistMap(getFsRoot())
  if (focus) {
    const hit = findRegistryComponent(map.components, focus)
    if (!hit) return { ok: true, focus, found: false, note: `No existing project component matches "${focus}" — building one is appropriate, or check the editor catalog with find-component.` }
    return {
      ok: true,
      focus,
      found: true,
      component: hit,
      reuse: `Reuse ${hit.name} from ${hit.file} (origin ${hit.origin}, used by ${hit.usedBy} file${hit.usedBy === 1 ? '' : 's'}): import it by name instead of inventing an equivalent.`,
    }
  }
  return {
    ok: true,
    text: formatCodebaseMap(map, budgetTokens ?? 1000),
    fileCount: map.fileCount,
    entry: map.entry,
    components: map.components.length,
    persistedAt: '.ai-live/map.json',
  }
}

async function adoptRegistry() {
  return adoptProjectRegistry(getFsRoot())
}

async function installCatalogComponent(input: Input) {
  const { tag } = input ?? {}
  return installComponentIntoProject(tag, getFsRoot())
}

async function placeTemplate(input: Input) {
  const { template } = input ?? {}
  if (!template) {
    return { ok: true, templates: loadTemplates().templates }
  }
  const entry = getTemplate(template)
  if (!entry) return { ok: false, error: `No template with id ${template}` }
  const placed = placeTemplateInProject(template, getFsRoot())
  return placed.ok
    ? { ...placed, note: `Placed ${entry.name} at ${placed.dest}. Customise the constants at the top of the file with str-replace, then import it where it belongs.` }
    : placed
}

/* ------------------------------------------------------------------ */
/* Runtime state (src/mastra/tools/runtimeStateTools.ts)               */
/* ------------------------------------------------------------------ */

/** Cap on the JSON value a set call may write (storage writes stay small and reversible). */
const SET_VALUE_CAP = 500_000

async function runtimeStateScan(input: Input) {
  const { match, url } = input ?? {}
  try {
    const raw = await livePageOp('eval', { code: buildScanProgram(match ?? null), url }) as any
    if (!raw || raw.error || raw.ok === false) {
      return { error: raw?.error || 'No live page answered.' }
    }
    return normalizeScanResult(raw.result ?? raw)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

async function runtimeStateSet(input: Input) {
  const { store, key, path: valuePath, value, reload, url } = input ?? {}
  let valueJson: string
  try {
    valueJson = JSON.stringify(value ?? null)
  } catch {
    return { ok: false, error: 'value does not serialize to JSON' }
  }
  if (valueJson.length > SET_VALUE_CAP) {
    return { ok: false, error: `value is too large (${valueJson.length} chars, cap ${SET_VALUE_CAP})` }
  }
  let raw: any
  try {
    raw = await livePageOp('eval', {
      code: buildSetProgram({
        store: store ?? 'localStorage',
        key,
        ...(valuePath ? { path: valuePath } : null),
        valueJson,
        reload: reload === true,
      }),
      url,
    }) as any
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  if (!raw || raw.error || raw.ok === false) {
    return { error: raw?.error || 'No live page answered.' }
  }
  return normalizeSetResult(raw.result ?? raw)
}

/* ------------------------------------------------------------------ */
/* Code tools (src/mastra/tools/codeTools.ts)                          */
/* ------------------------------------------------------------------ */

/** Bundles can be big; past this the section map stops being a shortcut. */
const MAX_UNPACK_CHARS = 2_500_000
const MAX_SECTIONS = 200
const UNPACKED_PREFIX = '/.ai-live/unpacked/'

type LoadResult =
  | { ok: true, rel: string, unpackedRel: string, source: string, out: UnpackOutput }
  | { ok: false, error: string }

/**
 * The shared workbench pipeline for the code tools: resolve, read and
 * unpack one JS/TS file, persisting the formatted copy under
 * .ai-live/unpacked/. The copy is regenerated from the current source
 * on every call — a cached copy could be stale after an edit, and the
 * unpack is fast. An input that already IS a copy is indexed in place
 * and never rewritten. (Replicated from the Mastra module, whose
 * copy stays the original.)
 */
function loadUnpacked(inputPath: string): LoadResult {
  const root = getFsRoot()
  const resolved = resolveProjectPath(root, inputPath)
  if (resolved.ok === false) return { ok: false, error: resolved.error }
  const { full, rel } = resolved
  const isCopy = rel.startsWith(UNPACKED_PREFIX)
  if (!loaderForPath(rel)) {
    return { ok: false, error: `The workbench handles JS/TS files (.js/.jsx/.ts/.tsx/.mjs/.cjs), not ${rel}.` }
  }
  let buf: Buffer
  try {
    buf = fs.readFileSync(full)
  } catch {
    return { ok: false, error: `No such file: ${rel}` }
  }
  if (buf.includes(0)) return { ok: false, error: `${rel} looks binary — the workbench handles text source only.` }
  const source = buf.toString('utf8')
  if (source.length > MAX_UNPACK_CHARS) {
    return { ok: false, error: `${rel} is ${source.length} chars — over the ${MAX_UNPACK_CHARS}-char unpack limit.` }
  }
  const out = unpackSource(source, rel)
  if (out.formatError) {
    return { ok: false, error: `Could not parse ${rel}: ${out.formatError}` }
  }
  const unpackedRel = isCopy ? rel : UNPACKED_PREFIX + rel.slice(1)
  if (!isCopy) {
    const dest = path.join(root, '.ai-live', 'unpacked', ...rel.split('/').filter(Boolean))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, out.formatted)
  }
  return { ok: true, rel, unpackedRel, source, out }
}

async function unpackCode(input: Input) {
  const { path: inputPath } = input ?? {}
  const resolved = resolveProjectPath(getFsRoot(), inputPath)
  if (resolved.ok === false) return { ok: false, error: resolved.error }
  if (resolved.rel.startsWith(UNPACKED_PREFIX)) {
    return { ok: false, error: `${resolved.rel} is already an unpacked copy — read it directly.` }
  }
  const loaded = loadUnpacked(inputPath)
  if (loaded.ok === false) return { ok: false, error: loaded.error }
  const { rel, unpackedRel, source, out } = loaded
  const countLines = (s: string) => (s ? s.split('\n').length : 0)
  return {
    ok: true,
    path: rel,
    unpackedPath: unpackedRel,
    loader: out.loader,
    originalChars: source.length,
    originalLines: countLines(source),
    formattedChars: out.formatted.length,
    formattedLines: countLines(out.formatted),
    sections: out.sections.slice(0, MAX_SECTIONS),
    ...(out.sections.length > MAX_SECTIONS ? { sectionsTruncated: out.sections.length } : {}),
    ...(out.sectionNote ? { note: out.sectionNote } : {}),
    hint: 'Line ranges index the unpacked copy. Read sections from it with read-real-file; edit the original file, not the copy.',
  }
}

async function readSymbol(input: Input) {
  const { path: inputPath, name } = input ?? {}
  const loaded = loadUnpacked(inputPath)
  if (loaded.ok === false) return { ok: false, error: loaded.error }
  const matches = extractSymbol(loaded.out.formatted, loaded.out.sections, name)
  if (!matches.length) {
    // Only plausible symbol names — the imports group and bare
    // statements are sections, not symbols anyone can ask for.
    const named = loaded.out.sections.filter((s) => s.kind !== 'imports' && s.kind !== 'statement')
    const available = [...new Set(named.map(primaryName))].slice(0, 50)
    return {
      ok: false,
      error: `No top-level symbol named ${name} in ${loaded.rel} — the index covers top-level sections only, so a nested symbol will not appear.`,
      available,
    }
  }
  return {
    ok: true,
    path: loaded.rel,
    unpackedPath: loaded.unpackedRel,
    name,
    matchCount: matches.length,
    matches,
    ...(loaded.out.sectionNote ? { note: loaded.out.sectionNote } : {}),
  }
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

/** The wave-4 group-A tools by their (Mastra-identical) names. */
export const PROJECT_TOOL_HANDLERS: Record<string, (input: Input) => Promise<unknown>> = {
  'plan-add-question': planAddQuestion,
  'plan-remove-question': planRemoveQuestion,
  'plan-revise-question': planReviseQuestion,
  'plan-update-task': planUpdateTask,
  'plan-finish': planFinish,
  'plan-from-graph': planFromGraphTool,
  'read-skill': readSkill,
  'run-skill-checks': runSkillChecks,
  'find-component': findComponent,
  'codebase-map': codebaseMap,
  'adopt-registry': adoptRegistry,
  'install-catalog-component': installCatalogComponent,
  'place-template': placeTemplate,
  'runtime-state-scan': runtimeStateScan,
  'runtime-state-set': runtimeStateSet,
  'unpack-code': unpackCode,
  'read-symbol': readSymbol,
}

export const PROJECT_TOOL_NAMES = Object.keys(PROJECT_TOOL_HANDLERS)

/** Run one group-A tool by name; unknown names are an error value,
 * never a throw (the dispatch endpoint's contract). */
async function runProjectToolImpl(name: string, input: Input): Promise<unknown> {
  const handler = PROJECT_TOOL_HANDLERS[name]
  if (!handler) {
    return { ok: false, error: `unknown project tool "${name}". Available: ${PROJECT_TOOL_NAMES.join(', ')}` }
  }
  return handler(input ?? {})
}

/** The exported dispatch: the impl above, plus its per-tool debug
 * record when chat debug is on (slice 9 — chatDebug.ts). */
export async function runProjectTool(name: string, input: Input): Promise<unknown> {
  return withDispatchDebugLog(name, input, () => runProjectToolImpl(name, input))
}
