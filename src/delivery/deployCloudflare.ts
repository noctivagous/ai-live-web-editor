/**
 * The Cloudflare deployment plugin (§13.5): Workers and
 * Pages targets declared by wrangler.toml, driven through
 * the provider's own surfaces — wrangler for deploys (its
 * documented CLI), the v4 API for connection checks, status
 * and Workers rollback.
 *
 * Credentials (§7.3): CLOUDFLARE_API_TOKEN +
 * CLOUDFLARE_ACCOUNT_ID from the editor's environment, or a
 * `wrangler login` session. Tokens are read to USE, never
 * surfaced: results carry ids, URLs and output tails only.
 *
 * Honest edges, in the plugin's own words where they occur:
 * Pages has no promote (a branch deploy is already live at
 * its URL — re-deploying to production is the move); a
 * Workers preview needs an [env.preview] section; rollback
 * needs the API token; live log tailing is a stream and
 * stays a terminal job.
 */
import fs from 'node:fs'
import path from 'node:path'
import { listProjectFiles } from '../launcher.js'
import type {
  ConnectState, DeployKind, DeployLogEntry, DeployPlugin, DeployResult, DeploymentRecord, DeployStatus, DeployTarget,
} from './deploy.js'
import { firstUrl, httpJson, outputTail, runCli } from './deployTransport.js'
import { parseWranglerToml, type WranglerShape } from './wranglerToml.js'

const API = 'https://api.cloudflare.com/client/v4'
const HOW_TO_CONNECT = 'Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the editor\'s environment, or run `wrangler login` in a terminal.'

interface CfTarget extends DeployTarget { shape: WranglerShape, dir: string }

