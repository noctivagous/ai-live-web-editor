/**
 * OpenCode sidecar configuration (re-platform slice 1).
 *
 * The launcher spawns a pinned OpenCode v2 server per project and
 * hands it a generated config, kept in editor-owned state
 * (.ai-live/opencode/, via XDG_CONFIG_HOME) — never inside the
 * user's project. This module is the pure half: turning the active
 * ALE connection into that config. The API key is referenced by
 * environment-variable NAME only; the value travels in the child
 * process env (see supervisor.ts), never in the config file.
 *
 * Slice-1 scope: only OpenAI-compatible presets map (Meta is the
 * archetype). Any other preset is a clear, named refusal — the
 * caller surfaces it as the turn's error rather than guessing.
 *
 * Verified against OpenCode v2.2.6 primary sources (2026-11-09):
 * config shape per https://opencode.ai/docs/providers/ and the
 * shipped @opencode/client + @opencode/plugin packages.
 *
 * Slice 8 completes the generated config: an `mcp` section
 * derived from ALE's MCP store (mcp/mcpStore.ts), the `skills`
 * registration for ALE's skills directory, and the top-level
 * `permissions` — the deliberate headless policy plus the deny
 * rules that carry ALE's per-tool MCP toggles and per-skill
 * panel toggles into the engine. All pure functions over store
 * shapes; the supervisor feeds them the live stores.
 */
import type { McpConfig, McpServer } from '../mcp/mcpStore.js'
import type { PermissionRule } from './agents.js'

export const OPENCODE_VERSION = '2.2.6'

/** The runtime package for OpenAI-compatible providers in v2. */
export const OPENAI_COMPATIBLE_PACKAGE = '@opencode/ai/providers/openai-compatible'

export interface OpencodeConnectionInput {
  id: string
  name: string
  model: string
  baseUrl: string
  /** The ALE preset's provider kind (providerPresets' providerId). */
  presetProviderId: string | null
}

export interface OpencodeMapping {
  providerID: string
  modelID: string
  /** Env var the generated config names; the supervisor sets its
   * value (the connection's key) in the child env. */
  keyEnvName: string
  config: Record<string, unknown>
}

export type OpencodeMappingResult =
  | { ok: true; mapping: OpencodeMapping }
  | { ok: false; error: string }

/** The env name ALE already keeps this connection's key under
 * (.env via connections.ts) — same transform, so the generated
 * config can name it directly. */
