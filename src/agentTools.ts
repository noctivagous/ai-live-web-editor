/** Mastra `activeTools` keys (must match editorAgent.tools object keys). */

import type { SketchMode } from './sketchSession.js'

export const FILE_ACTIVE_TOOLS = [
  'list-real-files',
  'grep',
  'read-real-file',
  'str-replace',
  'write-real-file',
  'take-snapshot',
  'inspect-dom',
  'layout-snapshot',
  'layout-svg',
  'pool-open',
  'run-project-check',
] as const

export const SKETCH_ACTIVE_TOOLS = [
  'take-snapshot',
  'inspect-dom',
  'patch-dom',
  'eval-js',
  'layout-snapshot',
  'layout-svg',
  'pool-open',
] as const

export function activeToolsForMode(mode: SketchMode): string[] {
  return mode === 'sketch' ? [...SKETCH_ACTIVE_TOOLS] : [...FILE_ACTIVE_TOOLS]
}
