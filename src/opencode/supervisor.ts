/**
 * OpenCode sidecar supervision (re-platform slice 1).
 *
 * The launcher owns one OpenCode v2 server per active project,
 * spawned lazily on the first opencode-engine turn and stopped on
 * project switch / launcher exit (the launcher's Vite supervision
 * is the model). Everything the server needs is generated into
 * editor-owned state — .ai-live/opencode/ beside the workspace —
 * and handed over through XDG_CONFIG_HOME / XDG_DATA_HOME, so
 * nothing is written into the user's project and the user's own
 * OpenCode setup (if any) is never touched.
 *
 * The server password is generated once per launcher boot, kept in
 * memory only, and passed via env. The active connection's API key
 * likewise travels only in the child env, under the name the
 * generated config references.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { currentAgentSettings } from '../agentSettings.js'
import { connectionKey, getStore } from '../connections.js'
import { loadMcpConfig } from '../mcp/mcpStore.js'
import { MCP_OAUTH_REDIRECT_URL } from '../mcp/mcpOAuth.js'
import { presetById } from '../providerPresets.js'
import { loadSkills, SKILLS_DIR } from '../skills/skills.js'
import { disabledSkillNames } from '../skills/skillSettings.js'
import { buildAleAgentsFragment } from './agents.js'
import {
  opencodeMappingFor, opencodeMcpFor, opencodePermissionsFor, opencodeSkillDenyRules,
  opencodeSkillsFor, OPENCODE_VERSION,
} from './config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
/** The editor's own repo root (src/opencode/ -> ../../). */
export const OPENCODE_EDITOR_ROOT = path.resolve(__dirname, '../..')
/** Editor-owned OpenCode state: generated config + server data. */
export const OPENCODE_STATE_DIR = path.join(OPENCODE_EDITOR_ROOT, '.ai-live', 'opencode')
/** The ALE plugin directory the generated config loads. */
export const OPENCODE_PLUGIN_DIR = path.join(__dirname, 'ale-plugin')

export interface OpencodeHandle {
  baseUrl: string
  password: string
  providerID: string
  modelID: string
  projectRoot: string
  version: string
}

interface RunningServer {
  child: ChildProcess
  handle: OpencodeHandle
  fingerprint: string
  log: string[]
}

let running: RunningServer | null = null
let bootPassword: string | null = null
let ensureInFlight: Promise<OpencodeHandle> | null = null

/** Per-boot server password: generated once, memory only. */
export function opencodeBootPassword(): string {
  if (!bootPassword) bootPassword = crypto.randomBytes(24).toString('base64url')
  return bootPassword
}

export function launcherHostUrl(): string {
  return `http://127.0.0.1:${Number(process.env.LAUNCHER_PORT) || 4112}`
}

/** Platform binary package names, most-preferred first (the same
 * set @opencode/cli's own installer chooses from). */
export function opencodeBinaryPackageNames(platform = process.platform, arch = process.arch): string[] {
  if (platform === 'linux' && arch === 'x64') {
    return ['cli-linux-x64', 'cli-linux-x64-baseline', 'cli-linux-x64-musl', 'cli-linux-x64-baseline-musl']
  }
  if (platform === 'linux' && arch === 'arm64') return ['cli-linux-arm64', 'cli-linux-arm64-musl']
  if (platform === 'darwin' && arch === 'arm64') return ['cli-darwin-arm64']
  if (platform === 'darwin' && arch === 'x64') return ['cli-darwin-x64']
  if (platform === 'win32') return ['cli-win32-x64']
  return []
}

/** Resolve the opencode binary: explicit override, then the pinned
 * v2 platform package in the editor's node_modules, then PATH.
 * The PATH fallback is `opencode2`, never `opencode`: a v1 install
 * owns the `opencode` name and refuses the generated V2 `permissions`
 * config at startup, while v2 ships the side-by-side `opencode2`
 * name for the same binary. */
