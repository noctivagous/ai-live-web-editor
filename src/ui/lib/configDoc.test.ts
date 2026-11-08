import assert from 'node:assert/strict'
import test from 'node:test'
import { parseEnvConfig, parseTomlConfig, parseYamlConfig, replaceConfigScalar, serialiseScalar, type ConfigNode } from './configDoc'

function find(node: ConfigNode, key: string): ConfigNode {
  const hit = (node.children ?? []).find((c) => c.key === key)
  assert.ok(hit, `expected a child named ${key}`)
  return hit
}

const YAML = `# CI configuration
name: Build
on: push

jobs:
  test:
    runs-on: ubuntu-latest
    timeout: 30
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - run: npm test

env:
  DEBUG: false
  EMPTY:
`

test('yaml: parses nested maps, lists of maps and typed scalars', () => {
  const r = parseYamlConfig(YAML)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(find(r.root, 'name').value, 'Build')
  const jobs = find(r.root, 'jobs')
  const jobTest = find(jobs, 'test')
  assert.equal(find(jobTest, 'runs-on').value, 'ubuntu-latest')
  assert.equal(find(jobTest, 'timeout').scalarKind, 'number')
  const steps = find(jobTest, 'steps')
  assert.equal(steps.kind, 'array')
  assert.equal(steps.children?.length, 2)
  assert.equal(find(steps.children![0], 'uses').value, 'actions/checkout@v4')
  assert.equal(find(steps.children![1], 'run').value, 'npm test')
  const env = find(r.root, 'env')
  assert.equal(find(env, 'DEBUG').scalarKind, 'boolean')
  assert.equal(find(env, 'EMPTY').scalarKind, 'null')
})

test('yaml: an edit splices only the value token — comments and layout survive', () => {
  const r = parseYamlConfig(YAML)
  assert.ok(r.ok)
  if (!r.ok) return
  const timeout = find(find(find(r.root, 'jobs'), 'test'), 'timeout')
  const out = replaceConfigScalar(YAML, 'yaml', timeout, '45')
  assert.equal(out, YAML.replace('timeout: 30', 'timeout: 45'))
  const empty = find(find(r.root, 'env'), 'EMPTY')
  const filled = replaceConfigScalar(YAML, 'yaml', empty, 'hello world')
  assert.ok(filled.includes('EMPTY: hello world'))
})

test('yaml: scalar lists and quoting rules on write', () => {
  const src = 'packages:\n  - alpha\n  - beta\n'
  const r = parseYamlConfig(src)
  assert.ok(r.ok)
  if (!r.ok) return
  const list = find(r.root, 'packages')
  assert.equal(list.kind, 'array')
  assert.deepEqual(list.children?.map((c) => c.value), ['alpha', 'beta'])
  const out = replaceConfigScalar(src, 'yaml', list.children![0], 'true')
  assert.ok(out.includes('- "true"')) // bool-looking strings get quoted
  assert.equal(serialiseScalar('yaml', 'string', 'plain-value_1'), 'plain-value_1')
  assert.equal(serialiseScalar('yaml', 'string', 'has: colon'), '"has: colon"')
})

test('yaml: block scalars and flow values are raw, never spliced', () => {
  const src = 'script: |\n  echo hi\n  echo bye\nflow: {a: 1}\n'
  const r = parseYamlConfig(src)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(find(r.root, 'script').kind, 'raw')
  assert.equal(find(r.root, 'flow').kind, 'raw')
  assert.equal(replaceConfigScalar(src, 'yaml', find(r.root, 'flow'), 'x'), src)
})

test('yaml: multi-document files and tabs explain themselves', () => {
  assert.equal(parseYamlConfig('a: 1\n---\nb: 2\n').ok, false)
  assert.equal(parseYamlConfig('a:\n\tb: 1\n').ok, false)
})

const TOML = `# Cargo manifest
[package]
name = "demo"
version = "0.1.0"
edition = 2021

[dependencies]
serde = "1.0"
tokio = { version = "1", features = ["full"] }

[profile.release]
opt-level = 3
debug = false
`

test('toml: sections, dotted structure and typed values', () => {
  const r = parseTomlConfig(TOML)
  assert.ok(r.ok)
  if (!r.ok) return
  const pkg = find(r.root, 'package')
  assert.equal(find(pkg, 'name').value, 'demo')
  assert.equal(find(pkg, 'edition').scalarKind, 'number')
  const deps = find(r.root, 'dependencies')
  assert.equal(find(deps, 'serde').value, '1.0')
  assert.equal(find(deps, 'tokio').kind, 'raw') // inline table: shown, not spliced
  const release = find(find(r.root, 'profile'), 'release')
  assert.equal(find(release, 'debug').scalarKind, 'boolean')
})

test('toml: edits splice in place and strings are re-quoted', () => {
  const r = parseTomlConfig(TOML)
  assert.ok(r.ok)
  if (!r.ok) return
  const version = find(find(r.root, 'package'), 'version')
  assert.equal(replaceConfigScalar(TOML, 'toml', version, '0.2.0'), TOML.replace('"0.1.0"', '"0.2.0"'))
  const opt = find(find(find(r.root, 'profile'), 'release'), 'opt-level')
  assert.equal(replaceConfigScalar(TOML, 'toml', opt, '2'), TOML.replace('opt-level = 3', 'opt-level = 2'))
})

test('toml: scalar arrays are editable item by item', () => {
  const src = '[bin]\nkeywords = ["cli", "tool"]\n'
  const r = parseTomlConfig(src)
  assert.ok(r.ok)
  if (!r.ok) return
  const kw = find(find(r.root, 'bin'), 'keywords')
  assert.equal(kw.kind, 'array')
  assert.deepEqual(kw.children?.map((c) => c.value), ['cli', 'tool'])
  assert.equal(replaceConfigScalar(src, 'toml', kw.children![1], 'utility'), '[bin]\nkeywords = ["cli", "utility"]\n')
})

const ENV = `# settings
PORT=3000
export HOST=localhost
GREETING="hello world"
EMPTY=
# trailing comment line
ODD LINE HERE
`

test('env: keys, export prefix, quoted values and odd lines', () => {
  const r = parseEnvConfig(ENV)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(find(r.root, 'PORT').value, '3000')
  assert.equal(find(r.root, 'HOST').value, 'localhost')
  assert.equal(find(r.root, 'GREETING').value, 'hello world')
  assert.equal(find(r.root, 'EMPTY').value, '')
  assert.ok((r.root.children ?? []).some((c) => c.kind === 'raw'))
})

test('env: edits splice in place; values with spaces are quoted on write', () => {
  const r = parseEnvConfig(ENV)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(replaceConfigScalar(ENV, 'env', find(r.root, 'PORT'), '8080'), ENV.replace('PORT=3000', 'PORT=8080'))
  const out = replaceConfigScalar(ENV, 'env', find(r.root, 'HOST'), 'my host')
  assert.ok(out.includes('export HOST="my host"'))
})
