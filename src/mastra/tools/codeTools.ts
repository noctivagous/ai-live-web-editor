import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import { getFsRoot } from '../../launcher.js'
import { resolveProjectPath } from '../../projectPath.js'
import { loaderForPath, unpackSource } from '../../workbench/unpack.js'

/** Bundles can be big; past this the section map stops being a shortcut. */
const MAX_UNPACK_CHARS = 2_500_000
const MAX_SECTIONS = 200
const UNPACKED_PREFIX = '/.ai-live/unpacked/'

export const unpackCodeTool = createTool({
  id: 'unpack-code',
  description:
    'De-minify a dense JS/TS file (a bundle, a vendored library, a generated or one-line file) and index its top-level sections. Writes a formatted copy under .ai-live/unpacked/ — the original is never touched — and returns a section map (kind, name, line range, signature) into that copy. Read the sections you need from the copy with read-real-file offset/limit; make edits against the ORIGINAL file, never the copy. Use this instead of reading a minified file raw.',
  inputSchema: z.object({
    path: z.string().describe('Project-relative path to the .js/.jsx/.ts/.tsx/.mjs/.cjs file, e.g. "/dist/bundle.min.js"'),
  }),
  execute: async ({ path: inputPath }) => {
    const root = getFsRoot()
    const resolved = resolveProjectPath(root, inputPath)
    if (resolved.ok === false) return { ok: false, error: resolved.error }
    const { full, rel } = resolved
    if (rel.startsWith(UNPACKED_PREFIX)) {
      return { ok: false, error: `${rel} is already an unpacked copy — read it directly.` }
    }
    if (!loaderForPath(rel)) {
      return { ok: false, error: `unpack-code handles JS/TS files (.js/.jsx/.ts/.tsx/.mjs/.cjs), not ${rel}.` }
    }
    let buf: Buffer
    try {
      buf = fs.readFileSync(full)
    } catch {
      return { ok: false, error: `No such file: ${rel}` }
    }
    if (buf.includes(0)) return { ok: false, error: `${rel} looks binary — unpack-code handles text source only.` }
    const source = buf.toString('utf8')
    if (source.length > MAX_UNPACK_CHARS) {
      return { ok: false, error: `${rel} is ${source.length} chars — over the ${MAX_UNPACK_CHARS}-char unpack limit.` }
    }
    const out = unpackSource(source, rel)
    if (out.formatError) {
      return { ok: false, error: `Could not parse ${rel}: ${out.formatError}` }
    }
    const unpackedRel = UNPACKED_PREFIX + rel.slice(1)
    const dest = path.join(root, '.ai-live', 'unpacked', ...rel.split('/').filter(Boolean))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, out.formatted)
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
