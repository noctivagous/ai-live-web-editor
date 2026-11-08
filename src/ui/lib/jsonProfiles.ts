/**
 * JSON profiles: recognition + inherited specialisation for config
 * files, the way the CSS renderer knows a stylesheet is not just
 * text. Every .json file gets the GENERIC profile — a form over its
 * tree, typed controls by value shape. A recognised filename gets a
 * profile that INHERITS the generic one and overrides only what it
 * knows better: a title and one-line description for the file, a
 * section order for its top-level keys, friendlier labels, a
 * description under a field, an option list for a string that is
 * really an enum, and a map shape for objects like `scripts` whose
 * entries are all name → command rows.
 *
 * Adding a config kind is adding one profile object here — no new
 * renderer, no new component. That is the extension point the
 * registry's `json` descriptor points at.
 */

export type JsonControlKind = 'text' | 'longtext' | 'number' | 'toggle' | 'select' | 'stringMap' | 'stringList'

export interface JsonFieldMeta {
  label?: string
  description?: string
  control?: JsonControlKind
  /** For control: 'select' — the values this string may take. */
  options?: string[]
}

export interface JsonSection {
  id: string
  title: string
  /** Top-level keys that belong to this section, in display order. */
  keys: string[]
}

export interface JsonProfile {
  id: string
  /** Shown in the view's header: what this file IS. */
  title: string
  description: string
  /** Generated files (lockfiles) are shown read-only with a banner. */
  generated?: boolean
  sections: JsonSection[]
  /** Field metadata by dotted path from the root, e.g.
   * 'compilerOptions.target'; a map object's entries use the
   * object's own path ('scripts', 'dependencies'). */
  fields: Record<string, JsonFieldMeta>
}

const GENERIC: JsonProfile = {
  id: 'generic',
  title: 'JSON file',
  description: 'Editing a field rewrites that value in the file. Everything else — order, formatting, comments — stays as it is.',
  sections: [],
  fields: {},
}

const PACKAGE: JsonProfile = {
  id: 'package',
  title: 'package.json — npm package',
  description: 'The package manifest: what the project is, how it runs, and what it depends on. Editing a field rewrites that value in the file.',
  sections: [
    { id: 'identity', title: 'Package', keys: ['name', 'version', 'description', 'keywords', 'license', 'author', 'private', 'type'] },
    { id: 'scripts', title: 'Scripts', keys: ['scripts'] },
    { id: 'deps', title: 'Dependencies', keys: ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] },
    { id: 'publishing', title: 'Publishing & entry points', keys: ['main', 'module', 'types', 'exports', 'bin', 'files', 'workspaces'] },
  ],
  fields: {
    'name': { description: 'The package name, as other projects depend on it.' },
    'version': { description: 'The package version (major.minor.patch).' },
    'description': { control: 'longtext' },
    'private': { description: 'When true, npm refuses to publish this package.' },
    'type': { control: 'select', options: ['module', 'commonjs'], description: 'How Node treats this package’s .js files.' },
    'scripts': { control: 'stringMap', description: 'Commands run as npm run <name>.' },
    'dependencies': { control: 'stringMap', description: 'Packages this project needs to run. Values are version ranges.' },
    'devDependencies': { control: 'stringMap', description: 'Packages needed only to build and test.' },
    'peerDependencies': { control: 'stringMap' },
    'optionalDependencies': { control: 'stringMap' },
    'keywords': { control: 'stringList' },
  },
}

