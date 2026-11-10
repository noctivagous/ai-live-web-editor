import { randomUUID } from 'node:crypto'
import type { Request, Response, Express } from 'express'

export type PageOp = 'inspect' | 'patch' | 'eval' | 'layout-snapshot' | 'snapshot' | 'console'

type Client = {
  id: string
  top: boolean
  /** Check-frame marker (e.g. width "375"): excluded from normal dispatch. */
  check?: string
  send: (cmd: object) => void
}

type Pending = {
  results: unknown[]
  expected: number
  settle: ReturnType<typeof setTimeout> | null
  timer: ReturnType<typeof setTimeout>
  resolve: (value: unknown) => void
  finished: boolean
  /** When set, resolve with the raw results array instead of the preferred pick. */
  collect?: boolean
}

const clients = new Map<string, Client>()
const pending = new Map<string, Pending>()
let pageOwner = false

const VITE_ORIGIN = process.env.VITE_ORIGIN || 'http://localhost:5173'
const SETTLE_MS = 250

export function markPageOwner() {
  pageOwner = true
}

export function livePageCount() {
  return clients.size
}

/**
 * True when bridge clients can register with THIS process: it either
 * serves the edited page itself (page owner — the plugin or an
 * in-process Vite loaded it) or a page client has already connected
 * here. In the standard two-process topology the editor process has
 * neither: page clients register with the project's own server and
 * pageCommand reaches the page only via the HTTP fallback — so
 * anything that waits for a client to appear in this registry (check
 * frames) would wait forever.
 */
export function canRegisterLocalClients(): boolean {
  return pageOwner || clients.size > 0
}

/** Normal-dispatch clients: hidden check frames are addressed directly, never here. */
function dispatchClients(): Client[] {
  return [...clients.values()].filter((c) => !c.check)
}

/** Prefer the Preview iframe (frame=iframe) so sketch undo restores what the user sees. */
export function pickPageResult(results: unknown[]): unknown {
  const list = results
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
    .filter((r) => !String(r.check || ''))
  if (!list.length) return { error: 'No live Vite page responded' }
  const okish = (r: Record<string, unknown>) => r.ok !== false && !r.error
  const iframe = list.find((r) => okish(r) && r.frame === 'iframe')
  if (iframe) return iframe
  const ok = list.find(okish)
  if (ok) return ok
  return list[0]
}

function finishPending(id: string, fallback?: unknown) {
  const slot = pending.get(id)
  if (!slot || slot.finished) return
  slot.finished = true
  clearTimeout(slot.timer)
  if (slot.settle) clearTimeout(slot.settle)
  pending.delete(id)
  if (slot.collect) {
    slot.resolve(slot.results.length ? [...slot.results] : (fallback ?? []))
    return
  }
  if (slot.results.length) slot.resolve(pickPageResult(slot.results))
  else slot.resolve(fallback ?? { error: 'No live Vite page responded' })
}

function dispatch(op: PageOp, payload: Record<string, unknown>, timeoutMs: number, only?: Client[]) {
  const targets = (only || dispatchClients()).sort((a, b) => Number(a.top) - Number(b.top))
  if (!targets.length) {
    return Promise.resolve({ error: 'No live Vite page connected. Open the app on :5173.' })
  }
  const id = randomUUID()
  return new Promise((resolve) => {
    pending.set(id, {
      results: [],
      expected: targets.length,
      settle: null,
      finished: false,
      resolve,
      timer: setTimeout(() => {
        finishPending(id, { error: `Live page ${op} timed out after ${timeoutMs}ms` })
      }, timeoutMs),
    })
    const cmd = { id, op, payload }
    for (const c of targets) c.send(cmd)
  })
}

/**
 * Fan-out without collapsing: resolves with every responding client's body
 * (used by the verify gate to collect per-width snapshots). Check frames
 * included only when `includeCheck` is set.
 */
