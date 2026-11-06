import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { getFsRoot } from '../../launcher.js'
import { resolveSelector, type SourceFile } from '../../sourceMap/resolveSource.js'

const SKIP_DIR = new Set(['node_modules', '.vite', '.chrome-data', 'dist', 'dist-verify', '.git'])
const SOURCE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx'])

function walk(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP_DIR.has(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, acc)
    else if (SOURCE_EXT.has(path.extname(e.name))) acc.push(full)
  }
  return acc
}

/**
 * Host-side batch resolution for non-agent consumers (annotate submit,
 * sketch Accept). Builds the index once, resolves each selector, and returns
 * only successful hits shaped for `buildLiveEditPrompt` resolutions.
 */
export function resolveAnnotationSelectors(
  annotations: Array<{ selector?: string }>,
  root?: string,
): Array<{ selector?: string, file?: string, component?: string, startLine?: number, endLine?: number, confidence?: string }> {
  const files = indexProjectSources(root || getFsRoot())
  const out: Array<{ selector?: string, file?: string, component?: string, startLine?: number, endLine?: number, confidence?: string }> = []
  for (const a of annotations) {
    const selector = String(a?.selector || '')
    if (!selector) continue
    const r = resolveSelector({ selector }, files)
    if (r.ok && r.file) {
      out.push({ selector, file: r.file, component: r.component, startLine: r.jsxRange?.startLine, endLine: r.jsxRange?.endLine, confidence: r.confidence })
    }
  }
  return out
}

export function indexProjectSources(root: string): SourceFile[] {
  const out: SourceFile[] = []
  for (const full of walk(root)) {
    try {
      const st = fs.statSync(full)
      if (st.size > 1_000_000) continue
      const buf = fs.readFileSync(full)
      if (buf.includes(0)) continue
      out.push({ path: '/' + path.relative(root, full).replace(/\\/g, '/'), content: buf.toString('utf-8') })
    } catch { /* unreadable — skip */ }
  }
  return out
}

export const resolveSourceTool = createTool({
  id: 'resolve-source',
  description:
    'Map a live-DOM selector (take-snapshot line, inspect-dom selector, annotate selector) to the source file/component that renders it. Call this before grep when a selector needs a file. Fails closed when ambiguous.',
  inputSchema: z.object({
    selector: z.string().describe('CSS selector from the live page (snapshot line, overlay, or stableId path)'),
    stableId: z.string().optional().describe('Bridge stableId (id:foo or path:...) when known'),
    textSnippet: z.string().optional().describe('Visible text of the element, if known'),
    classList: z.array(z.string()).optional().describe('Class tokens of the element, if known'),
    tagName: z.string().optional().describe('Lowercase tag name, if known'),
  }),
  execute: async ({ selector, stableId, textSnippet, classList, tagName }) => {
    const files = indexProjectSources(getFsRoot())
    return resolveSelector({ selector, stableId, textSnippet, classList, tagName }, files)
  },
})
