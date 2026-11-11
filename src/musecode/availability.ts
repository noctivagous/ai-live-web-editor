/**
 * Muse Code binary availability (Muse Code design §4):
 * computed on the host, never assumed. The host locates the
 * `muse` binary — on PATH, or in ~/.local/bin, where the
 * official installer puts it — and asks it for its version. The
 * UI reads the result through the availability API so the Muse
 * Code engine option can say "not available on this machine"
 * when there is no binary, and a chat turn on that engine can
 * fail with the same plain message instead of a spawn error.
 *
 * Detection is injectable (MuseLookup) so tests can stand in a
 * fake binary or none at all; the live result is cached briefly
 * because Settings and the wizard both ask on mount.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface MuseCodeAvailability {
  /** True only when a binary was found AND answered --version. */
  available: boolean
  /** Parsed version (e.g. "1.4.15") when the binary answered. */
  version: string | null
  /** The binary's own first version line, for display. */
  versionLine: string | null
  /** Absolute path of the binary that was found, when any. */
  binPath: string | null
}

/** Extract the dotted version from `muse --version` output
 * ("Muse Code 1.4.15 (1.4.15-R8339.1)" → "1.4.15"). */
export function parseMuseVersion(output: string): string | null {
  const m = /(\d+\.\d+\.\d+)/.exec(output ?? '')
  return m ? m[1] : null
}

/** The host interactions detection needs, injectable for tests. */
export interface MuseLookup {
  /** Directories to search for the binary, in priority order. */
  searchDirs: string[]
  /** The binary's file name in those directories. */
  binName: string
  isExecutable: (file: string) => boolean
  /** Run `<bin> --version`; resolves with stdout, rejects on any failure. */
  runVersion: (bin: string) => Promise<string>
}

function defaultIsExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return fs.statSync(file).isFile()
  } catch { return false }
}

function defaultRunVersion(bin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, ['--version'], { timeout: 5000 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(String(stdout))
    })
  })
}

export function defaultMuseLookup(env: NodeJS.ProcessEnv = process.env): MuseLookup {
  const binName = process.platform === 'win32' ? 'muse.exe' : 'muse'
  const dirs = (env.PATH ?? '').split(path.delimiter).filter(Boolean)
  // The installer's home is not always on PATH (notably in a
  // launcher started from a GUI), so it is always searched too.
  dirs.push(path.join(os.homedir(), '.local', 'bin'))
  return { searchDirs: dirs, binName, isExecutable: defaultIsExecutable, runVersion: defaultRunVersion }
}

/** Find the first executable `muse` in the search dirs, or null. */
export function findMuseBinary(lookup: MuseLookup): string | null {
  for (const dir of lookup.searchDirs) {
    const candidate = path.join(dir, lookup.binName)
    if (lookup.isExecutable(candidate)) return candidate
  }
  return null
}

export async function detectMuseCodeAvailability(lookup: MuseLookup = defaultMuseLookup()): Promise<MuseCodeAvailability> {
  const binPath = findMuseBinary(lookup)
  if (!binPath) return { available: false, version: null, versionLine: null, binPath: null }
  try {
    const out = await lookup.runVersion(binPath)
    const versionLine = out.split('\n').map(s => s.trim()).find(Boolean) ?? null
    const version = parseMuseVersion(out)
    if (!version) return { available: false, version: null, versionLine, binPath }
    return { available: true, version, versionLine, binPath }
  } catch {
    // Found but not answering: report the path, claim nothing.
    return { available: false, version: null, versionLine: null, binPath }
  }
}

const CACHE_MS = 30_000
let cache: { at: number, value: MuseCodeAvailability } | null = null

/** The cached availability (30 s), for hot paths and the API. */
export async function getMuseCodeAvailability(): Promise<MuseCodeAvailability> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value
  const value = await detectMuseCodeAvailability()
  cache = { at: Date.now(), value }
  return value
}

/** Test hook: drop the cached availability. */
export function resetMuseCodeAvailabilityCache(): void { cache = null }
