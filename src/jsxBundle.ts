import * as esbuild from 'esbuild'
import path from 'node:path'
import { EDITOR_ROOT, getFsRoot } from './launcher.js'
import { resolveProjectPath } from './projectPath.js'

export interface JsxBundleResult {
  ok: boolean
  /** Self-contained IIFE: React, react-dom, and the component, with a
   * mount call appended. The preview iframe runs it standalone — no
   * import maps, no project node_modules needed. */
  code?: string
  error?: string
}

/**
 * Bundle one .jsx component (plus its relative imports) into a
 * standalone script that renders the component into #root. Non-code
 * imports (css, images) are stubbed empty — the tab renders
 * structure, not final styling. Never throws; failures come back
 * as { ok: false }.
 */
export function bundleJsxComponent(inputPath: string): JsxBundleResult {
  const resolved = resolveProjectPath(getFsRoot(), inputPath)
  if (resolved.ok === false) return { ok: false, error: resolved.error }
  const entry = `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import * as Mod from ${JSON.stringify(resolved.full)};
const C = Mod.default && typeof Mod.default === 'function'
  ? Mod.default
  : Object.values(Mod).find(v => typeof v === 'function');
const root = document.getElementById('root');
if (!C) {
  root.textContent = 'No component export found in this file.';
} else {
  try {
    createRoot(root).render(React.createElement(C, null));
  } catch (e) {
    root.textContent = 'Component crashed: ' + (e instanceof Error ? e.message : String(e));
  }
}
`
  try {
    const out = esbuild.buildSync({
      stdin: { contents: entry, loader: 'jsx', resolveDir: path.dirname(resolved.full) },
      bundle: true,
      write: false,
      format: 'iife',
      minify: true,
      platform: 'browser',
      // The project tree has no node_modules — resolve react from ours.
      nodePaths: [path.join(EDITOR_ROOT, 'node_modules')],
      loader: { '.js': 'jsx', '.css': 'empty', '.png': 'empty', '.jpg': 'empty', '.jpeg': 'empty', '.svg': 'empty', '.gif': 'empty', '.webp': 'empty' },
      logLevel: 'silent',
    })
    if (!out.outputFiles || out.outputFiles.length === 0) {
      return { ok: false, error: 'esbuild produced no output' }
    }
    return { ok: true, code: out.outputFiles[0].text }
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n').slice(0, 3).join(' ') : String(e)
    return { ok: false, error: msg }
  }
}
