import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { configGet, configSet, deriveConfigInventory, setJsonTopLevel } from './configRegistry.js'

function viteProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-config-'))
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'app', workspaces: ['packages/*'],
    dependencies: { vite: '^5.0.0', react: '^18.0.0' },
  }, null, 2))
  fs.writeFileSync(path.join(root, 'vite.config.ts'), 'export default {}\n')
  fs.writeFileSync(path.join(root, 'tsconfig.json'), '{ "compilerOptions": { "strict": true } }\n')
  fs.writeFileSync(path.join(root, '.env'), 'API_KEY=' + 'shh-do-not-show' + '\nPLAIN=1\n')
  fs.writeFileSync(path.join(root, 'project.ai.json'), JSON.stringify({ type: 'web-app', format: 'app', entry: 'index.html', deviceTargets: ['phone', 'desktop'] }))
  fs.writeFileSync(path.join(root, 'weird.config.toml'), 'x = 1\n')
  fs.mkdirSync(path.join(root, 'packages/a'), { recursive: true })
  fs.writeFileSync(path.join(root, 'packages/a/package.json'), '{ "name": "a" }')
  return root
}

describe('configuration registry (§7)', () => {
  it('recognizers combine: Vite app + monorepo + ALE record fire together', () => {
    const inv = deriveConfigInventory(viteProject())
    const ids = inv.groups.map(g => g.id)
    assert.ok(ids.includes('vite-web-app'))
    assert.ok(ids.includes('monorepo'))
    assert.ok(ids.includes('ale-project'))
    assert.equal(inv.projectRecord?.format, 'app')
    assert.deepEqual(inv.projectRecord?.deviceTargets, ['phone', 'desktop'])
    const pkg = inv.groups.find(g => g.id === 'vite-web-app')?.entries.find(e => e.file === 'package.json')
    assert.equal(pkg?.profileId, 'package')
  })

  it('the secrets rule: .env shows names, never values', () => {
    const inv = deriveConfigInventory(viteProject())
    const env = inv.groups.flatMap(g => g.entries).find(e => e.file === '.env')
    assert.ok(env)
    assert.deepEqual(env.envKeys, ['API_KEY', 'PLAIN'])
    assert.ok(!JSON.stringify(inv).includes('shh-do-not-show'))
    const got = configGet(viteProject(), '.env')
    assert.equal(got.ok, false)
  })

  it('unrecognised config files are listed, never invisible', () => {
    const inv = deriveConfigInventory(viteProject())
    assert.ok(inv.unrecognised.includes('weird.config.toml'))
    assert.ok(inv.groups.some(g => g.missingAspects.length > 0))
  })

  it('a plain HTML folder fires only the plain-html recognizer', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-config-html-'))
    fs.writeFileSync(path.join(root, 'index.html'), '<html></html>')
    const inv = deriveConfigInventory(root)
    assert.deepEqual(inv.groups.map(g => g.id), ['plain-html'])
  })

  it('config-set replaces one top-level value by offset and refuses env/new keys', () => {
    const src = '{\n  "name": "app",\n  "scripts": { "dev": "vite" },\n  "private": true\n}\n'
    const out = setJsonTopLevel(src, 'private', false)
    assert.equal(out, '{\n  "name": "app",\n  "scripts": { "dev": "vite" },\n  "private": false\n}\n')
    const root = viteProject()
    assert.equal(configSet(root, '.env', 'PLAIN', '2').ok, false)
    assert.equal(configSet(root, 'tsconfig.json', 'notThere', 1).ok, false)
    const okSet = configSet(root, 'tsconfig.json', 'compilerOptions', { strict: false })
    assert.equal(okSet.ok, true)
    const got = configGet(root, 'tsconfig.json', 'compilerOptions')
    assert.deepEqual(got.ok && got.value, { strict: false })
  })
})
