import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { ciOverview } from './ci.js'
import { readCiSummary } from './ciStore.js'
import { githubActionsPlugin, parseGitHubRemote } from './ciGithub.js'
import { setCliRunner, setHttpFetcher, type HttpResult } from './deployTransport.js'

const GH_TOKEN = 'ghp_' + 'testtoken0000000000'

interface HttpCall { url: string, method: string, headers: Record<string, string>, body?: string }
let httpCalls: HttpCall[] = []
let httpHandler: (url: string, method: string) => HttpResult = () => ({ status: 404, json: { message: 'Not Found' }, text: '' })
let cliHandler: (cmd: string, args: string[]) => { code: number, stdout: string, stderr: string } =
  () => ({ code: 1, stdout: '', stderr: 'gh not logged in' })
let savedEnv: Record<string, string | undefined> = {}

function git(dir: string, args: string[]): void {
  execFileSync('git', ['-c', 'user.email=ci@test', '-c', 'user.name=CI Test', ...args], { cwd: dir, encoding: 'utf-8' })
}

function scratchRepo(remote: string | null, files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-ci-gh-'))
  const all = {
    '.github/workflows/ci.yml': 'name: CI\non:\n  push:\n  workflow_dispatch:\njobs:\n  test:\n    steps:\n      - run: npm test\n',
    ...files,
  }
  for (const [rel, text] of Object.entries(all)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, text)
  }
  git(dir, ['init', '-b', 'main'])
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-m', 'fixture'])
  if (remote) git(dir, ['remote', 'add', 'origin', remote])
  return dir
}

const RUN_JSON = {
  id: 101, name: 'CI', path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'failure',
  head_branch: 'main', head_sha: 'deadbeefcafe', event: 'push',
  created_at: '2026-11-13T02:00:00Z', updated_at: '2026-11-13T02:03:00Z',
  html_url: 'https://github.com/acme/widget/actions/runs/101',
}

beforeEach(() => {
  httpCalls = []
  httpHandler = () => ({ status: 404, json: { message: 'Not Found' }, text: '' })
  cliHandler = () => ({ code: 1, stdout: '', stderr: 'gh not logged in' })
  savedEnv = {}
  for (const k of ['GITHUB_TOKEN', 'GH_TOKEN', 'ALE_GITHUB_API_BASE']) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
  setHttpFetcher(async (url, init) => {
    httpCalls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body })
    return httpHandler(url, init.method ?? 'GET')
  })
  setCliRunner(async (cmd, args) => cliHandler(cmd, args))
})

