/**
 * The Vercel deployment plugin (§13.5): projects declared by
 * vercel.json (or a .vercel/project.json link), driven through
 * the provider's own surfaces — the vercel CLI for deploy /
 * promote / rollback / logs (its documented commands), the
 * REST API for the connection check and live status.
 *
 * Credentials (§7.3): VERCEL_TOKEN from the editor's
 * environment (the CLI picks it up itself; it is never put
 * in argv), or a `vercel login` session. vercel.json's own
 * `env` values are project config the facet never reads —
 * env names here come from the provider link, not the file.
 *
 * Status needs the project link (.vercel/project.json, which
 * `vercel link` writes): without it the facet says so rather
 * than guessing which project a name means.
 */
import fs from 'node:fs'
import path from 'node:path'
import { listProjectFiles } from '../launcher.js'
import type {
  ConnectState, DeployLogEntry, DeployPlugin, DeployResult, DeployStatus, DeployTarget,
} from './deploy.js'
import { firstUrl, httpJson, outputTail, runCli } from './deployTransport.js'

const API = 'https://api.vercel.com'
const HOW_TO_CONNECT = 'Set VERCEL_TOKEN in the editor\'s environment, or run `vercel login` in a terminal.'

interface VercelLink { projectId?: string, orgId?: string, projectName?: string }

function readLink(root: string): VercelLink {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, '.vercel', 'project.json'), 'utf-8')) as VercelLink
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}

function vercelTargets(root: string): DeployTarget[] {
  const files = listProjectFiles(root).map(e => e.path.replace(/^\//, ''))
  const hasConfig = files.some(f => /(^|\/)vercel\.json$/.test(f))
  const link = readLink(root)
  if (!hasConfig && !link.projectName) return []
  let name = link.projectName
  if (!name) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as { name?: string }
      if (typeof pkg.name === 'string') name = pkg.name
    } catch { /* fall through */ }
  }
  name = name ?? path.basename(root)
  return [{
    id: `vercel:${name}`, pluginId: 'vercel', name, service: 'Vercel',
    configFile: hasConfig ? 'vercel.json' : '.vercel/project.json', envNames: {},
  }]
}

async function vercelConnectState(root: string): Promise<ConnectState> {
  const token = process.env.VERCEL_TOKEN
  if (token) {
    try {
      const r = await httpJson(`${API}/v2/user`, { headers: { Authorization: `Bearer ${token}` } })
      const user = (r.json as { user?: { username?: string, email?: string } } | null)?.user
      if (r.status === 200 && user) {
        return { connected: true, accountLabel: user.username ?? user.email ?? 'Vercel account', howToConnect: HOW_TO_CONNECT }
      }
    } catch { /* fall through to the CLI session check */ }
  }
  const who = await runCli('vercel', ['whoami'], root).catch(() => null)
  if (who && who.code === 0 && who.stdout.trim()) {
    return { connected: true, accountLabel: who.stdout.trim().split('\n')[0], howToConnect: HOW_TO_CONNECT }
  }
  return { connected: false, howToConnect: HOW_TO_CONNECT }
}

export const vercelPlugin: DeployPlugin = {
  id: 'vercel',
  label: 'Vercel',
  detect: (root) => vercelTargets(root),
  connectState: vercelConnectState,

  deploy: async (root, _target, kind) => {
    const args = ['deploy', '--yes']
    if (kind === 'production') args.push('--prod')
    const r = await runCli('vercel', args, root)
    if (r.code !== 0) return { ok: false, error: outputTail(r.stderr || r.stdout) || 'vercel deploy failed.' }
    const url = firstUrl(r.stdout)
    return { ok: true, ...(url ? { url, deploymentId: url } : {}), output: outputTail(r.stdout) }
  },

  promote: async (root, _target, record) => {
    const ref = record.deploymentId ?? record.url
    if (!ref) return { ok: false, error: 'The recorded deployment carries no URL or id to promote.' }
    const r = await runCli('vercel', ['promote', ref, '--yes'], root)
    return r.code === 0
      ? { ok: true, url: record.url, output: outputTail(r.stdout) }
      : { ok: false, error: outputTail(r.stderr || r.stdout) || 'vercel promote failed.' }
  },

  rollback: async (root, _target, record) => {
    const ref = record.deploymentId ?? record.url
    if (!ref) return { ok: false, error: 'The recorded deployment carries no URL or id to roll back to.' }
    const r = await runCli('vercel', ['rollback', ref, '--yes'], root)
    return r.code === 0
      ? { ok: true, output: outputTail(r.stdout) }
      : { ok: false, error: outputTail(r.stderr || r.stdout) || 'vercel rollback failed.' }
  },

  logs: async (root, _target, record): Promise<DeployLogEntry[]> => {
    const ref = record?.deploymentId ?? record?.url
    if (!ref) return [{ text: 'Logs need a recorded deployment — deploy once from here and its logs can be read.' }]
    const r = await runCli('vercel', ['logs', ref], root)
    if (r.code !== 0) return [{ text: outputTail(r.stderr || r.stdout) || 'vercel logs failed.' }]
    return r.stdout.split('\n').filter(l => l.trim()).slice(-100).map(text => ({ text }))
  },

  status: async (root, target): Promise<DeployStatus> => {
    const token = process.env.VERCEL_TOKEN
    const link = readLink(root)
    if (!token) return { domains: [], note: 'Connect Vercel with VERCEL_TOKEN to read live status.' }
    if (!link.projectId) return { domains: [], note: 'This project is not linked — run `vercel link` (it writes .vercel/project.json) so status knows which project to read.' }
    const team = link.orgId ? `&teamId=${encodeURIComponent(link.orgId)}` : ''
    const r = await httpJson(`${API}/v6/deployments?projectId=${encodeURIComponent(link.projectId)}&limit=1${team}`, { headers: { Authorization: `Bearer ${token}` } })
    if (r.status !== 200) return { domains: [], note: `Vercel API answered ${r.status}.` }
    const dep = (r.json as { deployments?: { url?: string, created?: number, state?: string }[] } | null)?.deployments?.[0]
    if (!dep) return { domains: [], note: 'No deployments yet for this project.' }
    const url = dep.url ? `https://${dep.url}` : undefined
    return {
      ...(url ? { url } : {}),
      ...(dep.created ? { lastDeployAt: new Date(dep.created).toISOString() } : {}),
      ...(dep.state ? { state: dep.state } : {}),
      domains: dep.url ? [dep.url] : [],
    }
  },
}
