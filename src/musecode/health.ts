/**
 * Muse Code health facts for the sandbox surface (Muse Code
 * design §5.2): the binary (availability.ts), the sign-in state,
 * and the sandbox probe.
 *
 * The probe answers the one question a file check can't: can a
 * sandboxed shell command actually initialise on this machine?
 * The spike found a host (this VM) where the answer is no — the
 * bundled bubblewrap dies mounting /proc and every sandboxed
 * shell command then fails as an "environment error", which from
 * the user's side looks like the agent failing mysteriously.
 * Probing for a bwrap binary says nothing about that; only a
 * real sandboxed run does. So the probe runs one, in a scratch
 * directory, capped at 2 model steps: `muse exec` in its
 * default sandboxed posture, asked to write one probe file
 * through the shell. File written → sandboxed shell works. The
 * sandbox's own failure signature in the output → it doesn't,
 * and the surface shows that instead of letting runs fail.
 * Anything else is reported as indeterminate — a state, never
 * an exception.
 *
 * Sign-in state is detected, not queried (the CLI offers no
 * status command): an API key in the process environment, or
 * Muse Code's own credential store (auth.json under its config
 * dir — the file `muse auth set` writes, and where the browser
 * sign-in lands). The store's contents are never read.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getMuseCodeAvailability, type MuseCodeAvailability } from './availability.js'

export interface MuseSignIn {
  state: 'api-key' | 'stored' | 'none-found'
  detail: string
}

/** Muse Code's config dir: $XDG_CONFIG_HOME/muse, else ~/.config/muse. */
export function museConfigDir(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  const xdg = env.XDG_CONFIG_HOME
  return path.join(xdg && xdg.trim() ? xdg : path.join(home, '.config'), 'muse')
}

export function detectMuseSignIn(
  env: NodeJS.ProcessEnv = process.env,
  opts: { configDir?: string, fileHasContent?: (file: string) => boolean } = {},
): MuseSignIn {
  if (env.META_API_KEY && env.META_API_KEY.trim()) {
    return { state: 'api-key', detail: 'An API key is set for the editor process (META_API_KEY).' }
  }
  const configDir = opts.configDir ?? museConfigDir(env)
  const hasContent = opts.fileHasContent ?? ((file: string) => {
    try { return fs.statSync(file).size > 2 } catch { return false }
  })
  if (hasContent(path.join(configDir, 'auth.json'))) {
    return { state: 'stored', detail: 'A sign-in is stored on this machine, in Muse Code’s own credential store.' }
  }
  return {
    state: 'none-found',
    detail: 'No sign-in found on this machine. Run `muse login` in a terminal, or set an API key with `muse auth set` — Muse Code asks for one before it can run.',
  }
}

export type SandboxProbeState = 'ok' | 'sandbox-failed' | 'indeterminate'

export interface SandboxProbeResult {
  state: SandboxProbeState
  /** What happened, in words the surface can show as-is. */
  detail: string
  /** ISO timestamp of the run that produced this result. */
  probedAt: string
}

const PROBE_FILE = 'ale-sandbox-probe.txt'
const PROBE_PROMPT = `Run this shell command exactly, then reply with only the word DONE: echo ale-probe-ok > ${PROBE_FILE}`

/** The sandbox's failure signatures (spike item 6): the bundled
 * bubblewrap dying at setup, or the harness reporting the
 * sandbox as an environment failure. */
