/** Route a chat turn between Files and Live sketch from the last user message. */

import {
  SKETCH_TURN_PREAMBLE,
  type SketchMode,
} from './sketchSession.js'

export type TurnIntent = 'page' | 'files' | 'mixed' | 'unknown'

export type WorkflowRoute = {
  mode: SketchMode
  switched: boolean
  intent: TurnIntent
  reason: string
}

export const FILES_ROUTED_PREAMBLE =
  'This turn was routed to Files because it is not a live-page change. '
  + 'Disk writes are allowed. Prefer grep / ranged read-real-file / str-replace / write-real-file. '
  + 'patch-dom is not available in Files; take-snapshot, inspect-dom, and layout-* can still read the page.'

export const SKETCH_MIXED_PREAMBLE =
  SKETCH_TURN_PREAMBLE
  + ' This turn also asks for source or file work. Only do the live-page half '
  + '(take-snapshot / inspect-dom / patch-dom). Do not call str-replace or write-real-file. '
  + 'After the page patches, say that the rest needs Files.'

export const ROUTE_TO_FILES_REASON =
  'Not a live-page change. Switched to Files so disk writes work.'

const PAGE_RE = new RegExp([
  '\\binspect-dom\\b',
  '\\bpatch-dom\\b',
  '\\blive page\\b',
  '\\bon the page\\b',
  '\\bin the preview\\b',
  '\\bthe heading\\b',
  '\\bthe h1\\b',
  '\\bh1\\b',
  '\\bthis button\\b',
  '\\bthe sidebar\\b',
  '\\bthe header\\b',
  '\\bthe banner\\b',
  '\\bmake it look\\b',
  '\\bvisually\\b',
  '\\bfont-size\\b',
  '\\bfont size\\b',
  '\\bbackground color\\b',
  '\\btext color\\b',
  '\\bcontrast\\b',
  '\\blayout\\b',
  '\\bspacing\\b',
  '\\bpadding\\b',
  '\\bmargin\\b',
  '\\bthe live app\\b',
  '\\brendered\\b',
  '\\bpreview iframe\\b',
].join('|'), 'i')

const FILE_RE = new RegExp([
  'package\\.json',
  'vite\\.config',
  'tsconfig',
  '\\.env\\b',
  '\\breadme\\b',
  '\\bnew file\\b',
  '\\bcreate a file\\b',
  '\\bscaffold\\b',
  '\\bunit test\\b',
  '\\badd a test\\b',
  '\\bwrite a test\\b',
  '\\btest file\\b',
  '\\brefactor\\b',
  '\\bendpoint\\b',
  '\\bapi route\\b',
  '\\bstr-replace\\b',
  '\\bwrite-real-file\\b',
  '\\bdependency\\b',
  '\\bnpm install\\b',
  '\\bgrep for\\b',
].join('|'), 'i')

const FILE_PATH_RE = /\b[\w./-]+\.(tsx?|jsx?|mjs|cjs|json|css|md|html)\b/i

export function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const item = messages[i]
    if (!item || typeof item !== 'object') continue
    const row = item as { role?: unknown, content?: unknown }
    if (row.role !== 'user' || typeof row.content !== 'string') continue
    return row.content.replace(/\s*Current file:.*$/s, '').trim()
  }
  return ''
}

export function classifyTurn(text: string): TurnIntent {
  const t = text.trim()
  if (!t) return 'unknown'
  const page = PAGE_RE.test(t)
  const files = FILE_RE.test(t) || FILE_PATH_RE.test(t)
  if (page && files) return 'mixed'
  if (page) return 'page'
  if (files) return 'files'
  return 'unknown'
}

/** Live sketch is opt-in. Only auto-leave it when the turn is clearly files-only. */
export function routeChatTurn(mode: SketchMode, messages: unknown): WorkflowRoute {
  const intent = classifyTurn(lastUserText(messages))
  if (mode === 'sketch' && intent === 'files') {
    return { mode: 'files', switched: true, intent, reason: ROUTE_TO_FILES_REASON }
  }
  return { mode, switched: false, intent, reason: '' }
}

export function withSystemPreamble(preamble: string, messages: unknown): unknown {
  const list = Array.isArray(messages) ? messages : []
  return [{ role: 'system', content: preamble }, ...list]
}

/**
 * Insert per-turn system context (project brief, codebase map, triggered
 * skills) just before the newest user message instead of ahead of the whole
 * history. The brief embeds live plan state, the map changes with the file
 * tree and skills change with every ask — prepended, any of them changing
 * re-prices the entire history at the full input rate, because a provider
 * prompt cache only survives an unchanged prefix. Callers pass contexts
 * ordered stable -> volatile (brief, map, skills); the constant mode
 * preambles still go through withSystemPreamble. Falls back to prepending
 * when the conversation has no user message yet.
 */
export function withContextBeforeLastUser(contexts: string[], messages: unknown): unknown {
  const list = Array.isArray(messages) ? messages : []
  const parts = contexts
    .filter((c) => typeof c === 'string' && c.length > 0)
    .map((content) => ({ role: 'system', content }))
  if (!parts.length) return messages
  let idx = -1
  for (let i = list.length - 1; i >= 0; i--) {
    if ((list[i] as { role?: string })?.role === 'user') { idx = i; break }
  }
  if (idx < 0) return [...parts, ...list]
  return [...list.slice(0, idx), ...parts, ...list.slice(idx)]
}
