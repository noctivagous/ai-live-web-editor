/**
 * The ALE MCP server's transport (Muse Code design §7,
 * slice 5): streamable HTTP on the editor's own port, hosted
 * in-process by the editor, so chat sessions (surface A) and
 * headless dispatches (surface C) share one server and the
 * tools act on the editor's current project — the host
 * dispatches they wrap key off the editor's fs root.
 *
 * Why HTTP over stdio (the decision §7 left to what works):
 * the session config admits both (SessionMcpServerConfig), but
 * a stdio server would be a second process proxying back into
 * the editor for every call, while the HTTP shape serves the
 * tools from the process that already owns the page bridge,
 * the graph stores and the gate. The spike proved the
 * registration route (per-session `mcpServers` config); this
 * slice's live drive proves the HTTP transport against the
 * real host.
 *
 * The protocol surface is deliberately small — initialize,
 * ping, tools/list, tools/call, notifications — stateless per
 * request, JSON responses (the streamable-HTTP shape a client
 * that posts JSON-RPC and accepts JSON needs). No sessions of
 * our own: Muse Code's session owns the conversation; a tool
 * call is a function of the editor's current state.
 *
 * Trust lesson, mechanised: the module RECORDS what the host
 * actually did (initialize / tools/list / tools/call counts).
 * After a session starts, the chat pipe asserts the ale_ tools
 * were really listed — a session whose workspace trust was
 * missing never connects at all, and the model's own report
 * that tools are missing (or present) is never trusted (§15
 * spike item 2).
 */
import type { Express } from 'express'
import { musecodeHostSlots, setMusecodeHostSlots } from '../musecode/chat.js'
import type { MusecodeMcpServers } from '../musecode/supervisor.js'
import { ALE_TOOLS, callAleTool } from './registry.js'

export const ALE_MCP_SERVER_NAME = 'ale'
export const ALE_MCP_PATH = '/api/mcp/ale'
const MCP_PROTOCOL_FALLBACK = '2025-03-26'

/** The editor's own port, the same resolution server.ts uses. */
export function aleEditorPort(): number {
  return Number(process.env.LAUNCHER_PORT) || 4112
}

export function aleMcpUrl(): string {
  return `http://127.0.0.1:${aleEditorPort()}${ALE_MCP_PATH}`
}

/** The session/start config entry for the ALE server (spike
 * item 2's route): registered per session by the supervisor,
 * never through settings files. */
export function aleMcpSessionConfig(): MusecodeMcpServers {
  return {
    [ALE_MCP_SERVER_NAME]: { transport: 'streamableHttp', url: aleMcpUrl() },
  } as MusecodeMcpServers
}

/* ------------------------------------------------------------------ */
/* Connection record — the assertion surface                           */
/* ------------------------------------------------------------------ */

export interface AleMcpState {
  initializeCount: number
  toolsListCount: number
  toolsCallCount: number
  lastInitializeAt: string | null
  lastToolsListAt: string | null
  calledTools: string[]
}

const state: AleMcpState = {
  initializeCount: 0,
  toolsListCount: 0,
  toolsCallCount: 0,
  lastInitializeAt: null,
  lastToolsListAt: null,
  calledTools: [],
}

export function aleMcpState(): AleMcpState {
  return { ...state, calledTools: [...state.calledTools] }
}

/** Test hook: forget the connection record. */
export function resetAleMcpState(): void {
  state.initializeCount = 0
  state.toolsListCount = 0
  state.toolsCallCount = 0
  state.lastInitializeAt = null
  state.lastToolsListAt = null
  state.calledTools = []
}

/**
 * Assert the ALE tools are really present in a session that
 * just started: the host must have listed them (tools/list)
 * after `sinceListCount`. Resolves true the moment a fresh
 * listing lands, false when the window closes — the caller
 * surfaces false plainly instead of believing the model.
 */
