/**
 * Config profiles for YAML, TOML and .env — the same recognition +
 * inheritance as lib/jsonProfiles: every file gets its format's
 * GENERIC profile (a form over the tree), and a recognised file
 * inherits it and overrides only what it knows better (title,
 * sections, field descriptions, enum options). The profile shape
 * and the grouping/lookup helpers are jsonProfiles' own — one
 * profile system for every config format, not one per format.
 *
 * Adding a config kind is adding one profile object here.
 */

import { fieldMetaFor, groupTopLevelKeys, type JsonProfile } from './jsonProfiles'
import type { ConfigFormat } from './configDoc'

export type ConfigProfile = JsonProfile
export { fieldMetaFor, groupTopLevelKeys }

const GENERIC_YAML: ConfigProfile = {
  id: 'yaml-generic',
  title: 'YAML file',
  description: 'Editing a field rewrites that value in the file. Everything else — order, comments, layout — stays as it is.',
  sections: [],
  fields: {},
}

const GENERIC_TOML: ConfigProfile = {
  id: 'toml-generic',
  title: 'TOML file',
  description: 'Editing a field rewrites that value in the file. Everything else — order, comments, layout — stays as it is.',
  sections: [],
  fields: {},
}

const GENERIC_ENV: ConfigProfile = {
  id: 'env-generic',
  title: 'Environment variables',
  description: 'One variable per line. Editing a value rewrites that line; comments and ordering stay as they are.',
  sections: [],
  fields: {},
}

const GITHUB_WORKFLOW: ConfigProfile = {
  id: 'github-workflow',
  title: 'GitHub Actions workflow',
  description: 'A CI workflow: when it runs, and the jobs it runs. Editing a field rewrites that value in the file.',
  sections: [
    { id: 'workflow', title: 'Workflow', keys: ['name', 'run-name', 'on', 'env', 'permissions', 'concurrency', 'defaults'] },
    { id: 'jobs', title: 'Jobs', keys: ['jobs'] },
  ],
  fields: {
    'name': { description: 'The workflow name, shown in the Actions tab.' },
    'on': { description: 'The events that trigger this workflow.' },
    'jobs': { description: 'Each job runs on its own runner; steps run in order.' },
  },
}

const COMPOSE: ConfigProfile = {
  id: 'docker-compose',
  title: 'Docker Compose file',
  description: 'The services this project runs together. Editing a field rewrites that value in the file.',
  sections: [
    { id: 'services', title: 'Services', keys: ['services'] },
    { id: 'data', title: 'Volumes & networks', keys: ['volumes', 'networks', 'configs', 'secrets'] },
  ],
  fields: {
    'services': { description: 'One entry per container: its image or build, ports, environment and volumes.' },
  },
}

const CARGO: ConfigProfile = {
  id: 'cargo',
  title: 'Cargo.toml — Rust package',
  description: 'The Rust package manifest: what the crate is and what it depends on. Editing a field rewrites that value in the file.',
  sections: [
    { id: 'package', title: 'Package', keys: ['package'] },
    { id: 'deps', title: 'Dependencies', keys: ['dependencies', 'dev-dependencies', 'build-dependencies', 'target'] },
    { id: 'shape', title: 'Crates & features', keys: ['lib', 'bin', 'features', 'workspace'] },
    { id: 'profiles', title: 'Build profiles', keys: ['profile'] },
  ],
  fields: {
    'package.name': { description: 'The crate name, as other crates depend on it.' },
    'package.version': { description: 'The crate version (major.minor.patch).' },
    'package.edition': { description: 'The Rust edition this crate is written in.', control: 'select', options: ['2015', '2018', '2021', '2024'] },
    'package.description': { control: 'longtext' },
    'dependencies': { description: 'Crates this package needs to build and run.' },
    'dev-dependencies': { description: 'Crates only tests, examples and benchmarks need.' },
  },
}

const PYPROJECT: ConfigProfile = {
  id: 'pyproject',
  title: 'pyproject.toml — Python project',
  description: 'The Python project manifest: metadata, dependencies and tool settings. Editing a field rewrites that value in the file.',
  sections: [
    { id: 'project', title: 'Project', keys: ['project'] },
    { id: 'build', title: 'Build', keys: ['build-system'] },
    { id: 'tools', title: 'Tool settings', keys: ['tool'] },
  ],
  fields: {
    'project.name': { description: 'The distribution name, as it appears on PyPI.' },
    'project.version': { description: 'The project version.' },
    'project.description': { control: 'longtext' },
    'project.dependencies': { description: 'Packages this project needs at runtime.' },
  },
}

function basename(path: string): string {
  return (path.split('/').pop() || path).toLowerCase()
}

/** Recognition, by path and filename — that is what makes a YAML
 * file a CI workflow rather than anonymous config. */
export function profileForConfigPath(path: string, format: ConfigFormat): ConfigProfile {
  const base = basename(path)
  if (format === 'yaml') {
    if (path.toLowerCase().includes('/.github/workflows/')) return GITHUB_WORKFLOW
    if (base === 'docker-compose.yml' || base === 'docker-compose.yaml' || base === 'compose.yml' || base === 'compose.yaml') return COMPOSE
    return GENERIC_YAML
  }
  if (format === 'toml') {
    if (base === 'cargo.toml') return CARGO
    if (base === 'pyproject.toml') return PYPROJECT
    return GENERIC_TOML
  }
  return GENERIC_ENV
}
