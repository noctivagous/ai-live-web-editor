/**
 * The non-secret shape of a wrangler.toml (Facets design
 * §13.5, §7.3): the project name, whether it is a Pages
 * project, and the variable NAMES declared per environment.
 * Values are never captured — the parser records keys only,
 * so nothing downstream can leak a value it never held.
 * Deliberately a shape reader, not a TOML implementation:
 * top-level keys, [vars], and [env.<name>] / [env.<name>.vars]
 * sections are all the facet needs.
 */

export interface WranglerShape {
  name?: string
  pages: boolean
  main?: string
  pagesBuildOutputDir?: string
  /** Declared [env.<name>] sections, in file order. */
  environments: string[]
  /** env name ('production' for the top level) → var names. */
  envVars: Record<string, string[]>
}

export function parseWranglerToml(text: string): WranglerShape {
  const shape: WranglerShape = { pages: false, environments: [], envVars: {} }
  let section = ''
  let inVars = false
  let currentEnv = 'production'
  const addVar = (env: string, key: string) => {
    const list = shape.envVars[env] ?? []
    if (!list.includes(key)) list.push(key)
    shape.envVars[env] = list
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const sec = /^\[([^\]]+)\]$/.exec(line)
    if (sec) {
      section = sec[1].trim()
      inVars = section === 'vars' || section.endsWith('.vars')
      const envMatch = /^env\.([^.\]]+)$/.exec(section)
      const envVarsMatch = /^env\.([^.\]]+)\.vars$/.exec(section)
      if (envMatch) {
        currentEnv = envMatch[1]
        if (!shape.environments.includes(currentEnv)) shape.environments.push(currentEnv)
      } else if (envVarsMatch) currentEnv = envVarsMatch[1]
      else if (section === 'vars') currentEnv = 'production'
      continue
    }
    const kv = /^([A-Za-z0-9_-]+)\s*=/.exec(line)
    if (!kv) continue
    const key = kv[1]
    if (inVars) { addVar(currentEnv, key); continue }
    if (section === '') {
      if (key === 'name') {
        const v = /=\s*"([^"]*)"/.exec(line)
        if (v) shape.name = v[1]
      } else if (key === 'pages_build_output_dir') {
        shape.pages = true
        const v = /=\s*"([^"]*)"/.exec(line)
        if (v) shape.pagesBuildOutputDir = v[1]
      }
      else if (key === 'main') {
        const v = /=\s*"([^"]*)"/.exec(line)
        if (v) shape.main = v[1]
      }
    } else if (/^env\.[^.\]]+$/.test(section) && key === 'name') {
      // Per-env worker names exist; the target name stays the
      // top-level one — the facet tracks one target per file.
    }
  }
  return shape
}