export function connectionKeyEnvName(connectionId: string): string {
  return `CONN_KEY_${connectionId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
}

/** OpenCode provider ids are lowercase slugs. Prefix keeps ALE's
 * generated providers distinct from any catalog provider id. */
export function opencodeProviderId(connectionId: string): string {
  const slug = connectionId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `ale-${slug || 'connection'}`
}

export function opencodeMappingFor(
  conn: OpencodeConnectionInput,
  opts: { pluginDir: string; hostUrl: string },
): OpencodeMappingResult {
  if (conn.presetProviderId !== 'openai-compatible') {
    return {
      ok: false,
      error: `The OpenCode engine cannot use the active connection "${conn.name}" yet: ` +
        `its preset kind is "${conn.presetProviderId ?? 'unknown'}", and slice 1 maps only ` +
        `OpenAI-compatible connections. Switch the chat engine back to Mastra in agent settings, ` +
        `or activate an OpenAI-compatible connection.`,
    }
  }
  if (!conn.model || !conn.baseUrl) {
    return {
      ok: false,
      error: `The active connection "${conn.name}" has no ${!conn.model ? 'model' : 'base URL'} configured, ` +
        `so the OpenCode engine cannot start. Complete the connection in Settings, or switch the chat engine back to Mastra.`,
    }
  }
  const providerID = opencodeProviderId(conn.id)
  const modelID = conn.model
  const keyEnvName = connectionKeyEnvName(conn.id)
  const config: Record<string, unknown> = {
    $schema: 'https://opencode.ai/config.json',
    model: `${providerID}/${modelID}`,
    providers: {
      [providerID]: {
        name: conn.name,
        env: [keyEnvName],
        package: OPENAI_COMPATIBLE_PACKAGE,
        settings: { baseURL: conn.baseUrl },
        models: { [modelID]: { name: modelID } },
      },
    },
    plugins: [{ package: opts.pluginDir, options: { hostUrl: opts.hostUrl } }],
  }
  return { ok: true, mapping: { providerID, modelID, keyEnvName, config } }
}

/* ------------------------------------------------------------------ */
/* Slice 8: MCP section, skills registration, headless permissions     */
/* ------------------------------------------------------------------ */

/**
 * The deliberate headless permission policy for the generated
 * config (slice 7's flagged residual). ALE drives OpenCode
 * through its API with no client able to answer a permission
 * request, and OpenCode's own base policy resolves two reads to
 * `ask` (reading *.env / *.env.*) — an ask nobody answers is a
 * stalled turn. These rules are appended after the base policy
 * (global rules follow it; the last matching rule wins):
 *
 *   - everything is allowed outright: no `ask` survives this
 *     layer, so a headless turn can never stall on a prompt;
 *   - EXCEPT reading .env-class files, which stays DENIED (not
 *     ask): secrets are not the agent's to read on either engine,
 *     and a deny answers immediately instead of stalling;
 *   - *.env.example stays readable (templates, not secrets) —
 *     its allow must follow the *.env.* deny, because the deny's
 *     pattern matches it too.
 *
 * On top of these, opencodeMcpFor / opencodeSkillDenyRules add
 * deny rules for ALE state the engine must honor (per-tool MCP
 * toggles and holds, panel-disabled skills); they are appended
 * after the catch-all allow so they win their matches.
 */
export const OPENCODE_HEADLESS_PERMISSIONS: PermissionRule[] = [
  { action: '*', resource: '*', effect: 'allow' },
  { action: 'read', resource: '*.env', effect: 'deny' },
  { action: 'read', resource: '*.env.*', effect: 'deny' },
  { action: 'read', resource: '*.env.example', effect: 'allow' },
]

/** The generated config's top-level permissions: the headless
 * policy plus the state deny rules, in evaluation order. */
export function opencodePermissionsFor(extraDenyRules: PermissionRule[]): PermissionRule[] {
  return [...OPENCODE_HEADLESS_PERMISSIONS, ...extraDenyRules]
}

/** The `skills` array for the generated config: ALE's skills
 * directory as an absolute path. v2 treats each entry as an
 * additional skill source root and discovers `<name>/SKILL.md`
 * under it (verified against the v2 skills docs + the 2.2.6
 * schema: `skills` is a string array of local dirs / catalog
 * URLs) — exactly ALE's on-disk layout (skills/skills.ts
 * SKILLS_DIR), so the native skill tool sees the same set
 * read-skill reads. No copying, no symlinks. */
export function opencodeSkillsFor(skillsDir: string): string[] {
  return [skillsDir]
}

/** Deny rules for the skills the user switched off in the Skills
 * panel: a `skill` deny hides the skill from the model's list
 * and rejects loading it, so the native skill tool's visible set
 * matches ALE's active set (activeSkills()). Ids are OpenCode's
 * path-derived ids — the SKILL.md directory names. */
export function opencodeSkillDenyRules(disabledSkillIds: string[]): PermissionRule[] {
  return [...new Set(disabledSkillIds)].sort().map((id) => ({ action: 'skill', resource: id, effect: 'deny' as const }))
}

/** MCP action names are `<server>_<tool>` with unsupported
 * characters in both names replaced by `_` (v2 permissions doc). */
function mcpActionPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, '_')
}

/** The config record key for one ALE MCP server: its display
 * name (what the user sees in the manager is what the engine
 * names its tools after), made unique with a numeric suffix —
 * server names in ALE's store are free text and may repeat. */
export function opencodeMcpServerKey(name: string, used: ReadonlySet<string>): string {
  const base = name.trim() || 'server'
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

function mcpProtocolFor(server: McpServer): string | undefined {
  if (server.protocolVersion === '2026') return '2026-07-28'
  if (server.protocolVersion === 'auto') return 'auto'
  if (server.protocolVersion === 'legacy') return 'legacy'
  return undefined
}

export interface OpencodeMcpResult {
  /** The generated config's `mcp` value; undefined when the
   * store holds no servers at all (the key stays out). */
  mcp?: { servers: Record<string, Record<string, unknown>> }
  /** Deny rules carrying the store's per-tool state into the
   * engine: a tool switched off in the manager, and a tool held
   * for review (needsReview), is denied by action name. */
  toolDenyRules: PermissionRule[]
}

/**
 * ALE's MCP store → the generated config's `mcp` section.
 * Mapping (store → v2 schema, verified against the installed
 * @opencode/schema 2.2.6 Mcp.LocalConfig / Mcp.RemoteConfig):
 *
 *   transport 'stdio'  → { type: 'local', command: [command,
 *     ...args], environment: env }
 *   transport 'http' | 'sse' → { type: 'remote', url, headers }
 *     — v2 has ONE remote type; ALE's http/sse distinction does
 *     not exist in its schema (the v2 client negotiates).
 *   enabled + settings.chatToolsEnabled (the master switch)
 *     → `disabled: true` when either is off. Servers stay listed
 *     either way, so the generated config shows the full store.
 *   protocolVersion    → protocol ('2026' is spelled
 *     '2026-07-28' in v2's literals).
 *   oauth: true        → oauth { client_id (when the store has
 *     one), redirect_uri + callback_port (ALE's own loopback,
 *     so both engines present the same client identity) }.
 *   tools[] toggles    → permission deny rules (see above).
 *
 * What does NOT map, named rather than dropped:
 *   - the stored OAuth ACCESS/REFRESH TOKENS (.ai-live/
 *     mcp-oauth.json): v2's oauth value is client/flow config
 *     only — there is no token slot, and OpenCode keeps its own
 *     token store. A server signed in through ALE's manager is
 *     NOT signed in for OpenCode; it will report needs_auth on
 *     this engine until OpenCode's own flow runs.
 *   - oauthClientMetadataUrl (SEP-991 client metadata document):
 *     no v2 field (auth_server_metadata_url names the auth
 *     server's metadata, a different document).
 *   - the tool budget (cfg.budget): no v2 equivalent.
 *   - test bookkeeping (status, lastTestAt, toolChanges, schema
 *     hashes, origin): manager state, not engine config.
 *   - a stdio server with no command: inexpressible — skipped.
 */
export function opencodeMcpFor(
  cfg: McpConfig,
  opts: { oauthRedirectUrl: string; oauthCallbackPort: number },
): OpencodeMcpResult {
  const servers: Record<string, Record<string, unknown>> = {}
  const toolDenyRules: PermissionRule[] = []
  const used = new Set<string>()
  const masterOn = cfg.settings.chatToolsEnabled
  for (const server of cfg.servers) {
    const key = opencodeMcpServerKey(server.name, used)
    used.add(key)
    const disabled = !masterOn || !server.enabled
    const protocol = mcpProtocolFor(server)
    if (server.transport === 'stdio') {
      if (!server.command) continue
      servers[key] = {
        type: 'local',
        command: [server.command, ...(server.args ?? [])],
        ...(server.env ? { environment: server.env } : {}),
        // Direct function tools, not Code Mode (the same v2
        // default the ALE plugin opts out of in slice 1): ALE's
        // chat UI renders named MCP tool calls, and the per-tool
        // deny rules below name the tools directly.
        codemode: false,
        ...(disabled ? { disabled: true } : {}),
        ...(protocol ? { protocol } : {}),
      }
    } else {
      if (!server.url) continue
      servers[key] = {
        type: 'remote',
        url: server.url,
        codemode: false,
        ...(server.headers ? { headers: server.headers } : {}),
        ...(server.oauth === true
          ? {
              oauth: {
                ...(server.oauthClientId ? { client_id: server.oauthClientId } : {}),
                redirect_uri: opts.oauthRedirectUrl,
                callback_port: opts.oauthCallbackPort,
              },
            }
          : {}),
        ...(disabled ? { disabled: true } : {}),
        ...(protocol ? { protocol } : {}),
      }
    }
    if (!disabled) {
      for (const tool of server.tools) {
        if (tool.enabled === false || tool.needsReview === true) {
          toolDenyRules.push({
            action: `${mcpActionPart(key)}_${mcpActionPart(tool.name)}`,
            resource: '*',
            effect: 'deny',
          })
        }
      }
    }
  }
  return {
    ...(Object.keys(servers).length ? { mcp: { servers } } : {}),
    toolDenyRules,
  }
}