afterEach(() => {
  setHttpFetcher(null)
  setCliRunner(null)
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('github remote parsing', () => {
  it('reads the shapes git records; a foreign host needs the explicit API override', () => {
    assert.deepEqual(parseGitHubRemote('https://github.com/acme/widget.git'), { owner: 'acme', repo: 'widget' })
    assert.deepEqual(parseGitHubRemote('https://github.com/acme/widget'), { owner: 'acme', repo: 'widget' })
    assert.deepEqual(parseGitHubRemote('git@github.com:acme/widget.git'), { owner: 'acme', repo: 'widget' })
    assert.deepEqual(parseGitHubRemote('ssh://git@github.com/acme/widget.git'), { owner: 'acme', repo: 'widget' })
    assert.equal(parseGitHubRemote('https://gitlab.com/acme/widget.git'), null)
    assert.deepEqual(
      parseGitHubRemote('https://ghe.example.com/acme/widget.git', 'https://ghe.example.com/api/v3'),
      { owner: 'acme', repo: 'widget' },
    )
    assert.equal(parseGitHubRemote('not a url'), null)
  })
})

describe('github actions plugin', () => {
  it('detects workflow files + a GitHub remote, and nothing less', () => {
    assert.equal(githubActionsPlugin.detect(scratchRepo('https://github.com/acme/widget.git')), true)
    assert.equal(githubActionsPlugin.detect(scratchRepo('https://gitlab.com/acme/widget.git')), false)
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-ci-gh-bare-'))
    git(bare, ['init', '-b', 'main'])
    git(bare, ['remote', 'add', 'origin', 'https://github.com/acme/widget.git'])
    assert.equal(githubActionsPlugin.detect(bare), false)
  })

  it('connect state via token: connected with the login; the token surfaces nowhere', async () => {
    const dir = scratchRepo('https://github.com/acme/widget.git')
    process.env.GITHUB_TOKEN = GH_TOKEN
    httpHandler = (url) => url.endsWith('/user')
      ? { status: 200, json: { login: 'octo', name: 'Octo Cat' }, text: '' }
      : { status: 404, json: {}, text: '' }
    const state = await githubActionsPlugin.connectState(dir)
    assert.equal(state.connected, true)
    assert.match(state.accountLabel ?? '', /octo/)
    assert.ok(!JSON.stringify(state).includes(GH_TOKEN))
    assert.equal(httpCalls[0].headers.Authorization, `Bearer ${GH_TOKEN}`)
    assert.ok(!httpCalls[0].url.includes(GH_TOKEN))
  })

  it('connect state: a refused token is plain words; a gh session connects without any token in play', async () => {
    const dir = scratchRepo('https://github.com/acme/widget.git')
    process.env.GITHUB_TOKEN = GH_TOKEN
    httpHandler = () => ({ status: 401, json: { message: 'Bad credentials' }, text: '' })
    const refused = await githubActionsPlugin.connectState(dir)
    assert.equal(refused.connected, false)
    assert.match(refused.howToConnect, /401/)
    delete process.env.GITHUB_TOKEN
    cliHandler = (cmd, args) => cmd === 'gh' && args[0] === 'api'
      ? { code: 0, stdout: JSON.stringify({ login: 'ghuser' }), stderr: '' }
      : { code: 1, stdout: '', stderr: '' }
    const viaGh = await githubActionsPlugin.connectState(dir)
    assert.equal(viaGh.connected, true)
    assert.equal(viaGh.accountLabel, 'ghuser')
    cliHandler = () => ({ code: 1, stdout: '', stderr: 'not logged in' })
    const off = await githubActionsPlugin.connectState(dir)
    assert.equal(off.connected, false)
    assert.match(off.howToConnect, /GITHUB_TOKEN/)
  })

  it('runs are mapped (duration derived), requested from the repo\'s Actions API', async () => {
    const dir = scratchRepo('https://github.com/acme/widget.git')
    process.env.GITHUB_TOKEN = GH_TOKEN
    httpHandler = (url) => url.includes('/actions/runs')
      ? { status: 200, json: { workflow_runs: [RUN_JSON] }, text: '' }
      : { status: 404, json: {}, text: '' }
    const runs = await githubActionsPlugin.runs(dir, 20)
    assert.equal(runs.length, 1)
    assert.deepEqual(runs[0], {
      id: '101', pipelineName: 'CI', workflowFile: '.github/workflows/ci.yml',
      status: 'completed', conclusion: 'failure', branch: 'main', commit: 'deadbeefcafe',
      event: 'push', createdAt: '2026-11-13T02:00:00Z', updatedAt: '2026-11-13T02:03:00Z',
      durationMs: 180_000, url: 'https://github.com/acme/widget/actions/runs/101',
    })
    assert.equal(httpCalls[0].url, 'https://api.github.com/repos/acme/widget/actions/runs?per_page=20')
  })

  it('run detail maps jobs and steps', async () => {
    const dir = scratchRepo('https://github.com/acme/widget.git')
    process.env.GITHUB_TOKEN = GH_TOKEN
    httpHandler = (url) => {
      if (url.endsWith('/jobs?per_page=100')) {
        return {
          status: 200, text: '',
          json: {
            jobs: [{
              id: 55, name: 'test', status: 'completed', conclusion: 'failure',
              started_at: '2026-11-13T02:00:10Z', completed_at: '2026-11-13T02:02:00Z',
              steps: [
                { number: 1, name: 'Set up job', status: 'completed', conclusion: 'success' },
                { number: 2, name: 'Run tests', status: 'completed', conclusion: 'failure' },
              ],
            }],
          },
        }
      }
      return { status: 200, json: RUN_JSON, text: '' }
    }
    const detail = await githubActionsPlugin.runDetail(dir, '101')
    assert.equal(detail.run.id, '101')
    assert.equal(detail.jobs[0].id, '55')
    assert.equal(detail.jobs[0].steps[1].conclusion, 'failure')
  })

  it('trigger posts a dispatch for the workflow file on the current branch; rerun and cancel hit their endpoints', async () => {
    const dir = scratchRepo('https://github.com/acme/widget.git')
    process.env.GITHUB_TOKEN = GH_TOKEN
    httpHandler = (_url, method) => method === 'POST' ? { status: 204, json: null, text: '' } : { status: 200, json: {}, text: '' }
    const pipeline = githubActionsPlugin.pipelines(dir)[0]
    assert.equal((await githubActionsPlugin.trigger(dir, pipeline)).ok, true)
    const dispatch = httpCalls.find(c => c.url.includes('/dispatches'))
    assert.ok(dispatch)
    assert.equal(dispatch.url, 'https://api.github.com/repos/acme/widget/actions/workflows/ci.yml/dispatches')
    assert.deepEqual(JSON.parse(dispatch.body ?? '{}'), { ref: 'main' })

    httpHandler = () => ({ status: 201, json: null, text: '' })
    assert.equal((await githubActionsPlugin.rerun(dir, '101', true)).ok, true)
    assert.ok(httpCalls.some(c => c.url.endsWith('/actions/runs/101/rerun-failed-jobs')))
    assert.equal((await githubActionsPlugin.rerun(dir, '101', false)).ok, true)
    assert.ok(httpCalls.some(c => c.url.endsWith('/actions/runs/101/rerun')))

    httpHandler = () => ({ status: 202, json: null, text: '' })
    assert.equal((await githubActionsPlugin.cancel(dir, '101')).ok, true)
    assert.ok(httpCalls.some(c => c.url.endsWith('/actions/runs/101/cancel')))
    for (const c of httpCalls) assert.ok(!c.url.includes(GH_TOKEN), 'token never in a URL')
  })

  it('a provider refusal is surfaced in its own words', async () => {
    const dir = scratchRepo('https://github.com/acme/widget.git')
    process.env.GITHUB_TOKEN = GH_TOKEN
    httpHandler = () => ({ status: 422, json: { message: 'Workflow does not have workflow_dispatch trigger' }, text: '' })
    const pipeline = githubActionsPlugin.pipelines(dir)[0]
    const r = await githubActionsPlugin.trigger(dir, pipeline)
    assert.equal(r.ok, false)
    assert.match(r.error ?? '', /workflow_dispatch/)
  })

  it('job logs come back as text lines; secrets are names only', async () => {
    const dir = scratchRepo('https://github.com/acme/widget.git')
    process.env.GITHUB_TOKEN = GH_TOKEN
    httpHandler = (url) => {
      if (url.includes('/jobs/77/logs')) return { status: 200, json: null, text: 'line one\nline two\n' }
      if (url.includes('/actions/secrets')) return { status: 200, json: { secrets: [{ name: 'NPM_TOKEN' }, { name: 'DEPLOY_KEY' }] }, text: '' }
      return { status: 404, json: {}, text: '' }
    }
    assert.deepEqual(await githubActionsPlugin.jobLogs(dir, '77'), ['line one', 'line two'])
    assert.deepEqual(await githubActionsPlugin.secrets!(dir), ['NPM_TOKEN', 'DEPLOY_KEY'])
  })

  it('through the core: a connected overview is live and writes the summary cache', async () => {
    const dir = scratchRepo('https://github.com/acme/widget.git')
    process.env.GITHUB_TOKEN = GH_TOKEN
    httpHandler = (url) => {
      if (url.endsWith('/user')) return { status: 200, json: { login: 'octo' }, text: '' }
      if (url.includes('/actions/runs')) return { status: 200, json: { workflow_runs: [RUN_JSON] }, text: '' }
      if (url.includes('/actions/secrets')) return { status: 200, json: { secrets: [{ name: 'NPM_TOKEN' }] }, text: '' }
      return { status: 404, json: {}, text: '' }
    }
    const overview = await ciOverview(dir, [githubActionsPlugin])
    assert.equal(overview.runsSource, 'live')
    assert.equal(overview.runs[0].conclusion, 'failure')
    assert.deepEqual(overview.secretNames, ['NPM_TOKEN'])
    assert.equal(readCiSummary(dir)?.recentRuns[0].id, '101')
  })
})
