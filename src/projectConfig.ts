/**
 * Project manifest — `project.ai.json` at the project root
 * (phase-11-06 §A). Local, gitignored config: the designated
 * project type, declared device targets, style set, and installed
 * features. Absence is a first-class state (undesignated): every
 * reader tolerates a missing or invalid file and falls back to
 * generic defaults. The file is written only when the user
 * designates or changes a setting — never by inference alone.
 */
import fs from 'node:fs'
import path from 'node:path'
import { getFsRoot } from './launcher.js'
import {
  DEVICE_TARGETS,
  DEVICE_WIDTHS,
  parseDeviceTarget,
  parseDeviceTargets,
  type DeviceTarget,
} from './deviceSession.js'
import { catalogSummary } from './catalog/catalog.js'
import { templateSummary } from './catalog/templates.js'
import { searchAvailable, searchBackendLabel } from './research/searchBackend.js'
import { getActivePlan } from './plans/plans.js'

export const PROJECT_CONFIG_FILE = 'project.ai.json'

/** Starter type registry keys (phase-11-06 §A); new types are data. */
export const PROJECT_TYPES = ['web-app', 'canvas-tool', 'game', 'dashboard', 'content-site'] as const

/**
 * Project format (§B2): 'app' = SPA / viewport-fit shell (the page
 * never scrolls; regions manage overflow), 'page' = document flow
 * (the page scrolls and grows). Decides target adaptation and
 * where the agent adds controls.
 */
export type ProjectFormat = 'app' | 'page'

export function parseProjectFormat(value: unknown): ProjectFormat | undefined {
  return value === 'app' || value === 'page' ? value : undefined
}

export interface ProjectConfig {
  type?: string
  format?: ProjectFormat
  deviceTargets?: DeviceTarget[]
  defaultDeviceTarget?: DeviceTarget
  styleSet?: string
  features?: string[]
  /**
   * Opt-in to the Noct AppKit catalog stock (§G). Off by default:
   * the catalog serves the shadcn stock unless a project declares
   * itself a Noct project here.
   */
  appkit?: boolean
  /** Default /plan level (1|2|3) when the command names none (§O:
   * defaults ride project.ai.json). */
  planLevel?: 1 | 2 | 3
  /** Default plan mutability, 0–10 (§O). */
  planMutability?: number
}

/**
 * The format in force: the explicit setting wins; otherwise the
 * type's default (content-site → page, any other designated type
 * → app); undesignated projects assert no format.
 */
export function effectiveFormat(config: ProjectConfig): ProjectFormat | undefined {
  if (config.format) return config.format
  if (!config.type) return undefined
  return config.type === 'content-site' ? 'page' : 'app'
}

export function projectConfigPath(root: string): string {
  return path.join(root, PROJECT_CONFIG_FILE)
}

/** Read the manifest under `root` (default: the active project). {} when undesignated. */
export function readProjectConfig(root: string = getFsRoot()): ProjectConfig {
  try {
    const raw = fs.readFileSync(projectConfigPath(root), 'utf-8')
    return sanitizeProjectConfig(JSON.parse(raw))
  } catch {
    return {}
  }
}

export function sanitizeProjectConfig(value: unknown): ProjectConfig {
  if (!value || typeof value !== 'object') return {}
  const v = value as Record<string, unknown>
  const out: ProjectConfig = {}
  if (typeof v.type === 'string' && v.type.trim()) out.type = v.type.trim()
  const format = parseProjectFormat(v.format)
  if (format) out.format = format
  const targets = parseDeviceTargets(v.deviceTargets)
  if (targets) out.deviceTargets = targets
  const def = parseDeviceTarget(v.defaultDeviceTarget)
  if (def) out.defaultDeviceTarget = def
  if (v.appkit === true) out.appkit = true
  if (v.planLevel === 1 || v.planLevel === 2 || v.planLevel === 3) out.planLevel = v.planLevel
  if (typeof v.planMutability === 'number' && Number.isFinite(v.planMutability)) {
    out.planMutability = Math.min(10, Math.max(0, Math.round(v.planMutability)))
  }
  if (typeof v.styleSet === 'string' && v.styleSet.trim()) out.styleSet = v.styleSet.trim()
  if (Array.isArray(v.features)) {
    const features = v.features.filter((f): f is string => typeof f === 'string' && Boolean(f.trim()))
    if (features.length) out.features = [...new Set(features)]
  }
  return out
}