function cfTargets(root: string): CfTarget[] {
  const files = listProjectFiles(root).map(e => e.path.replace(/^\//, '')).filter(f => /(^|\/)wrangler\.toml$/.test(f))
  const targets: CfTarget[] = []
  for (const file of files) {
    let text = ''
    try { text = fs.readFileSync(path.join(root, file), 'utf-8') } catch { continue }
    const shape = parseWranglerToml(text)
    const dir = path.dirname(file)
    const name = shape.name ?? (dir === '.' ? path.basename(root) : path.basename(dir))
    targets.push({
      id: `cloudflare:${name}`, pluginId: 'cloudflare', name,
      service: shape.pages ? 'Pages' : 'Workers', configFile: file,
      envNames: shape.envVars, shape, dir,
    })
  }
  return targets
}

function envCreds(): { token: string, accountId: string } | null {
  const token = process.env.CLOUDFLARE_API_TOKEN
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  return token && accountId ? { token, accountId } : null
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

function apiError(r: { status: number, json: unknown, text: string }): string {
  const errors = (r.json as { errors?: { message?: string }[] } | null)?.errors
  const msg = errors?.map(e => e.message).filter(Boolean).join('; ')
  return msg || `Cloudflare API answered ${r.status}.`
}

async function cfConnectState(root: string): Promise<ConnectState> {
  const creds = envCreds()
  if (creds) {
    try {
      const verify = await httpJson(`${API}/accounts/${creds.accountId}/tokens/verify`, { headers: authHeaders(creds.token) })
      if (verify.status === 200) {
        let label = 'Cloudflare account'
        const acct = await httpJson(`${API}/accounts/${creds.accountId}`, { headers: authHeaders(creds.token) })
        const name = (acct.json as { result?: { name?: string } } | null)?.result?.name
        if (typeof name === 'string' && name) label = name
        return { connected: true, accountLabel: label, howToConnect: HOW_TO_CONNECT }
      }
    } catch { /* fall through to the CLI session check */ }
  }
  const who = await runCli('wrangler', ['whoami'], root).catch(() => null)
  if (who && who.code === 0 && /@/.test(who.stdout)) {
    const email = /[^\s]+@[^\s]+/.exec(who.stdout)?.[0]
    return { connected: true, accountLabel: email ?? 'wrangler session', howToConnect: HOW_TO_CONNECT }
  }
  return { connected: false, howToConnect: HOW_TO_CONNECT }
}

async function deployWorkers(root: string, target: CfTarget, kind: DeployKind): Promise<DeployResult> {
  const args = ['deploy', '--config', target.configFile]
  if (kind === 'preview') {
    if (!target.shape.environments.includes('preview')) {
      return { ok: false, error: 'This Worker declares no [env.preview] in wrangler.toml, so there is no preview environment to deploy to. Add one, or deploy to production.' }
    }
    args.push('--env', 'preview')
  }
  const r = await runCli('wrangler', args, root)
  if (r.code !== 0) return { ok: false, error: outputTail(r.stderr || r.stdout) || 'wrangler deploy failed.' }
  return { ok: true, url: firstUrl(r.stdout), output: outputTail(r.stdout) }
}

async function deployPages(root: string, target: CfTarget, kind: DeployKind): Promise<DeployResult> {
  const dir = target.shape.pagesBuildOutputDir
  if (!dir) {
    return { ok: false, error: 'wrangler.toml does not declare pages_build_output_dir, so the facet does not know which directory to upload. Add it, or deploy from a terminal with `wrangler pages deploy <dir>`.' }
  }
  const args = ['pages', 'deploy', dir, '--project-name', target.name, '--config', target.configFile]
  if (kind === 'preview') args.push('--branch', 'preview')
  const r = await runCli('wrangler', args, root)
  if (r.code !== 0) return { ok: false, error: outputTail(r.stderr || r.stdout) || 'wrangler pages deploy failed.' }
  return { ok: true, url: firstUrl(r.stdout), output: outputTail(r.stdout) }
}

export const cloudflarePlugin: DeployPlugin = {
  id: 'cloudflare',
  label: 'Cloudflare',
  detect: (root) => cfTargets(root),
  connectState: cfConnectState,

  deploy: async (root, target, kind) => {
    const t = cfTargets(root).find(x => x.id === target.id)
    if (!t) return { ok: false, error: `The target "${target.id}" is no longer in this project.` }
    return t.service === 'Pages' ? deployPages(root, t, kind) : deployWorkers(root, t, kind)
  },

  promote: async (root, target) => {
    const t = cfTargets(root).find(x => x.id === target.id)
    if (!t) return { ok: false, error: `The target "${target.id}" is no longer in this project.` }
    if (t.service === 'Pages') {
      return { ok: false, error: 'Cloudflare Pages has no promote: every branch deploy is already live at its own URL. To ship this build, deploy to production.' }
    }
    // A Workers preview is the same code in another env —
    // promoting it IS the production deploy of the current tree.
    return deployWorkers(root, t, 'production')
  },

  rollback: async (root, target, record) => {
    const t = cfTargets(root).find(x => x.id === target.id)
    if (!t) return { ok: false, error: `The target "${target.id}" is no longer in this project.` }
    const creds = envCreds()
    if (!creds) {
      return { ok: false, error: 'Rollback goes through the Cloudflare API and needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the editor\'s environment — a wrangler login session cannot roll back non-interactively.' }
    }
    if (t.service === 'Pages') {
      if (!record.deploymentId) return { ok: false, error: 'The recorded deployment carries no Cloudflare deployment id to roll back to.' }
      const r = await httpJson(`${API}/accounts/${creds.accountId}/pages/projects/${t.name}/deployments/${record.deploymentId}/rollback`, { method: 'POST', headers: authHeaders(creds.token) })
      return r.status === 200
        ? { ok: true, url: record.url, output: 'Pages deployment rolled back.' }
        : { ok: false, error: apiError(r) }
    }
    // Workers: shift all traffic to the deployment before the
    // one being rolled back from (the previous in the list).
    const list = await httpJson(`${API}/accounts/${creds.accountId}/workers/scripts/${t.name}/deployments`, { headers: authHeaders(creds.token) })
    if (list.status !== 200) return { ok: false, error: apiError(list) }
    const deployments = (list.json as { result?: { id?: string, versions?: unknown[] }[] } | null)?.result ?? []
    if (deployments.length < 2) return { ok: false, error: 'There is no earlier Workers deployment to roll back to.' }
    const previous = deployments[1]
    const r = await httpJson(`${API}/accounts/${creds.accountId}/workers/scripts/${t.name}/deployments`, {
      method: 'POST', headers: authHeaders(creds.token),
      body: JSON.stringify({ strategy: 'percentage', versions: (previous.versions ?? []).map(v => ({ ...(v as object), percentage: 100 })) }),
    })
    return r.status === 200
      ? { ok: true, output: 'Workers traffic moved to the previous deployment.' }
      : { ok: false, error: apiError(r) }
  },

  logs: async (_root, target, record) => {
    const creds = envCreds()
    if (target.service === 'Pages' && creds && record?.deploymentId) {
      const r = await httpJson(`${API}/accounts/${creds.accountId}/pages/projects/${target.name}/deployments/${record.deploymentId}/history/logs`, { headers: authHeaders(creds.token) })
      if (r.status === 200) {
        const entries = (r.json as { result?: { data?: { message?: string, timestamp?: string }[] } } | null)?.result?.data ?? []
        return entries.slice(-100).map(e => ({ at: e.timestamp, text: e.message ?? '' }))
      }
    }
    return [{ text: `Live logs are a stream on Cloudflare — run \`wrangler tail ${target.name}\` in a terminal. Deploy output is kept in the Deployment history instead.` }]
  },

  status: async (_root, target): Promise<DeployStatus> => {
    const creds = envCreds()
    if (!creds) return { domains: [], note: 'Connect Cloudflare (API token) to read live status.' }
    const t = target as CfTarget
    if (t.service === 'Pages') {
      const r = await httpJson(`${API}/accounts/${creds.accountId}/pages/projects/${t.name}`, { headers: authHeaders(creds.token) })
      if (r.status !== 200) return { domains: [], note: apiError(r) }
      const result = (r.json as { result?: { subdomain?: string, domains?: string[], canonical_deployment?: { modified_on?: string } } }).result ?? {}
      const url = result.subdomain ? `https://${result.subdomain}` : undefined
      return {
        ...(url ? { url } : {}),
        ...(result.canonical_deployment?.modified_on ? { lastDeployAt: result.canonical_deployment.modified_on } : {}),
        domains: result.domains ?? (result.subdomain ? [result.subdomain] : []),
      }
    }
    const sub = await httpJson(`${API}/accounts/${creds.accountId}/workers/subdomain`, { headers: authHeaders(creds.token) })
    const subdomain = (sub.json as { result?: { subdomain?: string } } | null)?.result?.subdomain
    const deps = await httpJson(`${API}/accounts/${creds.accountId}/workers/scripts/${t.name}/deployments`, { headers: authHeaders(creds.token) })
    const latest = (deps.json as { result?: { created_on?: string }[] } | null)?.result?.[0]
    const url = subdomain ? `https://${t.name}.${subdomain}.workers.dev` : undefined
    return {
      ...(url ? { url } : {}),
      ...(latest?.created_on ? { lastDeployAt: latest.created_on } : {}),
      domains: url ? [url.replace('https://', '')] : [],
      ...(subdomain ? {} : { note: 'The account\'s workers.dev subdomain could not be read.' }),
    }
  },
}
