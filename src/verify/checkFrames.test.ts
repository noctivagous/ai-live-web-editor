import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import http from 'node:http'

/**
 * Check-frame fail-fast. The second test stands in for the page's own
 * server: it answers pageCommand's HTTP fallback for the mount eval
 * with success, exactly like a plugin-hosted Vite process would. In
 * that topology the mounted frames register with THAT server, never
 * with this process — ensureCheckFrames must say so at once instead
 * of waiting out the 15 s registration timeout.
 *
 * VITE_ORIGIN is read when pageBridge.js first evaluates, so every
 * module under test is imported dynamically, after the env is set.
 */
let server: http.Server
let frames: typeof import('./checkFrames.js')

before(async () => {
  server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/page/eval') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true, result: { ok: true, ensured: [375, 768, 1280] } }))
      return
    }
    res.statusCode = 404
    res.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  assert.ok(addr && typeof addr === 'object')
  process.env.VITE_ORIGIN = `http://127.0.0.1:${addr.port}`
  frames = await import('./checkFrames.js')
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('framesSkipNote (fail-fast decision)', () => {
  it('skips only when the eval reached a page whose frames register elsewhere', () => {
    assert.equal(frames.framesSkipNote(true, false), frames.FRAMES_REMOTE_NOTE)
    assert.equal(frames.framesSkipNote(true, true), null)
    assert.equal(frames.framesSkipNote(false, false), null)
    assert.equal(frames.framesSkipNote(false, true), null)
    assert.match(frames.FRAMES_REMOTE_NOTE, /per-width checks unavailable/)
  })
})

describe('ensureCheckFrames cross-process', () => {
  it('returns promptly with the unverified note instead of burning the registration timeout', async () => {
    const t0 = Date.now()
    const r = await frames.ensureCheckFrames([375, 768, 1280])
    const elapsed = Date.now() - t0
    assert.deepEqual(r.markers, [])
    assert.equal(r.skipped, frames.FRAMES_REMOTE_NOTE)
    assert.ok(elapsed < 10000, `took ${elapsed}ms — the old wait was 15000ms`)
  })
})
