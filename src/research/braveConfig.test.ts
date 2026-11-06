import assert from 'node:assert/strict'
import test from 'node:test'
import { braveSearch } from './brave.js'
import { braveStatus } from './researchApi.js'

test('braveStatus reports configured + last4 without exposing the key', () => {
  const s = braveStatus('BSA-example-key-9876')
  assert.equal(s.configured, true)
  assert.equal(s.keyLast4, '9876')
  assert.equal(JSON.stringify(s).includes('example'), false)
})

test('braveStatus is unconfigured for an empty key', () => {
  assert.deepEqual(braveStatus(''), { configured: false })
})

test('braveSearch names an invalid key plainly (Brave 422 code)', async () => {
  const stub = async () => new Response(
    JSON.stringify({ error: { code: 'SUBSCRIPTION_TOKEN_INVALID', detail: 'bad token' } }),
    { status: 422, headers: { 'Content-Type': 'application/json' } },
  )
  const r = await braveSearch('anything', { count: 1 }, stub, 'not-a-real-key')
  assert.equal(r.ok, false)
  if (r.ok === false) assert.match(r.error, /key is invalid/)
})

test('braveSearch falls back to the HTTP status for other errors', async () => {
  const stub = async () => new Response('oops', { status: 503 })
  const r = await braveSearch('anything', { count: 1 }, stub, 'some-key')
  assert.equal(r.ok, false)
  if (r.ok === false) assert.match(r.error, /HTTP 503/)
})
