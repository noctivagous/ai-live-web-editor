import fs from 'node:fs'
import path from 'node:path'
import { getCallbackUrlCandidates, MCPOAuthClientProvider, type OAuthStorage } from '@mastra/mcp'
import { mcpConfigPath, type McpServer } from './mcpStore.js'

/**
 * OAuth sign-in for remote MCP servers, through the client
 * library's own provider (slice 8). The provider handles the
 * OAuth 2.1 authorization-code flow — discovery, PKCE, token
 * exchange and refresh — with two deliberate library stances
 * the design inherits: client identity is CONFIGURED, never
 * dynamically registered (a pre-registered client id, or a
 * Client ID Metadata Document URL the authorization server
 * fetches), and the redirect target is a loopback URL served
 * by the library's one-shot callback server during
 * MCPClient.authenticate().
 *
 * Persistence: the provider talks to an OAuthStorage of string
 * keys (tokens keyed by issuer, discovery state, PKCE
 * verifiers — all opaque to us). Ours is a JSON file beside
 * mcp.json, namespaced per server id. Tokens are secrets:
 * this file never goes through the masked state endpoint;
 * the API only ever reports THAT tokens exist.
 */

type OAuthFile = { version: 1, servers: Record<string, Record<string, string>> }

export function mcpOAuthPath(): string {
  if (process.env.AI_LIVE_MCP_OAUTH_PATH) return process.env.AI_LIVE_MCP_OAUTH_PATH
  return path.join(path.dirname(mcpConfigPath()), 'mcp-oauth.json')
}

function loadOAuthFile(): OAuthFile {
  try {
    const raw = JSON.parse(fs.readFileSync(mcpOAuthPath(), 'utf8')) as Partial<OAuthFile>
    if (raw && typeof raw === 'object' && raw.servers && typeof raw.servers === 'object') {
      return { version: 1, servers: raw.servers as Record<string, Record<string, string>> }
    }
  } catch { /* missing or corrupt: start empty */ }
  return { version: 1, servers: {} }
}

function saveOAuthFile(file: OAuthFile): void {
  const target = mcpOAuthPath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = `${target}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2))
  fs.renameSync(tmp, target)
}

/** The provider's storage for one server id. */
export function oauthStorageFor(serverId: string): OAuthStorage {
  return {
    get(key: string) {
      return loadOAuthFile().servers[serverId]?.[key]
    },
    set(key: string, value: string) {
      const file = loadOAuthFile()
      ;(file.servers[serverId] ??= {})[key] = value
      saveOAuthFile(file)
    },
    delete(key: string) {
      const file = loadOAuthFile()
      if (file.servers[serverId]) {
        delete file.servers[serverId][key]
        saveOAuthFile(file)
      }
    },
  }
}

function valueHasAccessToken(raw: string): boolean {
  if (raw.includes('"access_token"')) {
    try {
      const walk = (v: unknown, depth: number): boolean => {
        if (!v || typeof v !== 'object' || depth > 4) return false
        for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
          if (k === 'access_token' && typeof x === 'string' && x) return true
          if (walk(x, depth + 1)) return true
        }
        return false
      }
      if (walk(JSON.parse(raw), 0)) return true
    } catch { /* fall through to the substring verdict */ }
    return true
  }
  return false
}

/** True when the server has a stored access token (signed in).
 * Reports existence only — token values never leave this file. */
export function hasOAuthTokens(serverId: string): boolean {
  const record = loadOAuthFile().servers[serverId]
  if (!record) return false
  return Object.values(record).some(valueHasAccessToken)
}

/** Forget everything stored for a server (sign out). */
export function clearOAuthData(serverId: string): void {
  const file = loadOAuthFile()
  if (file.servers[serverId]) {
    delete file.servers[serverId]
    saveOAuthFile(file)
  }
}

/** The loopback redirect the library's callback server serves
 * during sign-in (falling back to sequential ports when busy;
 * all candidates are registered in the client metadata). */
export const MCP_OAUTH_REDIRECT_URL = 'http://127.0.0.1:5533/oauth/callback'

/** Client id used when a server entry carries none. Public
 * clients have no secret; an authorization server must have
 * this id pre-registered (or accept public clients) for the
 * default to work — a per-server id or metadata URL overrides. */
export const MCP_OAUTH_DEFAULT_CLIENT_ID = 'ale-mcp-client'

type OAuthIdentity = Pick<McpServer, 'id' | 'oauthClientId' | 'oauthClientMetadataUrl'>

/**
 * Build the library provider for one server. Connect-time
 * callers pass no redirect handler (a connect that hits a 401
 * simply fails as needs-auth in the library's bookkeeping);
 * the sign-in flow passes its capture.
 */
export function createMcpOAuthProvider(
  server: OAuthIdentity,
  opts?: { onRedirectToAuthorization?: (url: URL) => void },
): MCPOAuthClientProvider {
  const base = {
    redirectUrl: MCP_OAUTH_REDIRECT_URL,
    clientMetadata: {
      redirect_uris: getCallbackUrlCandidates(MCP_OAUTH_REDIRECT_URL).map(u => u.toString()),
      client_name: 'ALE — AI Live Editor',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    storage: oauthStorageFor(server.id),
    ...(opts?.onRedirectToAuthorization ? { onRedirectToAuthorization: opts.onRedirectToAuthorization } : {}),
  }
  return server.oauthClientMetadataUrl
    ? new MCPOAuthClientProvider({ ...base, clientMetadataUrl: server.oauthClientMetadataUrl })
    : new MCPOAuthClientProvider({
        ...base,
        clientInformation: { client_id: server.oauthClientId || MCP_OAUTH_DEFAULT_CLIENT_ID },
      })
}
