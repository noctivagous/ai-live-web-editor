import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_SANDBOX_POSTURE, isSandboxPosture, museRunConfig, resolveSandboxPosture, sanitizeSandboxPosture, SANDBOX_POSTURES,
} from './museSandbox.js'

describe('sandbox posture values', () => {
  it('sanitizes to a posture or undefined', () => {
    for (const p of SANDBOX_POSTURES) assert.equal(sanitizeSandboxPosture(p), p)
    assert.equal(sanitizeSandboxPosture('yolo'), undefined)
    assert.equal(sanitizeSandboxPosture(''), undefined)
    assert.equal(sanitizeSandboxPosture(undefined), undefined)
    assert.equal(sanitizeSandboxPosture(null), undefined)
    assert.equal(isSandboxPosture('strict'), true)
    assert.equal(isSandboxPosture('Strict'), false)
  })

  it('resolves project override → device default → standing default', () => {
    assert.equal(resolveSandboxPosture('sandboxed', 'strict'), 'strict', 'the project override wins')
    assert.equal(resolveSandboxPosture('sandboxed', undefined), 'sandboxed', 'no override → the device default')
    assert.equal(resolveSandboxPosture('sandboxed', 'junk'), 'sandboxed', 'a junk override is no override')
    assert.equal(resolveSandboxPosture(undefined, undefined), DEFAULT_SANDBOX_POSTURE)
    assert.equal(resolveSandboxPosture('junk', null), 'unblocked')
    assert.equal(DEFAULT_SANDBOX_POSTURE, 'unblocked')
  })
})

describe('museRunConfig — the posture mapping (spike item 6)', () => {
  it('unblocked: approvals allowed, project trusted, sandbox on', () => {
    const c = museRunConfig('unblocked')
    assert.equal(c.approvalMode, 'allowAll')
    assert.equal(c.trustWorkspace, true)
    assert.equal(c.sandboxNetwork, 'proxy-only')
    assert.ok(c.serveArgs.includes('--trust-workspace'))
    assert.ok(c.execArgs.includes('--disable-approval'), 'exec skips approvals and keeps the sandbox')
    assert.ok(c.execArgs.includes('--trust-workspace'))
  })

  it('unblocked with a network grant maps to unrestricted, on both shapes', () => {
    const c = museRunConfig('unblocked', { networkUnrestricted: true })
    assert.equal(c.sandboxNetwork, 'unrestricted')
    assert.ok(c.serveArgs.includes('unrestricted'))
    assert.ok(c.execArgs.includes('unrestricted'))
    // The grant is an Unblocked-only element of the mapping.
    assert.equal(museRunConfig('sandboxed', { networkUnrestricted: true }).sandboxNetwork, 'proxy-only')
  })

  it('sandboxed: per-config approvals, project trusted', () => {
    const c = museRunConfig('sandboxed')
    assert.equal(c.approvalMode, 'onRequest')
    assert.equal(c.trustWorkspace, true)
    assert.equal(c.sandboxNetwork, 'proxy-only')
    assert.ok(c.execArgs.includes('--approval-mode'))
    assert.ok(c.execArgs.includes('on-request'))
    assert.ok(c.serveArgs.includes('--trust-workspace'))
  })

  it('strict: everything asked, no network, project NOT trusted', () => {
    const c = museRunConfig('strict')
    assert.equal(c.approvalMode, 'denyUnmatched')
    assert.equal(c.trustWorkspace, false)
    assert.equal(c.sandboxNetwork, 'restricted')
    assert.ok(!c.serveArgs.includes('--trust-workspace'))
    assert.ok(!c.execArgs.includes('--trust-workspace'))
    assert.ok(c.execArgs.includes('untrusted'), 'the CLI spelling of denyUnmatched')
    assert.ok(c.execArgs.includes('restricted'))
  })

  it('no posture ever generates --yolo or disables the sandbox', () => {
    for (const p of SANDBOX_POSTURES) {
      for (const opts of [{}, { networkUnrestricted: true }]) {
        const c = museRunConfig(p, opts)
        assert.equal(c.sandbox, true)
        for (const arg of [...c.serveArgs, ...c.execArgs]) {
          assert.notEqual(arg, '--yolo', `${p} must never map to --yolo`)
          assert.notEqual(arg, '--disable-sandbox', `${p} must never disable the sandbox`)
        }
      }
    }
  })
})
