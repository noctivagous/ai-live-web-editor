import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { deriveConfigInventory } from '../configregistry/configRegistry.js'
import {
  lastDeployment, readDeployments, recordDeployment, runDeployAction, targetViews,
  type DeployPlugin, type DeploymentRecord,
} from './deploy.js'
import { parseWranglerToml } from './wranglerToml.js'

const SECRET_VALUE = 'hunter2-' + 'not-a-real-secret'

const WRANGLER = `name = "shopfront"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
PUBLIC_NAME = "shop"
API_TOKEN = "${SECRET_VALUE}"

[env.preview]
name = "shopfront-preview"

[env.preview.vars]
PUBLIC_NAME = "preview-shop"
PREVIEW_FLAG = "1"
`

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ale-deploy-'))
}

function scratchRepo(): string {
  const dir = scratch()
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf-8' })
  git('init', '-b', 'main')
  git('config', 'user.email', 't@example.com')
  git('config', 'user.name', 'Test')
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n')
  git('add', '-A')
  git('commit', '-m', 'first')
  return dir
}

describe('parseWranglerToml — the non-secret shape (§7.3)', () => {
  it('reads the name and var NAMES per environment — never a value', () => {
    const shape = parseWranglerToml(WRANGLER)
    assert.equal(shape.name, 'shopfront')
    assert.equal(shape.main, 'src/index.ts')
    assert.deepEqual(shape.envVars.production, ['PUBLIC_NAME', 'API_TOKEN'])
    assert.deepEqual(shape.envVars.preview, ['PUBLIC_NAME', 'PREVIEW_FLAG'])
    assert.ok(!JSON.stringify(shape).includes(SECRET_VALUE), 'a var value must never enter the shape')
  })

  it('recognises a Pages project', () => {
    const shape = parseWranglerToml('name = "site"\npages_build_output_dir = "dist"\n')
    assert.equal(shape.pages, true)
  })
})

describe('configuration recognizers — deployment targets (§13.6)', () => {
  it('detects wrangler.toml + vercel.json; no secret value reaches the inventory', () => {
    const dir = scratch()
    fs.writeFileSync(path.join(dir, 'wrangler.toml'), WRANGLER)
    fs.writeFileSync(path.join(dir, 'vercel.json'), JSON.stringify({ framework: 'vite' }))
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', type: 'module' }))
    const inv = deriveConfigInventory(dir)
    const ids = inv.groups.map(g => g.id)
    assert.ok(ids.includes('cloudflare'), `expected a cloudflare group, got ${ids.join(', ')}`)
    assert.ok(ids.includes('vercel'), `expected a vercel group, got ${ids.join(', ')}`)
    const cf = inv.groups.find(g => g.id === 'cloudflare')!
    assert.deepEqual(cf.entries[0].envKeys, ['API_TOKEN', 'PREVIEW_FLAG', 'PUBLIC_NAME'])
    assert.ok(!JSON.stringify(inv).includes(SECRET_VALUE), 'a var value must never enter the inventory')
    assert.ok(!inv.unrecognised.includes('wrangler.toml'))
    assert.ok(!inv.unrecognised.includes('vercel.json'))
  })
})

describe('deployment history store', () => {
  it('records newest first and reads back per target', () => {
    const dir = scratch()
    const base: DeploymentRecord = {
      id: 'a', at: '2026-01-01T00:00:00.000Z', pluginId: 'fake', targetId: 'fake:one',
      targetName: 'one', kind: 'preview', action: 'deploy', state: 'succeeded',
    }
    recordDeployment(dir, base)
    recordDeployment(dir, { ...base, id: 'b', at: '2026-01-02T00:00:00.000Z' })
    assert.deepEqual(readDeployments(dir).map(r => r.id), ['b', 'a'])
    assert.equal(lastDeployment(dir, 'fake:one')!.id, 'b')
    assert.equal(lastDeployment(dir, 'fake:other'), null)
  })
})

/* A fake plugin: the contract exercised without any provider. */
function fakePlugin(connected: boolean): DeployPlugin & { deployed: number } {
  const plugin: DeployPlugin & { deployed: number } = {
    id: 'fake', label: 'FakeHost', deployed: 0,
    detect: () => [{ id: 'fake:one', pluginId: 'fake', name: 'one', service: 'Fake', configFile: 'fake.json', envNames: {} }],
    connectState: async () => connected
      ? { connected: true, accountLabel: 'tester', howToConnect: '' }
      : { connected: false, howToConnect: 'Set FAKE_TOKEN to connect.' },
    deploy: async () => { plugin.deployed++; return { ok: true, url: 'https://one.example.com', deploymentId: 'd1' } },
    promote: async () => ({ ok: true, url: 'https://one.example.com' }),
    rollback: async () => ({ ok: true }),
    logs: async () => [{ text: 'a log line' }],
    status: async () => ({ url: 'https://one.example.com', domains: ['one.example.com'] }),
  }
  return plugin
}

describe('runDeployAction — the facet rules (§13.5)', () => {
  it('refuses while not connected, in plain words, and never calls the plugin', async () => {
    const dir = scratchRepo()
    const plugin = fakePlugin(false)
    const views = await targetViews(dir, [plugin])
    assert.equal(views[0].connect.connected, false)
    const r = await runDeployAction(dir, [plugin], { action: 'deploy', targetId: 'fake:one', kind: 'preview' })
    assert.ok('error' in r && /not connected/.test(r.error) && /FAKE_TOKEN/.test(r.error))
    assert.equal(plugin.deployed, 0)
    assert.equal(readDeployments(dir).length, 0, 'a refused action records nothing')
  })

  it('deploys through the plugin and records the outcome against HEAD', async () => {
    const dir = scratchRepo()
    const plugin = fakePlugin(true)
    const r = await runDeployAction(dir, [plugin], { action: 'deploy', targetId: 'fake:one', kind: 'preview' })
    assert.ok('record' in r)
    if ('record' in r) {
      assert.equal(r.record.state, 'succeeded')
      assert.equal(r.record.url, 'https://one.example.com')
      assert.ok(r.record.commit && r.record.commit.length >= 7)
    }
    assert.equal(plugin.deployed, 1)
    // Promote needs a recorded deployment to act on.
    const bad = await runDeployAction(dir, [plugin], { action: 'promote', targetId: 'fake:one' })
    assert.ok('error' in bad && /needs a recorded deployment/.test(bad.error))
    const good = await runDeployAction(dir, [plugin], { action: 'promote', targetId: 'fake:one', recordId: readDeployments(dir)[0].id })
    assert.ok('record' in good)
  })

  it('an unknown target is a plain error', async () => {
    const r = await runDeployAction(scratch(), [fakePlugin(true)], { action: 'deploy', targetId: 'fake:nope' })
    assert.ok('error' in r && /No deployment target/.test(r.error))
  })
})