export function sandboxFailureSignature(output: string): string | null {
  const text = output ?? ''
  const m = /bwrap:[^\n]*/i.exec(text)
    ?? /can(?:'|’)t mount proc[^\n]*/i.exec(text)
    ?? /sandbox[^\n]{0,80}(environment error|failed to (?:start|initiali[sz]e)|unavailable|not available)/i.exec(text)
  if (!m) return null
  // The match can run to the end of a long JSONL line — clip it to
  // an excerpt the surface can show.
  const s = m[0].trim()
  return s.length > 200 ? `${s.slice(0, 199)}…` : s
}

/** Classify a finished probe run: the failure signature wins
 * (the agent may still write around it in prose), then the
 * probe file, then indeterminate. Pure — the runner's output
 * and the scratch dir's contents go in, a state comes out. */
export function classifySandboxProbe(output: string, probeFileWritten: boolean): { state: SandboxProbeState, detail: string } {
  const signature = sandboxFailureSignature(output)
  if (signature) {
    return {
      state: 'sandbox-failed',
      detail: `Sandboxed commands can’t start on this machine: ${signature}. File edits still work, but anything Muse Code runs through the shell will fail the same way until the machine’s sandbox can start.`,
    }
  }
  if (probeFileWritten) {
    return { state: 'ok', detail: 'A sandboxed shell command ran and wrote its file — sandboxed commands work on this machine.' }
  }
  return {
    state: 'indeterminate',
    detail: 'The check didn’t produce a clear answer — the run finished without its probe file and without a sandbox error. Run the check again; if it keeps happening, sandboxed commands may still work, but this surface can’t confirm it.',
  }
}

/** Runs `muse exec` for the probe; resolves with its combined
 * output. Injectable so tests never spawn a real agent run. */
export type SandboxProbeRun = (bin: string, cwd: string) => Promise<{ output: string }>

const defaultProbeRun: SandboxProbeRun = (bin, cwd) => new Promise((resolve) => {
  execFile(
    bin,
    ['exec', '--json', '--disable-approval', '--max-model-steps', '2', PROBE_PROMPT],
    { cwd, timeout: 150_000, maxBuffer: 8 * 1024 * 1024 },
    (err, stdout, stderr) => {
      const killed = Boolean(err && (err as { killed?: boolean }).killed)
      resolve({ output: `${stdout ?? ''}\n${stderr ?? ''}${killed ? '\n[probe timed out]' : ''}` })
    },
  )
})

/** Run the probe now (one sandboxed exec in a fresh scratch dir,
 * removed afterwards). Never rejects: any failure of the probe
 * itself lands in the result as a state. */
export async function runSandboxProbe(
  binPath: string,
  opts: { run?: SandboxProbeRun, scratchRoot?: string } = {},
): Promise<SandboxProbeResult> {
  const probedAt = new Date().toISOString()
  let scratch: string | null = null
  try {
    scratch = fs.mkdtempSync(path.join(opts.scratchRoot ?? os.tmpdir(), 'ale-muse-probe-'))
    const { output } = await (opts.run ?? defaultProbeRun)(binPath, scratch)
    const written = fs.existsSync(path.join(scratch, PROBE_FILE))
    return { ...classifySandboxProbe(output, written), probedAt }
  } catch (e) {
    return {
      state: 'indeterminate',
      detail: `The check itself failed to run: ${e instanceof Error ? e.message : String(e)}. Run it again.`,
      probedAt,
    }
  } finally {
    if (scratch) { try { fs.rmSync(scratch, { recursive: true, force: true }) } catch { /* scratch cleanup is best-effort */ } }
  }
}

let probeCache: { key: string, result: SandboxProbeResult } | null = null

/** The last probe result for this binary, or null if none ran. */
export function cachedSandboxProbe(): SandboxProbeResult | null {
  return probeCache?.result ?? null
}

/** Probe, reusing the cached result for the same binary unless
 * forced. The key includes the binary path and version, so an
 * updated binary re-probes. */
export async function probeSandbox(
  availability: MuseCodeAvailability,
  opts: { force?: boolean, run?: SandboxProbeRun } = {},
): Promise<SandboxProbeResult> {
  if (!availability.available || !availability.binPath) {
    return {
      state: 'indeterminate',
      detail: 'Muse Code is not available on this machine, so there is nothing to check yet.',
      probedAt: new Date().toISOString(),
    }
  }
  const key = `${availability.binPath}@${availability.version ?? '?'}`
  if (!opts.force && probeCache && probeCache.key === key) return probeCache.result
  const result = await runSandboxProbe(availability.binPath, { run: opts.run })
  probeCache = { key, result }
  return result
}

/** Test hook: drop the cached probe result. */
export function resetSandboxProbeCache(): void { probeCache = null }

export interface MuseCodeHealth {
  availability: MuseCodeAvailability
  signIn: MuseSignIn
  /** The cached probe result, or null when no probe has run. */
  sandboxProbe: SandboxProbeResult | null
}

/** The health facts as the surface loads them: availability and
 * sign-in are computed fresh (availability itself is cached in
 * its module); the probe is only ever the cached result — it
 * runs on demand, never on page load, because it costs a run. */
export async function getMuseCodeHealth(): Promise<MuseCodeHealth> {
  const availability = await getMuseCodeAvailability()
  return { availability, signIn: detectMuseSignIn(), sandboxProbe: cachedSandboxProbe() }
}