export async function pageCommandAll(
  op: PageOp,
  payload: Record<string, unknown> = {},
  timeoutMs = 8000,
  includeCheck = false,
): Promise<unknown[]> {
  const targets = [...clients.values()].filter((c) => includeCheck || !c.check)
  if (!targets.length) return [{ error: 'No live Vite page connected. Open the app on :5173.' }]
  const id = randomUUID()
  const out = await new Promise<unknown>((resolve) => {
    pending.set(id, {
      results: [],
      expected: targets.length,
      settle: null,
      finished: false,
      resolve,
      collect: true,
      timer: setTimeout(() => {
        finishPending(id, [{ error: `Live page ${op} timed out after ${timeoutMs}ms` }])
      }, timeoutMs),
    })
    const cmd = { id, op, payload }
    for (const c of targets) c.send(cmd)
  })
  return Array.isArray(out) ? out : [out]
}

/** Clients serving as hidden verification check frames. */
export function checkClients(): Array<{ id: string, check: string }> {
  return [...clients.values()]
    .filter((c) => c.check)
    .map((c) => ({ id: c.id, check: c.check as string }))
}

/** Dispatch an op to check frames only, collecting every result. */
export async function pageCommandCheck(
  op: PageOp,
  payload: Record<string, unknown> = {},
  timeoutMs = 8000,
): Promise<unknown[]> {
  const targets = [...clients.values()].filter((c) => c.check)
  if (!targets.length) return [{ error: 'No check frames connected' }]
  return pageCommandAll(op, payload, timeoutMs, true).then((all) =>
    all.filter((r) => r && typeof r === 'object' && String((r as Record<string, unknown>).check || '')),
  )
}

export function acceptPageResult(body: { id?: string, ok?: boolean, error?: string, [k: string]: unknown }) {
  const id = typeof body?.id === 'string' ? body.id : ''
  const slot = pending.get(id)
  if (!slot || slot.finished) return false
  slot.results.push(body)
  if (slot.results.length >= slot.expected) {
    finishPending(id)
    return true
  }
  if (!slot.settle) {
    slot.settle = setTimeout(() => finishPending(id), SETTLE_MS)
  }
  return true
}

export async function pageCommand(op: PageOp, payload: Record<string, unknown> = {}, timeoutMs = 8000) {
  if (clients.size > 0) return dispatch(op, payload, timeoutMs)
  if (pageOwner) return { error: 'No live Vite page connected. Open the app on :5173.' }
  try {
    const r = await fetch(`${VITE_ORIGIN}/api/page/${op}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return await r.json()
  } catch (e: any) {
    return { error: 'Vite page not reachable on :5173', detail: e.message }
  }
}

export function mountPageBridge(app: Express) {
  app.get('/api/page/status', (_req, res) => {
    res.json({ ok: true, clients: clients.size, owner: pageOwner })
  })

  app.get('/api/page/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()
    const id = randomUUID()
    const top = req.query.top === '1'
    const check = typeof req.query.check === 'string' && req.query.check ? req.query.check : undefined
    const client: Client = {
      id,
      top,
      check,
      send(cmd) {
        try { res.write(`data: ${JSON.stringify(cmd)}\n\n`) } catch { /* closed */ }
      },
    }
    clients.set(id, client)
    res.write(`data: ${JSON.stringify({ type: 'hello', id })}\n\n`)
    const ping = setInterval(() => {
      try { res.write(': ping\n\n') } catch { /* closed */ }
    }, 15000)
    req.on('close', () => {
      clearInterval(ping)
      clients.delete(id)
    })
  })

  app.post('/api/page/result', (req, res) => {
    const ok = acceptPageResult(req.body || {})
    res.json({ ok })
  })

  app.post('/api/page/inspect', async (req, res) => {
    res.json(await pageCommand('inspect', req.body || {}))
  })
  app.post('/api/page/patch', async (req, res) => {
    res.json(await pageCommand('patch', req.body || {}))
  })
  app.post('/api/page/eval', async (req, res) => {
    res.json(await pageCommand('eval', req.body || {}))
  })
  app.post('/api/page/layout-snapshot', async (req, res) => {
    res.json(await pageCommand('layout-snapshot', req.body || {}, 15000))
  })
  app.post('/api/page/snapshot', async (req, res) => {
    res.json(await pageCommand('snapshot', req.body || {}))
  })
  app.post('/api/page/console', async (req, res) => {
    res.json(await pageCommand('console', req.body || {}))
  })
}
