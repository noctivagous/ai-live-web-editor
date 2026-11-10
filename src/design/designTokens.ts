/**
 * Token write-back (Facets design §3.4/§3.6): editing a token in
 * the facet edits the project's token source where the app
 * actually consumes it. CSS variables are edited by offset —
 * only the value bytes change, comments and layout survive.
 * Tokens JSON is edited structurally at the $value leaf. A
 * Tailwind config built in code has no single editable value per
 * token, so that source honestly refuses.
 */
import fs from 'node:fs'
import path from 'node:path'
import { getFsRoot } from '../launcher.js'
import { getDesignGuide } from './designGuide.js'
import { detectTokenSource } from './designGraph.js'

export type SetTokenResult =
  | { ok: true, file: string, kind: string, name: string, value: string }
  | { ok: false, error: string }

/** Replace one `--name: value;` declaration's value in place. */
export function setCssVariable(text: string, name: string, value: string): string | null {
  const re = new RegExp(`(--${name.replace(/[.*+?^${'{}'}()|[\]\\]/g, '\\$&')}\\s*:\\s*)([^;]+)(;)`)
  const m = re.exec(text)
  if (!m) return null
  const start = m.index + m[1].length
  const trimmed = m[2]
  const lead = trimmed.length - trimmed.trimStart().length
  const trail = trimmed.length - trimmed.trimEnd().length
  return text.slice(0, start + lead) + value + text.slice(start + trimmed.length - trail)
}

/** Set the leaf for a hyphen-joined token name in W3C tokens JSON. */
export function setTokensJsonValue(parsed: unknown, name: string, value: string): boolean {
  if (!parsed || typeof parsed !== 'object') return false
  const parts = name.split('-')
  const walk = (node: Record<string, unknown>, depth: number): boolean => {
    const key = parts[depth]
    const child = node[key]
    if (!child || typeof child !== 'object') return false
    const rec = node[key] as Record<string, unknown>
    if (depth === parts.length - 1) {
      if ('$value' in rec) { rec.$value = value; return true }
      if ('value' in rec) { rec.value = value; return true }
      return false
    }
    return walk(rec, depth + 1)
  }
  // Token names are hyphen-joined paths, but a group key may itself
  // contain hyphens in the source file; try every split point.
  const trySplit = (node: Record<string, unknown>, rest: string[]): boolean => {
    for (let i = 1; i <= rest.length; i++) {
      const key = rest.slice(0, i).join('-')
      const child = node[key]
      if (!child || typeof child !== 'object') continue
      const rec = child as Record<string, unknown>
      if (i === rest.length) {
        if ('$value' in rec) { rec.$value = value; return true }
        if ('value' in rec) { rec.value = value; return true }
      } else if (trySplit(rec, rest.slice(i))) return true
    }
    return false
  }
  void walk
  return trySplit(parsed as Record<string, unknown>, parts)
}

export function setDesignToken(name: string, value: string, root: string = getFsRoot()): SetTokenResult {
  const cleanName = name.replace(/^--/, '').trim()
  const cleanValue = value.trim()
  if (!cleanName || !cleanValue) return { ok: false, error: 'A token name and a value are both needed.' }
  const source = detectTokenSource(root, getDesignGuide(root))
  if (!source) return { ok: false, error: 'No token source was found in this project — designate one in the design guide first.' }
  const filePath = path.join(root, source.file)
  let text: string
  try { text = fs.readFileSync(filePath, 'utf-8') } catch { return { ok: false, error: `The token source ${source.file} could not be read.` } }

  if (source.kind === 'css-variables') {
    const next = setCssVariable(text, cleanName, cleanValue)
    if (next === null) return { ok: false, error: `--${cleanName} is not declared in ${source.file}.` }
    fs.writeFileSync(filePath, next, 'utf-8')
    return { ok: true, file: source.file, kind: source.kind, name: cleanName, value: cleanValue }
  }
  if (source.kind === 'tokens-json') {
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { return { ok: false, error: `${source.file} is not valid JSON.` } }
    if (!setTokensJsonValue(parsed, cleanName, cleanValue)) return { ok: false, error: `Token ${cleanName} was not found in ${source.file}.` }
    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8')
    return { ok: true, file: source.file, kind: source.kind, name: cleanName, value: cleanValue }
  }
  return { ok: false, error: 'Tokens in a Tailwind config are set in code, not one value at a time — edit the config file to change this token.' }
}