export async function waitForAleToolsListed(sinceListCount: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs)
  for (;;) {
    if (state.toolsListCount > sinceListCount) return true
    if (Date.now() >= deadline) return state.toolsListCount > sinceListCount
    await new Promise((r) => setTimeout(r, 200))
  }
}

/* ------------------------------------------------------------------ */
/* JSON-RPC core (pure but for the tool calls themselves)              */
/* ------------------------------------------------------------------ */

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, any>
}

function rpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

async function handleOne(req: JsonRpcRequest): Promise<{ status: number; body?: unknown }> {
  const isNotification = req.id === undefined || req.id === null
  const id = (req.id ?? null) as string | number | null
  switch (req.method) {
    case 'initialize': {
      state.initializeCount += 1
      state.lastInitializeAt = new Date().toISOString()
      const requested = typeof req.params?.protocolVersion === 'string' ? req.params.protocolVersion : MCP_PROTOCOL_FALLBACK
      return {
        status: 200,
        body: rpcResult(id, {
          protocolVersion: requested,
          capabilities: { tools: {} },
          serverInfo: { name: ALE_MCP_SERVER_NAME, version: '1.0.0' },
        }),
      }
    }
    case 'ping':
      return { status: 200, body: rpcResult(id, {}) }
    case 'tools/list': {
      state.toolsListCount += 1
      state.lastToolsListAt = new Date().toISOString()
      return {
        status: 200,
        body: rpcResult(id, {
          tools: ALE_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        }),
      }
    }
    case 'tools/call': {
      const name = typeof req.params?.name === 'string' ? req.params.name : ''
      const args = (req.params?.arguments && typeof req.params.arguments === 'object' ? req.params.arguments : {}) as Record<string, any>
      state.toolsCallCount += 1
      if (name) state.calledTools.push(name)
      const { result, isError } = await callAleTool(name, args)
      return {
        status: 200,
        body: rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(result ?? null) }],
          isError,
        }),
      }
    }
    default:
      if (isNotification) return { status: 202 }
      return { status: 200, body: rpcError(id, -32601, `method not found: ${req.method ?? '(none)'}`) }
  }
}

/** Handle one HTTP body: a single JSON-RPC message or a batch.
 * Notifications answer 202 with no body; everything else 200
 * with the JSON-RPC response. */
export async function handleAleMcpBody(body: unknown): Promise<{ status: number; body?: unknown }> {
  if (Array.isArray(body)) {
    const out: unknown[] = []
    let anyResponse = false
    for (const item of body) {
      const r = await handleOne((item ?? {}) as JsonRpcRequest)
      if (r.body !== undefined) { out.push(r.body); anyResponse = true }
    }
    return anyResponse ? { status: 200, body: out } : { status: 202 }
  }
  if (!body || typeof body !== 'object') {
    return { status: 200, body: rpcError(null, -32600, 'invalid request: a JSON-RPC object was expected') }
  }
  return handleOne(body as JsonRpcRequest)
}

/* ------------------------------------------------------------------ */
/* Express mount + supervisor slot registration                        */
/* ------------------------------------------------------------------ */

/**
 * Mount the MCP endpoint and register the server into the
 * Muse Code session slots (filling the supervisor's slice-4
 * mcpServers slot). Mounted on both servers like every project
 * API (server.ts + apiApp.ts). The GET answer is 405: this
 * server keeps no server-initiated stream.
 */
export function mountAleMcpApi(app: Express): void {
  setMusecodeHostSlots({ ...musecodeHostSlots(), mcpServers: aleMcpSessionConfig() })
  app.post(ALE_MCP_PATH, async (req, res) => {
    try {
      const { status, body } = await handleAleMcpBody(req.body)
      if (body === undefined) return res.status(status).end()
      return res.status(status).json(body)
    } catch (e: any) {
      return res.status(200).json(rpcError(null, -32603, e?.message || String(e)))
    }
  })
  app.get(ALE_MCP_PATH, (_req, res) => {
    res.status(405).json({ ok: false, error: 'The ALE MCP server is POST-only (streamable HTTP, stateless).' })
  })
}
