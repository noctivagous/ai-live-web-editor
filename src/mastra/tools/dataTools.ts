import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import fs from 'node:fs'
import { getFsRoot } from '../../launcher.js'
import { resolveProjectPath } from '../../projectPath.js'
import {
  addDataValue, countDataNodes, dataFormatForPath, findDataNode, findInData, outlineData, parseDataTree, removeDataNode, setDataScalar,
  type DataFormat, type DataNode,
} from '../../ui/lib/dataTree.js'
import { profileForJsonPath } from '../../ui/lib/jsonProfiles.js'
import { profileForConfigPath } from '../../ui/lib/configProfiles.js'

/**
 * The structured-data core tools: ONE verb set over the neutral
 * tree model (src/ui/lib/dataTree) that every tree format parses
 * into — JSON, YAML, TOML, .env today, XML since its parser landed.
 * The same core backs the human form surfaces, so an agent edit
 * and a person's form edit splice identically, through the
 * format's own serialiser; the file is never regenerated.
 *
 * Addresses are dotted paths (array items by index: steps[0].name
 * or steps.0.name). Structural add/remove (data-add, data-remove)
 * run on the same core, so the tools and the form surfaces gain
 * them together.
 */

const MAX_DATA_CHARS = 2_500_000

type LoadResult =
  | { ok: true; rel: string; full: string; source: string; format: DataFormat; root: DataNode }
  | { ok: false; error: string }

function loadData(inputPath: string): LoadResult {
  const root = getFsRoot()
  const resolved = resolveProjectPath(root, inputPath)
  if (resolved.ok === false) return { ok: false, error: resolved.error }
  const { full, rel } = resolved
  const format = dataFormatForPath(rel)
  if (!format) {
    return { ok: false, error: `${rel} is not a structured-data file the data tools cover (.json, .yaml, .yml, .toml, .env, .xml).` }
  }
  let buf: Buffer
  try {
    buf = fs.readFileSync(full)
  } catch {
    return { ok: false, error: `No such file: ${rel}` }
  }
  if (buf.includes(0)) return { ok: false, error: `${rel} looks binary — the data tools handle text files only.` }
  const source = buf.toString('utf8')
  if (source.length > MAX_DATA_CHARS) {
    return { ok: false, error: `${rel} is ${source.length} chars — over the ${MAX_DATA_CHARS}-char data limit.` }
  }
  const parsed = parseDataTree(format, source)
  if (parsed.ok === false) return { ok: false, error: `Could not parse ${rel}: ${parsed.error} Nothing was changed.` }
  return { ok: true, rel, full, source, format, root: parsed.root }
}

function profileTitle(rel: string, format: DataFormat): string {
  if (format === 'json') return profileForJsonPath(rel).title
  if (format === 'xml') return 'XML document'
  return profileForConfigPath(rel, format).title
}

const pathField = z.string().describe('Project-relative path to a .json, .yaml, .yml, .toml, .env or .xml file')
const addressField = z.string().describe('Dotted address of a value, e.g. "dependencies.react" or "jobs.build.steps[0].uses"')

export const dataInspectTool = createTool({
  id: 'data-inspect',
  description:
    'Inspect a structured-data file (JSON, YAML, TOML, .env, XML): its format, the profile it is recognised as (package.json, GitHub Actions workflow, Cargo.toml, …), and an outline of its tree with scalar values. Use this before reading or editing such a file — the outline gives you the addresses data-get and data-set take, at a fraction of the cost of the raw file.',
  inputSchema: z.object({ path: pathField }),
  execute: async ({ path: inputPath }) => {
    const loaded = loadData(inputPath)
    if (loaded.ok === false) return { ok: false, error: loaded.error }
    return {
      ok: true,
      path: loaded.rel,
      format: loaded.format,
      profile: profileTitle(loaded.rel, loaded.format),
      nodes: countDataNodes(loaded.root),
      outline: outlineData(loaded.root, 3),
    }
  },
})

export const dataGetTool = createTool({
  id: 'data-get',
  description:
    'Read one addressed value from a structured-data file (JSON, YAML, TOML, .env, XML). A scalar returns its value and kind; a section returns an outline of just that subtree.',
  inputSchema: z.object({ path: pathField, address: addressField }),
  execute: async ({ path: inputPath, address }) => {
    const loaded = loadData(inputPath)
    if (loaded.ok === false) return { ok: false, error: loaded.error }
    const node = findDataNode(loaded.root, address)
    if (!node) return { ok: false, error: `No value at "${address}" in ${loaded.rel}. Inspect the file to see its addresses.` }
    if (node.kind === 'scalar') return { ok: true, path: loaded.rel, address, kind: 'scalar', scalarKind: node.scalarKind, value: node.value }
    if (node.kind === 'raw') return { ok: true, path: loaded.rel, address, kind: 'raw', note: 'Not a plain value in this format — shown read-only in the form as well.', raw: node.raw }
    return { ok: true, path: loaded.rel, address, kind: node.kind, outline: outlineData(node, 3) }
  },
})

