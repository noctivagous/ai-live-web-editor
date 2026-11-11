import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  defaultMuseLookup, detectMuseCodeAvailability, findMuseBinary, parseMuseVersion, type MuseLookup,
} from './availability.js'

const VERSION_LINE = 'Muse Code 1.4.15 (1.4.15-R8339.1)'

function fakeLookup(partial: Partial<MuseLookup>): MuseLookup {
  return {
    searchDirs: ['/fake/bin'],
    binName: 'muse',
    isExecutable: () => false,
    runVersion: async () => VERSION_LINE + '\n',
    ...partial,
  }
}

describe('parseMuseVersion', () => {
  it('extracts the dotted version from the version line', () => {
    assert.equal(parseMuseVersion(VERSION_LINE), '1.4.15')
    assert.equal(parseMuseVersion('1.5.0\n'), '1.5.0')
  })
  it('returns null when there is no dotted version', () => {
    assert.equal(parseMuseVersion(''), null)
    assert.equal(parseMuseVersion('muse (unknown build)'), null)
  })
})

describe('detectMuseCodeAvailability', () => {
  it('reports unavailable when no binary is found', async () => {
    const a = await detectMuseCodeAvailability(fakeLookup({}))
    assert.deepEqual(a, { available: false, version: null, versionLine: null, binPath: null })
  })

  it('reports the version when a found binary answers', async () => {
    const a = await detectMuseCodeAvailability(fakeLookup({ isExecutable: () => true }))
    assert.equal(a.available, true)
    assert.equal(a.version, '1.4.15')
    assert.equal(a.versionLine, VERSION_LINE)
    assert.equal(a.binPath, path.join('/fake/bin', 'muse'))
  })

  it('keeps the found path but claims nothing when the binary does not answer', async () => {
    const a = await detectMuseCodeAvailability(fakeLookup({
      isExecutable: () => true,
      runVersion: async () => { throw new Error('spawn blew up') },
    }))
    assert.equal(a.available, false)
    assert.equal(a.version, null)
    assert.equal(a.binPath, path.join('/fake/bin', 'muse'))
  })

  it('finds the first executable candidate in search order', () => {
    const lookup = fakeLookup({
      searchDirs: ['/a', '/b'],
      isExecutable: (f) => f === path.join('/b', 'muse'),
    })
    assert.equal(findMuseBinary(lookup), path.join('/b', 'muse'))
  })
})

describe('defaultMuseLookup against a real fake binary on PATH', () => {
  let dir: string
  let prevPath: string | undefined
  let prevHome: string | undefined
  afterEach(() => {
    if (prevPath === undefined) delete process.env.PATH; else process.env.PATH = prevPath
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('answers available with the fake binary’s version; absent when PATH and HOME are empty of it', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-lookup-'))
    const binDir = path.join(dir, 'bin')
    const homeDir = path.join(dir, 'home')
    fs.mkdirSync(binDir, { recursive: true })
    fs.mkdirSync(homeDir, { recursive: true })
    const fake = path.join(binDir, 'muse')
    fs.writeFileSync(fake, `#!/bin/sh\necho "${VERSION_LINE}"\n`, { mode: 0o755 })

    prevPath = process.env.PATH
    prevHome = process.env.HOME
    process.env.PATH = binDir
    process.env.HOME = homeDir
    const found = await detectMuseCodeAvailability(defaultMuseLookup())
    assert.equal(found.available, true)
    assert.equal(found.version, '1.4.15')
    assert.equal(found.binPath, fake)

    // Same lookup shape, nowhere for the binary to live.
    process.env.PATH = homeDir
    const absent = await detectMuseCodeAvailability(defaultMuseLookup())
    assert.equal(absent.available, false)
    assert.equal(absent.binPath, null)
  })
})
