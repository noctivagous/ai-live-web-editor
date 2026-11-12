import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { cloudflarePlugin } from './deployCloudflare.js'
import { setCliRunner, setHttpFetcher, type CliResult, type HttpResult } from './deployTransport.js'
import { vercelPlugin } from './deployVercel.js'
import type { DeploymentRecord } from './deploy.js'

const CF_TOKEN = 'cf-' + 'testtoken000000'
const VC_TOKEN = 'vc-' + 'testtoken000000'

interface CliCall { cmd: string, args: string[] }
interface HttpCall { url: string, method: string, body?: string }

let cliCalls: CliCall[] = []
let httpCalls: HttpCall[] = []
let cliHandler: (cmd: string, args: string[]) => CliResult = () => ({ code: 1, stdout: '', stderr: 'not logged in' })
let httpHandler: (url: string) => HttpResult = () => ({ status: 404, json: {}, text: '' })
let savedEnv: Record<string, string | undefined> = {}

function scratch(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-deploy-plugins-'))
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, text)
  }
  return dir
}

const RECORD: DeploymentRecord = {
  id: 'r1', at: '2026-01-01T00:00:00.000Z', pluginId: 'cloudflare', targetId: 'cloudflare:shopfront',
  targetName: 'shopfront', kind: 'preview', action: 'deploy', state: 'succeeded',
  url: 'https://shopfront.pages.dev', deploymentId: 'pd-123',
}

beforeEach(() => {
  cliCalls = []
  httpCalls = []
  cliHandler = () => ({ code: 1, stdout: '', stderr: 'not logged in' })
  httpHandler = () => ({ status: 404, json: {}, text: '' })
  savedEnv = {}
  for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'VERCEL_TOKEN']) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
  setCliRunner(async (cmd, args) => { cliCalls.push({ cmd, args }); return cliHandler(cmd, args) })
  setHttpFetcher(async (url, init) => { httpCalls.push({ url, method: init.method ?? 'GET', body: init.body }); return httpHandler(url) })
})

