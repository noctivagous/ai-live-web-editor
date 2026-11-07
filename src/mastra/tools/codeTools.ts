import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import { getFsRoot } from '../../launcher.js'
import { resolveProjectPath } from '../../projectPath.js'
import { extractSymbol, loaderForPath, primaryName, unpackSource, type UnpackOutput } from '../../workbench/unpack.js'

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
 * and never rewritten.
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

export const unpackCodeTool = createTool({
  id: 'unpack-code',
  description:
    'De-minify a dense JS/TS file (a bundle, a vendored library, a generated or one-line file) and index its top-level sections. Writes a formatted copy under .ai-live/unpacked/ — the original is never touched — and returns a section map (kind, name, line range, signature) into that copy. Read the sections you need from the copy with read-real-file offset/limit; make edits against the ORIGINAL file, never the copy. Use this instead of reading a minified file raw.',
  inputSchema: z.object({
    path: z.string().describe('Project-relative path to the .js/.jsx/.ts/.tsx/.mjs/.cjs file, e.g. "/dist/bundle.min.js"'),
  }),
  execute: async ({ path: inputPath }) => {
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
  },
})

export const readSymbolTool = createTool({
  id: 'read-symbol',
  description:
    'Read ONE top-level function, class or constant by name from a JS/TS file — dense, minified or ordinary — without reading the rest of the file. The file is unpacked first (formatted copy under .ai-live/unpacked/, regenerated from the current source on every call) and the named section\'s source is returned. Top-level symbols only: if the name is not found, the result lists the names that do exist. Get names from unpack-code\'s section map or the codebase map. Make edits against the ORIGINAL file, never the copy.',
  inputSchema: z.object({
    path: z.string().describe('Project-relative path to the file, e.g. "/src/app.ts" or "/dist/bundle.min.js"'),
    name: z.string().describe('Exact top-level symbol name, e.g. "checkout"'),
  }),
  execute: async ({ path: inputPath, name }) => {
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
  },
})