/** Merge a patch into the manifest on disk; returns the stored config. */
export function writeProjectConfig(patch: Partial<ProjectConfig>, root: string = getFsRoot()): ProjectConfig {
  const merged = sanitizeProjectConfig({ ...readProjectConfig(root), ...patch })
  fs.writeFileSync(projectConfigPath(root), JSON.stringify(merged, null, 2) + '\n', 'utf-8')
  return merged
}

export function isDesignated(config: ProjectConfig): boolean {
  return Boolean(config.type)
}

/** The targets verification must cover: declared, else all of them. */
export function declaredTargets(config: ProjectConfig): DeviceTarget[] {
  return config.deviceTargets?.length ? config.deviceTargets : [...DEVICE_TARGETS]
}

/** Gate check widths (px) for the declared targets, ascending. */
export function targetWidths(config: ProjectConfig): number[] {
  return declaredTargets(config).map(t => DEVICE_WIDTHS[t]).sort((a, b) => a - b)
}

/**
 * The compact project brief injected into agent turns (chat and
 * annotation submits): what kind of project this is, which device
 * targets the result must work at, and the active style set.
 * Responsive-by-default is stated as an outcome, per phase-11-06.
 */
export function projectBrief(config: ProjectConfig = readProjectConfig()): string {
  const targets = declaredTargets(config)
  const lines = [
    config.type
      ? `Project type: ${config.type}.`
      : 'Project type: undesignated — build generically, no type-specific assumptions.',
    `Device targets: ${targets.join(', ')}. Build responsive from the start: the result must work at every target width (${targets.map(t => `${t} ${DEVICE_WIDTHS[t]}px`).join(', ')}); the desktop layout is the design surface, the others must always work even before any per-target customization.`,
  ]
  const format = effectiveFormat(config)
  if (format === 'app') {
    lines.push('Format: app (viewport-fit SPA shell) — the page itself never scrolls; regions and panels manage their own overflow and chrome stays pinned. Add controls inside regions, toolbars and panels; never grow the page. Adapt across targets by rearranging regions, not by reflowing a document.')
  } else if (format === 'page') {
    lines.push('Format: page (document flow) — the page scrolls and grows; content lives in sections. Add controls and sections in the flow; adapt across targets by reflowing (stack columns, scale type), not by pinning fixed regions.')
  }
  if (config.appkit) lines.push('Component stock: this project opts into the Noct AppKit (Lit) catalog stock in addition to shadcn.')
  if (config.styleSet) lines.push(`Style set: ${config.styleSet} — use its tokens for new UI.`)
  if (config.features?.length) lines.push(`Installed features: ${config.features.join(', ')}.`)
  const catalog = catalogSummary()
  if (catalog) lines.push(catalog)
  const templates = templateSummary()
  if (templates) lines.push(templates)
  if (searchAvailable()) {
    lines.push(`Web research is available via ${searchBackendLabel()}: web-search / fetch-page for quick lookups, research for multi-source briefs — build from cited briefs, not memory, when external facts matter.`)
  }
  const plan = getActivePlan()
  if (plan) {
    const done = plan.tasks.filter(t => t.status === 'done').length
    const qList = plan.questions.map(q => `${q.id}: ${q.label} [default: ${q.default}]${q.answer ? ` [answer: ${q.answer}]` : ''}`).join(' · ')
    lines.push(
      `ACTIVE PLAN "${plan.title}" (${plan.slug}, ${plan.kind}, level ${plan.level}, status ${plan.status}) — full record at ai-plans/${plan.slug}.md. ` +
      (plan.status === 'executing' || plan.status === 'approved'
        ? `Work the plan's tasks in order (${done}/${plan.tasks.length} done); mark each with plan-update-task as you start and finish it, and call plan-finish with a review summary at the end. `
        : `The plan is still being shaped. `) +
      `If the user asks to add, drop or reword a plan question, use plan-add-question / plan-remove-question / plan-revise-question — edit the plan in place, never restart it or re-ask settled questions. Questions: ${qList || '(none yet)'}`,
    )
  }
  return lines.join('\n')
}
