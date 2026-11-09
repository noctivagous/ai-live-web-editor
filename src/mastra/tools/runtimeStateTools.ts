import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { livePageOp } from '../../liveTarget.js'
import {
  buildScanProgram,
  buildSetProgram,
  normalizeScanResult,
  normalizeSetResult,
} from '../../workbench/runtimeState.js'

/** Cap on the JSON value a set call may write ( Bench: storage writes stay small and reversible). */
const SET_VALUE_CAP = 500_000

export const runtimeStateScanTool = createTool({
  id: 'runtime-state-scan',
  description:
    'Inventory the live page\'s web storage (localStorage + sessionStorage keys and sizes) and, with match, report every store/key/path whose value contains that string (case-insensitive). Use when named content is absent from take-snapshot/inspect-dom: DOM senses see elements only — canvas/WebGL-painted content and app state never appear there. Source (grep) tells whether the content lives in code; this tells whether it lives in runtime state. Read-only. To change a value once found, use runtime-state-set. Pass url for the Playwright pool.',
  inputSchema: z.object({
    match: z.string().optional().describe('Target text to search stored values for (case-insensitive); omit for an inventory only.'),
    url: z.string().optional().describe('Another origin: use the Playwright pool. Omit for the Vite app page bridge.'),
  }),
  execute: async ({ match, url }) => {
    try {
      const raw = await livePageOp('eval', { code: buildScanProgram(match ?? null), url }) as any
      if (!raw || raw.error || raw.ok === false) {
        return { error: raw?.error || 'No live page answered.' }
      }
      return normalizeScanResult(raw.result ?? raw)
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  },
})

export const runtimeStateSetTool = createTool({
  id: 'runtime-state-set',
  description:
    'Change one value in the live page\'s web storage: a JSON path (a.b[0].c) within the stored value, or the whole value when path is omitted. Returns sizes plus the previous raw value as backup, verified by read-back; reload:true reloads the page so the app rehydrates from the new state. Pairs with runtime-state-scan (find first) and a re-scan to confirm. Storage writes persist like the app\'s own state — report the backup. Prefer app UI or source edits when those reach the same state; use this when the state exists only at runtime (e.g. canvas-painted content with no source copy). Pass url for the Playwright pool.',
  inputSchema: z.object({
    store: z.enum(['localStorage', 'sessionStorage']).optional().describe('Which store. Default localStorage.'),
    key: z.string().describe('Storage key to write.'),
    path: z.string().optional().describe('JSON path within the stored value (a.b[0].c); omit to replace the whole value.'),
    value: z.unknown().describe('New value (JSON). For a path set it must fit the path; whole-value replaces with this JSON text.'),
    reload: z.boolean().optional().describe('Reload the page after a verified write so the app rehydrates. Default false.'),
    url: z.string().optional().describe('Another origin: use the Playwright pool. Omit for the Vite app page bridge.'),
  }),
  execute: async ({ store, key, path, value, reload, url }) => {
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
          ...(path ? { path } : null),
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
  },
})
