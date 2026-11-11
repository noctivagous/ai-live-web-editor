import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { MuseCodeAvailability } from './availability.js'
import {
  classifySandboxProbe, detectMuseSignIn, museConfigDir, probeSandbox, resetSandboxProbeCache, runSandboxProbe, sandboxFailureSignature,
} from './health.js'

describe('detectMuseSignIn', () => {
  it('an API key in the environment is a sign-in', () => {
    const s = detectMuseSignIn({ META_API_KEY: 'dummy-key-for-test' }, { fileHasContent: () => false })
    assert.equal(s.state, 'api-key')
  })
  it('a credential store with content is a sign-in', () => {
    const s = detectMuseSignIn({}, { configDir: '/cfg', fileHasContent: (f) => f === path.join('/cfg', 'auth.json') })
    assert.equal(s.state, 'stored')
  })
  it('neither is honestly reported as none found', () => {
    const s = detectMuseSignIn({}, { fileHasContent: () => false })
    assert.equal(s.state, 'none-found')
    assert.match(s.detail, /muse login/)
  })
  it('the config dir follows XDG_CONFIG_HOME, else ~/.config', () => {
    assert.equal(museConfigDir({ XDG_CONFIG_HOME: '/xdg' }, '/home/x'), path.join('/xdg', 'muse'))
    assert.equal(museConfigDir({}, '/home/x'), path.join('/home/x', '.config', 'muse'))
  })
})

describe('sandbox failure classification', () => {
  // The spike's exact VM failure (spike item 6).
  const BWRAP = 'bwrap: Can\'t mount proc on /newroot/proc: Operation not permitted'

  it('recognizes the sandbox failure signatures', () => {
    assert.ok(sandboxFailureSignature(BWRAP))
    assert.ok(sandboxFailureSignature('shell failed: sandbox environment error'))
    assert.equal(sandboxFailureSignature('the command ran fine'), null)
    assert.equal(sandboxFailureSignature(''), null)
  })

  it('clips a signature matched inside a long JSONL line to a showable excerpt', () => {
    const sig = sandboxFailureSignature(`{"output":"bwrap: Can't mount proc ${'x'.repeat(500)}"}`)
    assert.ok(sig)
    assert.ok(sig.length <= 200, `signature excerpt is ${sig.length} chars`)
    assert.ok(sig.endsWith('…'))
  })

  it('the failure signature wins over a written probe file', () => {
    // The agent can write around a dead sandbox in prose; the
    // signature is the ground truth about sandboxed shell.
    assert.equal(classifySandboxProbe(BWRAP, true).state, 'sandbox-failed')
  })
  it('a written probe file with clean output is ok', () => {
    assert.equal(classifySandboxProbe('{"type":"done"}', true).state, 'ok')
  })
  it('neither signal is indeterminate, not a failure claim', () => {
    const r = classifySandboxProbe('some other output', false)
    assert.equal(r.state, 'indeterminate')
    assert.match(r.detail, /didn’t produce a clear answer/)
  })
})

describe('runSandboxProbe with fake runners', () => {
  let scratchRoot: string
  beforeEach(() => { scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-test-')) })
  afterEach(() => { fs.rmSync(scratchRoot, { recursive: true, force: true }) })

  it('ok when the run writes the probe file; the scratch dir is removed', async () => {
    const r = await runSandboxProbe('/fake/muse', {
      scratchRoot,
      run: async (_bin, cwd) => {
        fs.writeFileSync(path.join(cwd, 'ale-sandbox-probe.txt'), 'ale-probe-ok\n')
        return { output: 'DONE' }
      },
    })
    assert.equal(r.state, 'ok')
    assert.ok(r.probedAt)
    assert.deepEqual(fs.readdirSync(scratchRoot), [], 'the scratch dir is cleaned up')
  })

  it('a sandbox failure is a result state, not an exception', async () => {
    const r = await runSandboxProbe('/fake/muse', {
      scratchRoot,
      run: async () => ({ output: 'bwrap: Can\'t mount proc on /newroot/proc: Operation not permitted' }),
    })
    assert.equal(r.state, 'sandbox-failed')
    assert.match(r.detail, /can’t start on this machine/)
  })

  it('a runner that throws still resolves, as indeterminate', async () => {
    const r = await runSandboxProbe('/fake/muse', {
      scratchRoot,
      run: async () => { throw new Error('spawn refused') },
    })
    assert.equal(r.state, 'indeterminate')
    assert.match(r.detail, /spawn refused/)
  })
})

describe('probeSandbox caching', () => {
  const available: MuseCodeAvailability = { available: true, version: '1.4.15', versionLine: 'Muse Code 1.4.15', binPath: '/fake/muse' }
  beforeEach(() => { resetSandboxProbeCache() })
  afterEach(() => { resetSandboxProbeCache() })

  it('reuses the cached result per binary; force re-runs', async () => {
    let runs = 0
    const run = async () => { runs++; return { output: 'nothing telling' } }
    const first = await probeSandbox(available, { run })
    const second = await probeSandbox(available, { run })
    assert.equal(runs, 1, 'the second read is the cache — a probe costs a run')
    assert.deepEqual(second, first)
    await probeSandbox(available, { run, force: true })
    assert.equal(runs, 2)
  })

  it('no binary → indeterminate without running anything', async () => {
    let runs = 0
    const r = await probeSandbox(
      { available: false, version: null, versionLine: null, binPath: null },
      { run: async () => { runs++; return { output: '' } } },
    )
    assert.equal(r.state, 'indeterminate')
    assert.equal(runs, 0)
  })
})