afterEach(() => {
  setCliRunner(null)
  setHttpFetcher(null)
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

const WORKER_TOML = `name = "api-worker"
main = "src/index.ts"

[vars]
PUBLIC_FLAG = "1"

[env.preview]
name = "api-worker-preview"
`

const PAGES_TOML = `name = "shopfront"
pages_build_output_dir = "dist"

[vars]
PUBLIC_NAME = "shop"
`

describe('cloudflare plugin', () => {
  it('detects Workers and Pages targets with env names only', () => {
    const w = cloudflarePlugin.detect(scratch({ 'wrangler.toml': WORKER_TOML }))
    assert.equal(w.length, 1)
    assert.equal(w[0].service, 'Workers')
    assert.deepEqual(w[0].envNames.production, ['PUBLIC_FLAG'])
    const p = cloudflarePlugin.detect(scratch({ 'wrangler.toml': PAGES_TOML }))
    assert.equal(p[0].service, 'Pages')
    assert.equal(p[0].name, 'shopfront')
  })

  it('connect state: not connected without creds or a session; connected via token verify, token never surfaced', async () => {
    const dir = scratch({ 'wrangler.toml': WORKER_TOML })
    const off = await cloudflarePlugin.connectState(dir)
    assert.equal(off.connected, false)
    assert.match(off.howToConnect, /CLOUDFLARE_API_TOKEN/)
    process.env.CLOUDFLARE_API_TOKEN = CF_TOKEN
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-1'
    httpHandler = (url) => url.includes('/tokens/verify')
      ? { status: 200, json: { result: { status: 'active' } }, text: '' }
      : { status: 200, json: { result: { name: 'My Account' } }, text: '' }
    const on = await cloudflarePlugin.connectState(dir)
    assert.equal(on.connected, true)
    assert.equal(on.accountLabel, 'My Account')
    assert.ok(!JSON.stringify(on).includes(CF_TOKEN))
  })

  it('deploys a Workers preview through wrangler with --env preview, and production without it', async () => {
    const dir = scratch({ 'wrangler.toml': WORKER_TOML })
    const target = cloudflarePlugin.detect(dir)[0]
    cliHandler = () => ({ code: 0, stdout: 'Deployed https://api-worker.example.workers.dev', stderr: '' })
    const r = await cloudflarePlugin.deploy(dir, target, 'preview')
    assert.equal(r.ok, true)
    assert.equal(r.url, 'https://api-worker.example.workers.dev')
    assert.deepEqual(cliCalls[0], { cmd: 'wrangler', args: ['deploy', '--config', 'wrangler.toml', '--env', 'preview'] })
    await cloudflarePlugin.deploy(dir, target, 'production')
    assert.deepEqual(cliCalls[1].args, ['deploy', '--config', 'wrangler.toml'])
  })

  it('a Workers preview without [env.preview] is an honest refusal, not a fake deploy', async () => {
    const dir = scratch({ 'wrangler.toml': PAGES_TOML.replace('pages_build_output_dir = "dist"\n', '').replace('[vars]', '[env.staging]\nname = "x"\n\n[vars]') })
    const target = cloudflarePlugin.detect(dir)[0]
    const r = await cloudflarePlugin.deploy(dir, target, 'preview')
    assert.equal(r.ok, false)
    assert.match(r.error!, /no \[env\.preview\]/)
    assert.equal(cliCalls.length, 0)
  })

  it('Pages: deploys the declared output dir; promote is honestly not supported', async () => {
    const dir = scratch({ 'wrangler.toml': PAGES_TOML })
    const target = cloudflarePlugin.detect(dir)[0]
    cliHandler = () => ({ code: 0, stdout: 'Deployment live at https://shopfront.pages.dev', stderr: '' })
    const r = await cloudflarePlugin.deploy(dir, target, 'production')
    assert.equal(r.ok, true)
    assert.deepEqual(cliCalls[0].args, ['pages', 'deploy', 'dist', '--project-name', 'shopfront', '--config', 'wrangler.toml'])
    const p = await cloudflarePlugin.promote(dir, target, RECORD)
    assert.equal(p.ok, false)
    assert.match(p.error!, /no promote/)
  })

  it('Workers rollback: traffic moves to the previous deployment via the API', async () => {
    const dir = scratch({ 'wrangler.toml': WORKER_TOML })
    const target = cloudflarePlugin.detect(dir)[0]
    process.env.CLOUDFLARE_API_TOKEN = CF_TOKEN
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-1'
    httpHandler = (url) => {
      if (url.endsWith('/deployments')) {
        return { status: 200, json: { result: [{ id: 'new', versions: [{ version_id: 'v2' }] }, { id: 'old', versions: [{ version_id: 'v1' }] }] }, text: '' }
      }
      return { status: 404, json: {}, text: '' }
    }
    // POST is also to /deployments — sequence: first GET answered above,
    // then POST; handler returns the list for both, so track methods.
    const methods: string[] = []
    setHttpFetcher(async (url, init) => {
      methods.push(init.method ?? 'GET')
      httpCalls.push({ url, method: init.method ?? 'GET', body: init.body })
      if ((init.method ?? 'GET') === 'POST') return { status: 200, json: { result: {} }, text: '' }
      return httpHandler(url)
    })
    const r = await cloudflarePlugin.rollback(dir, target, { ...RECORD, pluginId: 'cloudflare', targetId: target.id, deploymentId: undefined })
    assert.equal(r.ok, true)
    assert.deepEqual(methods, ['GET', 'POST'])
    const post = httpCalls.find(c => c.method === 'POST')!
    assert.match(post.body!, /"version_id":"v1"/)
    assert.match(post.body!, /"percentage":100/)
    assert.ok(!post.body!.includes(CF_TOKEN), 'the token never travels in a body we build')
  })

  it('rollback without API creds is a plain explanation', async () => {
    const dir = scratch({ 'wrangler.toml': WORKER_TOML })
    const target = cloudflarePlugin.detect(dir)[0]
    const r = await cloudflarePlugin.rollback(dir, target, RECORD)
    assert.equal(r.ok, false)
    assert.match(r.error!, /CLOUDFLARE_API_TOKEN/)
  })

  it('status via the API: Pages subdomain + last deploy time', async () => {
    const dir = scratch({ 'wrangler.toml': PAGES_TOML })
    const target = cloudflarePlugin.detect(dir)[0]
    process.env.CLOUDFLARE_API_TOKEN = CF_TOKEN
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-1'
    httpHandler = () => ({ status: 200, json: { result: { subdomain: 'shopfront.pages.dev', domains: ['shopfront.pages.dev'], canonical_deployment: { modified_on: '2026-01-01T00:00:00Z' } } }, text: '' })
    const s = await cloudflarePlugin.status(dir, target)
    assert.equal(s.url, 'https://shopfront.pages.dev')
    assert.equal(s.lastDeployAt, '2026-01-01T00:00:00Z')
  })
})

describe('vercel plugin', () => {
  const fixture = () => scratch({
    'vercel.json': JSON.stringify({ framework: 'vite' }),
    '.vercel/project.json': JSON.stringify({ projectId: 'prj_1', orgId: 'team_1', projectName: 'mysite' }),
    'package.json': JSON.stringify({ name: 'mysite' }),
  })

  it('detects the project from the link file name', () => {
    const targets = vercelPlugin.detect(fixture())
    assert.equal(targets.length, 1)
    assert.equal(targets[0].name, 'mysite')
    assert.deepEqual(targets[0].envNames, {})
  })

  it('connect state via /v2/user; the token is used, never surfaced', async () => {
    const dir = fixture()
    const off = await vercelPlugin.connectState(dir)
    assert.equal(off.connected, false)
    process.env.VERCEL_TOKEN = VC_TOKEN
    httpHandler = () => ({ status: 200, json: { user: { username: 'nocti' } }, text: '' })
    const on = await vercelPlugin.connectState(dir)
    assert.equal(on.connected, true)
    assert.equal(on.accountLabel, 'nocti')
    assert.ok(!JSON.stringify(on).includes(VC_TOKEN))
    assert.equal(httpCalls[0].url, 'https://api.vercel.com/v2/user')
  })

  it('deploy argv: preview plain, production with --prod; the URL is read from the output', async () => {
    const dir = fixture()
    const target = vercelPlugin.detect(dir)[0]
    cliHandler = () => ({ code: 0, stdout: 'Production: https://mysite-abc.vercel.app', stderr: '' })
    const r = await vercelPlugin.deploy(dir, target, 'preview')
    assert.equal(r.ok, true)
    assert.equal(r.url, 'https://mysite-abc.vercel.app')
    assert.deepEqual(cliCalls[0], { cmd: 'vercel', args: ['deploy', '--yes'] })
    await vercelPlugin.deploy(dir, target, 'production')
    assert.deepEqual(cliCalls[1].args, ['deploy', '--yes', '--prod'])
  })

  it('promote and rollback address the recorded deployment', async () => {
    const dir = fixture()
    const target = vercelPlugin.detect(dir)[0]
    cliHandler = () => ({ code: 0, stdout: 'done', stderr: '' })
    const rec: DeploymentRecord = { ...RECORD, pluginId: 'vercel', targetId: target.id, url: 'https://mysite-abc.vercel.app', deploymentId: 'https://mysite-abc.vercel.app' }
    const p = await vercelPlugin.promote(dir, target, rec)
    assert.equal(p.ok, true)
    assert.deepEqual(cliCalls[0].args, ['promote', 'https://mysite-abc.vercel.app', '--yes'])
    const rb = await vercelPlugin.rollback(dir, target, rec)
    assert.equal(rb.ok, true)
    assert.deepEqual(cliCalls[1].args, ['rollback', 'https://mysite-abc.vercel.app', '--yes'])
  })

  it('status reads the latest deployment for the linked project', async () => {
    const dir = fixture()
    const target = vercelPlugin.detect(dir)[0]
    process.env.VERCEL_TOKEN = VC_TOKEN
    httpHandler = () => ({ status: 200, json: { deployments: [{ url: 'mysite-abc.vercel.app', created: 1767225600000, state: 'READY' }] }, text: '' })
    const s = await vercelPlugin.status(dir, target)
    assert.equal(s.url, 'https://mysite-abc.vercel.app')
    assert.equal(s.state, 'READY')
    assert.match(httpCalls[0].url, /projectId=prj_1/)
    assert.match(httpCalls[0].url, /teamId=team_1/)
  })

  it('status without a link says what is missing instead of guessing', async () => {
    const dir = scratch({ 'vercel.json': '{}' })
    const target = vercelPlugin.detect(dir)[0]
    process.env.VERCEL_TOKEN = VC_TOKEN
    const s = await vercelPlugin.status(dir, target)
    assert.match(s.note!, /not linked/)
  })
})
