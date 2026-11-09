import { MCPClient } from '@mastra/mcp'
import type { McpServer } from './mcpStore.js'
import { buildMcpServerDefinition } from './mcpClient.js'

/**
 * Interactive OAuth sign-in flows (slice 8), one per server.
 * MCPClient.authenticate() does the heavy lifting: it starts
 * the library's loopback callback server, runs discovery,
 * delivers the authorization URL through the provider's
 * redirect callback, waits for the browser to come back with
 * the code, exchanges it (PKCE) and stores the tokens through
 * the provider's storage (mcpOAuth.ts). This module only
 * conducts: it captures the URL so the API can hand it to the
 * manager, keeps the pending flow, and reports settlement.
 */

type SettleHandler = (serverId: string, ok: boolean, error?: string) => void
const settleHandlers = new Set<SettleHandler>()

/** Subscribe to sign-in completions (the API layer refreshes
 * the server's test state when one lands). */
export function onMcpSignInSettled(fn: SettleHandler): void {
  settleHandlers.add(fn)
}

interface PendingFlow {
  client: MCPClient
  authUrl: string | null
  urlWaiters: ((url: string) => void)[]
}

const pending = new Map<string, PendingFlow>()

export function mcpSignInPending(serverId: string): boolean {
  return pending.has(serverId)
}

function settle(serverId: string, ok: boolean, error?: string): void {
  const flow = pending.get(serverId)
  pending.delete(serverId)
  if (flow) void flow.client.disconnect().catch(() => { /* best-effort */ })
  for (const fn of settleHandlers) {
    try { fn(serverId, ok, error) } catch { /* a bad subscriber must not break the flow */ }
  }
}

export async function cancelMcpSignIn(serverId: string): Promise<void> {
  const flow = pending.get(serverId)
  if (!flow) return
  pending.delete(serverId)
  try { await (flow.client as { cancelAuthentication?: (n: string) => Promise<boolean> }).cancelAuthentication?.('server') } catch { /* already settled */ }
  await flow.client.disconnect().catch(() => { /* best-effort */ })
}

/**
 * Start (or restart) the sign-in flow for a server and return
 * the authorization URL the user should visit. The flow keeps
 * running in the background; settlement arrives through
 * onMcpSignInSettled (5-minute browser window, the library's
 * authenticate default).
 */
export async function startMcpSignIn(server: McpServer): Promise<{ authUrl: string }> {
  if (server.transport === 'stdio') throw new Error('Only remote (HTTP/SSE) servers sign in — local servers use their command environment.')
  await cancelMcpSignIn(server.id)
  const flow: PendingFlow = { client: null as never, authUrl: null, urlWaiters: [] }
  const definition = buildMcpServerDefinition(server, false, {
    forceOAuth: true,
    onRedirectToAuthorization: (url: URL) => {
      flow.authUrl = url.toString()
      for (const wake of flow.urlWaiters.splice(0)) wake(flow.authUrl)
    },
  })
  const client = new MCPClient({
    id: `signin-${server.id}-${Date.now().toString(36)}`,
    registerProcessHooks: false,
    servers: { server: definition },
  } as never)
  flow.client = client
  pending.set(server.id, flow)
  const done = (client as { authenticate: (n: string, o?: { timeoutMs?: number }) => Promise<void> })
    .authenticate('server', { timeoutMs: 5 * 60_000 })
  done.then(
    () => settle(server.id, true),
    (e: unknown) => settle(server.id, false, e instanceof Error ? e.message : String(e)),
  )
  const authUrl = await new Promise<string>((resolve, reject) => {
    if (flow.authUrl) return resolve(flow.authUrl)
    flow.urlWaiters.push(resolve)
    setTimeout(() => reject(new Error('The server did not produce a sign-in page — it may not support OAuth sign-in.')), 20_000)
  }).catch((e: unknown) => {
    void cancelMcpSignIn(server.id)
    throw e
  })
  return { authUrl }
}