export function resolveOpencodeBinary(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = fs.existsSync,
): string {
  const override = env.OPENCODE_BIN?.trim()
  if (override) return override
  const exe = process.platform === 'win32' ? 'opencode.exe' : 'opencode'
  for (const pkg of opencodeBinaryPackageNames()) {
    const candidate = path.join(OPENCODE_EDITOR_ROOT, 'node_modules', '@opencode', pkg, 'bin', exe)
    if (exists(candidate)) return candidate
  }
  return process.platform === 'win32' ? 'opencode2.exe' : 'opencode2'
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = addr && typeof addr === 'object' ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

function authHeader(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
}

async function waitHealthy(baseUrl: string, password: string, child: ChildProcess, log: string[]): Promise<void> {
  const deadline = Date.now() + 30_000
  let exited = false
  child.once('exit', () => { exited = true })
  while (Date.now() < deadline) {
    if (exited) throw new Error(`the OpenCode server exited during startup. Last log lines:\n${log.slice(-8).join('\n')}`)
    try {
      const r = await fetch(`${baseUrl}/api/info`, { headers: { Authorization: authHeader(password) } })
      if (r.ok) return
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('the OpenCode server did not become healthy within 30s')
}

/** Stop the running server, if any. Called on project switch and
 * on launcher exit (wired in launcher.ts next to stopVite). */
export function stopOpencodeServer(): void {
  const cur = running
  running = null
  if (cur) {
    try { cur.child.kill('SIGTERM') } catch { /* already gone */ }
    const child = cur.child
    setTimeout(() => { try { child.kill('SIGKILL') } catch { /* gone */ } }, 3_000).unref?.()
  }
}

export function opencodeServerStatus(): { running: boolean; projectRoot?: string; baseUrl?: string } {
  return running
    ? { running: true, projectRoot: running.handle.projectRoot, baseUrl: running.handle.baseUrl }
    : { running: false }
}

/** Recent server output, for error surfaces. Never contains the
 * password or key: both travel by env, and the server does not
 * print its env. */
export function opencodeServerLog(): string[] {
  return running ? [...running.log] : []
}

/**
 * Ensure a server is running for `projectRoot` with the CURRENT
 * active connection. Respawns when the project or the connection
 * fingerprint changed since the running server was started.
 * Throws an Error whose message is fit to show the user (notably
 * the slice-1 mapping refusals from config.ts).
 */
export async function ensureOpencodeServer(projectRoot: string): Promise<OpencodeHandle> {
  if (ensureInFlight) return ensureInFlight
  ensureInFlight = ensureOpencodeServerInner(projectRoot).finally(() => { ensureInFlight = null })
  return ensureInFlight
}

async function ensureOpencodeServerInner(projectRoot: string): Promise<OpencodeHandle> {
  const store = getStore()
  const active = store.connections.find((c) => c.id === store.activeId)
  if (!active) {
    throw new Error('The OpenCode engine needs an active provider connection, and none is set. ' +
      'Add or activate a connection in Settings, or switch the chat engine back to Mastra in agent settings.')
  }
  const preset = presetById(active.presetId)
  const result = opencodeMappingFor(
    {
      id: active.id, name: active.name, model: active.model, baseUrl: active.baseUrl,
      presetProviderId: preset?.providerId ?? null,
    },
    { pluginDir: OPENCODE_PLUGIN_DIR, hostUrl: launcherHostUrl() },
  )
  if (result.ok === false) throw new Error(result.error)
  const { mapping } = result
  // ALE's own agents (slice 7): the ale-files / ale-sketch
  // definitions derived from BASE_INSTRUCTIONS + agentTools (see
  // opencode/agents.ts) join the generated config. Their content
  // hash rides the fingerprint — the instructions embed the skill
  // index, so toggling a skill in the panel respawns the sidecar
  // with fresh agent text, the analogue of the Mastra agent
  // resolving its instructions per call.
  const agentsFragment = await buildAleAgentsFragment()
  mapping.config.agents = agentsFragment.agents
  mapping.config.default_agent = agentsFragment.default_agent
  // Slice 8 — the generated config's remaining sections, all
  // derived from ALE's own stores at spawn time:
  //   mcp: the MCP manager's store (the manager stays the only
  //     editor; OpenCode's client replaces ALE's for chat on this
  //     engine). OAuth servers get ALE's loopback redirect so
  //     both engines present the same client identity; the stored
  //     tokens themselves have no config slot (see config.ts).
  //   skills: ALE's skills directory registered as a source root,
  //     so the native skill tool discovers the same SKILL.md set.
  //   permissions: the headless policy (no ask can stall a turn;
  //     .env reads denied) + deny rules for switched-off MCP
  //     tools and panel-disabled skills.
  // A hash of all three joins the fingerprint: editing the MCP
  // store or the skills panel respawns the sidecar, like a
  // connection switch does.
  const mcpResult = opencodeMcpFor(loadMcpConfig(), {
    oauthRedirectUrl: MCP_OAUTH_REDIRECT_URL,
    oauthCallbackPort: Number(new URL(MCP_OAUTH_REDIRECT_URL).port) || 5533,
  })
  if (mcpResult.mcp) mapping.config.mcp = mcpResult.mcp
  mapping.config.skills = opencodeSkillsFor(SKILLS_DIR)
  const disabledHere = disabledSkillNames()
  const disabledSkillIds = loadSkills()
    .filter((s) => disabledHere.has(s.name))
    .map((s) => path.basename(s.dir))
  mapping.config.permissions = opencodePermissionsFor([
    ...mcpResult.toolDenyRules,
    ...opencodeSkillDenyRules(disabledSkillIds),
  ])
  const extrasHash = crypto.createHash('sha256')
    .update(JSON.stringify({ mcp: mapping.config.mcp ?? null, skills: mapping.config.skills, permissions: mapping.config.permissions }))
    .digest('hex')
    .slice(0, 16)
  // The ALE tool-override toggles (agent settings, default off)
  // ride the spawn env the plugin reads at registration time, so
  // they are part of the fingerprint: flipping one respawns the
  // sidecar with the new tool set.
  const settings = currentAgentSettings()
  const aleFsTools = settings.aleFsTools === true
  const aleWebTools = settings.aleWebTools === true
  const aleSkillTools = settings.aleSkillTools === true
  const fingerprint = [
    projectRoot, active.id, active.model, active.baseUrl, active.updatedAt,
    aleFsTools ? 'alefs' : 'nativefs',
    aleWebTools ? 'aleweb' : 'nativeweb',
    aleSkillTools ? 'aleskill' : 'nativeskill',
    `agents:${agentsFragment.hash}`, `extras:${extrasHash}`,
  ].join('|')
  if (running && running.fingerprint === fingerprint) return running.handle

  stopOpencodeServer()

  // Generated config + state dirs (editor-owned; rewritten per spawn).
  const configHome = path.join(OPENCODE_STATE_DIR, 'config')
  const dataHome = path.join(OPENCODE_STATE_DIR, 'data')
  const configDir = path.join(configHome, 'opencode')
  fs.mkdirSync(configDir, { recursive: true })
  fs.mkdirSync(dataHome, { recursive: true })
  fs.writeFileSync(path.join(configDir, 'opencode.jsonc'), JSON.stringify(mapping.config, null, 2) + '\n', 'utf8')

  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const password = opencodeBootPassword()
  const key = connectionKey(active)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENCODE_SERVER_PASSWORD: password,
    XDG_CONFIG_HOME: configHome,
    XDG_DATA_HOME: dataHome,
    // Explicitly set either way: the plugin registers each ALE
    // override group only on '1', and a stray inherited value
    // must not leak an override into a default spawn.
    ALE_OPENCODE_FS_TOOLS: aleFsTools ? '1' : '0',
    ALE_OPENCODE_WEB_TOOLS: aleWebTools ? '1' : '0',
    ALE_OPENCODE_SKILL_TOOLS: aleSkillTools ? '1' : '0',
    ...(key ? { [mapping.keyEnvName]: key } : {}),
  }
  const binary = resolveOpencodeBinary()
  const log: string[] = []
  const child = spawn(binary, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
    cwd: projectRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const capture = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim()) log.push(line)
    }
    if (log.length > 200) log.splice(0, log.length - 200)
  }
  child.stdout?.on('data', capture)
  child.stderr?.on('data', capture)
  const handle: OpencodeHandle = {
    baseUrl, password, providerID: mapping.providerID, modelID: mapping.modelID,
    projectRoot, version: OPENCODE_VERSION,
  }
  const entry: RunningServer = { child, handle, fingerprint, log }
  running = entry
  child.on('exit', (code, signal) => {
    if (running === entry) running = null
    console.log('[opencode] server exit', code ?? '', signal ?? '')
  })
  try {
    await waitHealthy(baseUrl, password, child, log)
  } catch (e) {
    if (running === entry) running = null
    try { child.kill('SIGKILL') } catch { /* gone */ }
    throw e
  }
  console.log(`[opencode] v${OPENCODE_VERSION} serving ${projectRoot} at ${baseUrl} (provider ${mapping.providerID}/${mapping.modelID})`)
  return handle
}
