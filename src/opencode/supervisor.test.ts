import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  OPENCODE_EDITOR_ROOT, opencodeBinaryPackageNames, resolveOpencodeBinary,
} from './supervisor.js'

describe('opencode binary resolution', () => {
  it('prefers the plain linux-x64 build, then baseline, then musl variants', () => {
    assert.deepEqual(opencodeBinaryPackageNames('linux', 'x64'), [
      'cli-linux-x64', 'cli-linux-x64-baseline', 'cli-linux-x64-musl', 'cli-linux-x64-baseline-musl',
    ])
    assert.deepEqual(opencodeBinaryPackageNames('darwin', 'arm64'), ['cli-darwin-arm64'])
  })

  it('honors the OPENCODE_BIN override above all', () => {
    assert.equal(resolveOpencodeBinary({ OPENCODE_BIN: '/opt/custom/opencode' }, () => false), '/opt/custom/opencode')
  })

  it('finds the pinned platform package in the editor node_modules', () => {
    const plain = path.join(OPENCODE_EDITOR_ROOT, 'node_modules', '@opencode', 'cli-linux-x64', 'bin', 'opencode')
    const found = resolveOpencodeBinary({}, (p) => p === plain)
    assert.equal(found, plain)
  })

  it('falls back to PATH when no package is installed', () => {
    assert.equal(resolveOpencodeBinary({}, () => false), 'opencode')
  })
})
