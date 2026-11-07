import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installProjectDeps } from './launcher.js'

/**
 * installProjectDeps (slice 5b): an npm-install failure during project
 * creation used to be swallowed — the project was selected and
 * reported as success with no dependencies installed. The helper now
 * returns the failure as a value so createProject can surface it.
 */
describe('installProjectDeps', () => {
  function tmpProject(pkg: unknown) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-test-'))
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg))
    return dir
  }

  it('returns null when install succeeds', () => {
    const dir = tmpProject({ name: 'ok-proj', version: '0.0.0' })
    try {
      assert.equal(installProjectDeps(dir), null)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('returns a readable message when install fails', () => {
    const dir = tmpProject({ name: 'bad-proj', version: '0.0.0', scripts: { preinstall: 'exit 1' } })
    try {
      const err = installProjectDeps(dir)
      assert.equal(typeof err, 'string')
      assert.match(String(err), /Command failed/)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})
