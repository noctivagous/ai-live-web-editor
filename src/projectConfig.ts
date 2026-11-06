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

export const PROJECT_CONFIG_FILE = 'project.ai.json'

/** Starter type registry keys (phase-11-06 §A); new types are data. */
export const PROJECT_TYPES = ['web-app', 'canvas-tool', 'game', 'dashboard', 'content-site'] as const

export interface ProjectConfig {
  type?: string
  deviceTargets?: DeviceTarget[]
  defaultDeviceTarget?: DeviceTarget
  styleSet?: string
  features?: string[]
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
  const targets = parseDeviceTargets(v.deviceTargets)
  if (targets) out.deviceTargets = targets
  const def = parseDeviceTarget(v.defaultDeviceTarget)
  if (def) out.defaultDeviceTarget = def
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
  if (config.styleSet) lines.push(`Style set: ${config.styleSet} — use its tokens for new UI.`)
  if (config.features?.length) lines.push(`Installed features: ${config.features.join(', ')}.`)
  return lines.join('\n')
}