export const dataSetTool = createTool({
  id: 'data-set',
  description:
    'Set one scalar value in a structured-data file (JSON, YAML, TOML, .env, XML) by dotted address. The new value is spliced into exactly that value’s place through the format’s own rules — comments, formatting and every other value stay byte-identical. Booleans must be true/false, numbers must parse. Sections and non-plain values cannot be set; for a whole-file rewrite use write-real-file instead.',
  inputSchema: z.object({
    path: pathField,
    address: addressField,
    value: z.string().describe('The new value, as text (typed by the value it replaces: true/false for booleans, a number literal for numbers)'),
  }),
  execute: async ({ path: inputPath, address, value }) => {
    const loaded = loadData(inputPath)
    if (loaded.ok === false) return { ok: false, error: loaded.error }
    const node = findDataNode(loaded.root, address)
    if (!node) return { ok: false, error: `No value at "${address}" in ${loaded.rel}. Inspect the file to see its addresses.` }
    const set = setDataScalar(loaded.format, loaded.source, node, value)
    if (set.ok === false) return { ok: false, error: set.error }
    fs.writeFileSync(loaded.full, set.source, 'utf8')
    return { ok: true, path: loaded.rel, address, previous: node.value, value }
  },
})

export const dataFindTool = createTool({
  id: 'data-find',
  description:
    'Find keys and scalar values containing a query (case-insensitive) in a structured-data file (JSON, YAML, TOML, .env, XML). Returns dotted addresses data-get and data-set can target directly.',
  inputSchema: z.object({
    path: pathField,
    query: z.string().describe('Text to look for in key names and values'),
  }),
  execute: async ({ path: inputPath, query }) => {
    const loaded = loadData(inputPath)
    if (loaded.ok === false) return { ok: false, error: loaded.error }
    const { matches, total } = findInData(loaded.root, query)
    return { ok: true, path: loaded.rel, query, total, matches, truncated: total > matches.length }
  },
})

export const dataAddTool = createTool({
  id: 'data-add',
  description:
    'Add a new value to a structured-data file (JSON, YAML, TOML, .env, XML). Give the parent section’s address ("" for the top level), a key for object-like sections (omit it to append to a list; use @name to add an XML attribute), and the value as text. The value is typed the way it reads — true/false become booleans, a number literal becomes a number, null becomes null, anything else a string — unless you pass type to force it (quote a version like "2021" as type "string"). The new entry is inserted in the file’s own style; everything else stays byte-identical.',
  inputSchema: z.object({
    path: pathField,
    parent: z.string().describe('Dotted address of the section or list to add to; "" for the top level'),
    key: z.string().optional().describe('The new key (sections/objects), an element name or @attribute for XML; omit to append to a list'),
    value: z.string().describe('The new value, as text'),
    type: z.enum(['string', 'number', 'boolean', 'null']).optional().describe('Force the value’s type instead of inferring it from the text'),
  }),
  execute: async ({ path: inputPath, parent, key, value, type }) => {
    const loaded = loadData(inputPath)
    if (loaded.ok === false) return { ok: false, error: loaded.error }
    const added = addDataValue(loaded.format, loaded.source, loaded.root, parent, key ?? null, value, type)
    if (added.ok === false) return { ok: false, error: added.error }
    fs.writeFileSync(loaded.full, added.source, 'utf8')
    return { ok: true, path: loaded.rel, parent, key: key ?? null, value }
  },
})

export const dataRemoveTool = createTool({
  id: 'data-remove',
  description:
    'Remove one value from a structured-data file (JSON, YAML, TOML, .env, XML) by dotted address — an object entry, a list item, a whole section, an XML element or an @attribute. Only that value’s own lines/span are deleted; the rest of the file stays byte-identical.',
  inputSchema: z.object({
    path: pathField,
    address: addressField,
  }),
  execute: async ({ path: inputPath, address }) => {
    const loaded = loadData(inputPath)
    if (loaded.ok === false) return { ok: false, error: loaded.error }
    const node = findDataNode(loaded.root, address)
    if (!node) return { ok: false, error: `No value at "${address}" in ${loaded.rel}. Inspect the file to see its addresses.` }
    const removed = removeDataNode(loaded.format, loaded.source, loaded.root, address)
    if (removed.ok === false) return { ok: false, error: removed.error }
    fs.writeFileSync(loaded.full, removed.source, 'utf8')
    return { ok: true, path: loaded.rel, address, removedKind: node.kind, removedValue: node.kind === 'scalar' ? node.value : undefined }
  },
})
