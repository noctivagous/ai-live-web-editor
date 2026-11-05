import { randomUUID } from 'node:crypto'
import type { Request, Response, Express } from 'express'

export type PageOp = 'inspect' | 'patch' | 'eval' | 'layout-snapshot'

type Client = {
  id: string
  top: boolean
  send: (cmd: object) => void
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const clients = new Map<string, Client>()
const pending = new Map<string, Pending>()
let pageOwner = false

const VITE_ORIGIN = process.env.VITE_ORIGIN || 'http://localhost:5173'

export function markPageOwner() {
  pageOwner = true
}

export function livePageCount() {
  return clients.size
}

function dispatch(op: PageOp, payload: Record<string, unknown>, timeoutMs: number) {
  if (!clients.size) {
    return Promise.resolve({ error: 'No live Vite page connected. Open the app on :5173.' })
  }
  const id = randomUUID()
  const ranked = [...clients.values()].sort((a, b) => Number(b.top) - Number(a.top))
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve,
      reject,
      timer: setTimeout(() => {
        pending.delete(id)
        resolve({ error: `Live page ${op} timed out after ${timeoutMs}ms` })
      }, timeoutMs),
    })
    const cmd = { id, op, payload }
    for (const c of ranked) c.send(cmd)
  })
}

export function acceptPageResult(body: { id?: string, ok?: boolean, error?: string, [k: string]: unknown }) {
  const id = typeof body?.id === 'string' ? body.id : ''
  const slot = pending.get(id)
  if (!slot) return false
  clearTimeout(slot.timer)
  pending.delete(id)
  slot.resolve(body)
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
    const client: Client = {
      id,
      top,
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
}