const TSCONFIG: JsonProfile = {
  id: 'tsconfig',
  title: 'tsconfig.json — TypeScript config',
  description: 'How the TypeScript compiler checks and emits this project. Most of compilerOptions is switches — they edit as toggles here.',
  sections: [
    { id: 'compiler', title: 'Compiler options', keys: ['compilerOptions'] },
    { id: 'files', title: 'Files', keys: ['include', 'exclude', 'files', 'references'] },
    { id: 'top', title: 'Project', keys: ['extends', 'compileOnSave'] },
  ],
  fields: {
    'include': { control: 'stringList' },
    'exclude': { control: 'stringList' },
    'compilerOptions.target': { control: 'select', options: ['ES5', 'ES2015', 'ES2016', 'ES2017', 'ES2018', 'ES2019', 'ES2020', 'ES2021', 'ES2022', 'ES2023', 'ES2024', 'ESNext'], description: 'The JavaScript version the compiler emits.' },
    'compilerOptions.module': { control: 'select', options: ['CommonJS', 'ESNext', 'ES2015', 'ES2020', 'ES2022', 'NodeNext', 'Node16', 'Preserve', 'AMD', 'UMD', 'System', 'None'] },
    'compilerOptions.moduleResolution': { control: 'select', options: ['bundler', 'node16', 'nodenext', 'node', 'classic'] },
    'compilerOptions.jsx': { control: 'select', options: ['react-jsx', 'react', 'react-native', 'preserve', 'react-jsxdev'] },
    'compilerOptions.lib': { control: 'stringList' },
    'compilerOptions.types': { control: 'stringList' },
    'compilerOptions.strict': { description: 'Turns on the whole family of strict checks at once.' },
    'compilerOptions.outDir': { description: 'Where compiled files are written.' },
  },
}

const AI_PROJECT: JsonProfile = {
  id: 'ai-project',
  title: 'project.ai.json — AI Live Editor project',
  description: 'This editor’s own manifest for the project: its type, its shape, and the page the preview starts on.',
  sections: [
    { id: 'project', title: 'Project', keys: ['type', 'format', 'entry'] },
  ],
  fields: {
    'type': { control: 'select', options: ['web-app', 'canvas-tool', 'game', 'dashboard', 'content-site'], description: 'What kind of project this is. Undesignated projects build generically.' },
    'format': { control: 'select', options: ['app', 'page'], description: 'App shell (viewport-fit, the page never scrolls) or page flow (a document that scrolls and grows).' },
    'entry': { description: 'The start page — the file the preview opens first, relative to the project root.' },
  },
}

const PACKAGE_LOCK: JsonProfile = {
  id: 'package-lock',
  title: 'package-lock.json — generated lockfile',
  description: 'Written by npm to pin the exact installed tree. It is shown read-only — change package.json and reinstall instead of editing this file.',
  generated: true,
  sections: [],
  fields: {},
}

const PROFILES: JsonProfile[] = [PACKAGE_LOCK, PACKAGE, TSCONFIG, AI_PROJECT]

function basename(path: string): string {
  return (path.split('/').pop() || path).toLowerCase()
}

/** Recognition is by filename first — that is what makes a config
 * file a package manifest rather than anonymous JSON. */
export function profileForJsonPath(path: string): JsonProfile {
  const base = basename(path)
  if (base === 'package-lock.json') return PACKAGE_LOCK
  if (base === 'package.json') return PACKAGE
  if (base === 'project.ai.json') return AI_PROJECT
  if (/^(tsconfig|jsconfig)(\..+)?\.json$/.test(base)) return TSCONFIG
  return GENERIC
}

export function genericProfile(): JsonProfile {
  return GENERIC
}

/**
 * Inherited lookup: the recognised profile's metadata wins, the
 * generic profile is the fallback, and value shape is the last word
 * (decided by the view: booleans toggle, numbers are number fields,
 * strings are text) when neither names a control.
 */
export function fieldMetaFor(profile: JsonProfile, path: string[]): JsonFieldMeta {
  const key = path.join('.')
  return profile.fields[key] ?? GENERIC.fields[key] ?? {}
}

/** Group top-level keys by the profile's sections, in section order;
 * keys no section claims keep their file order in a final group
 * (titled '' when the profile has no sections at all — i.e. generic,
 * where the file's own order is the only order). */
export function groupTopLevelKeys(profile: JsonProfile, keysInFileOrder: string[]): { title: string; keys: string[] }[] {
  if (profile.sections.length === 0) return [{ title: '', keys: [...keysInFileOrder] }]
  const claimed = new Set<string>()
  const groups: { title: string; keys: string[] }[] = []
  for (const section of profile.sections) {
    const keys = section.keys.filter((k) => keysInFileOrder.includes(k))
    if (keys.length === 0) continue
    keys.forEach((k) => claimed.add(k))
    groups.push({ title: section.title, keys })
  }
  const rest = keysInFileOrder.filter((k) => !claimed.has(k))
  if (rest.length > 0) groups.push({ title: 'Other fields', keys: rest })
  return groups
}
