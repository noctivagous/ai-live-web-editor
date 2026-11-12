/**
 * The deployment plugins' transports — the two ways a plugin
 * reaches its provider: the provider's CLI as a child process,
 * and plain HTTPS for its API. Both are injectable (the
 * dispatch/test-executor precedent) so every plugin flow is
 * exercised in tests against fakes; no test ever touches a
 * real account, and no code path fakes a live deploy.
 *
 * Environment: CLI children inherit the editor's environment
 * — that is where provider tokens live when present (§7.3) —
 * so a token never travels in argv, output, or a project file.
 */
import { execFile } from 'node:child_process'

export interface CliResult { code: number, stdout: string, stderr: string }
export type CliRunner = (cmd: string, args: string[], cwd: string) => Promise<CliResult>

export interface HttpResult { status: number, json: unknown, text: string }
export type HttpFetcher = (url: string, init: { method?: string, headers?: Record<string, string>, body?: string }) => Promise<HttpResult>

const defaultCliRunner: CliRunner = (cmd, args, cwd) => new Promise((resolve) => {
  execFile(cmd, args, { cwd, env: { ...process.env }, maxBuffer: 32 * 1024 * 1024, timeout: 15 * 60_000 }, (err, stdout, stderr) => {
    const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0
    resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
  })
})

const defaultHttpFetcher: HttpFetcher = async (url, init) => {
  const res = await fetch(url, { method: init.method ?? 'GET', headers: init.headers, body: init.body })
  const text = await res.text()
  let json: unknown = null
  try { json = JSON.parse(text) } catch { /* non-JSON body: text carries it */ }
  return { status: res.status, json, text }
}

let cliRunner: CliRunner = defaultCliRunner
let httpFetcher: HttpFetcher = defaultHttpFetcher

export function runCli(cmd: string, args: string[], cwd: string): Promise<CliResult> {
  return cliRunner(cmd, args, cwd)
}
export function httpJson(url: string, init: { method?: string, headers?: Record<string, string>, body?: string }): Promise<HttpResult> {
  return httpFetcher(url, init)
}
export function setCliRunner(fn: CliRunner | null): void { cliRunner = fn ?? defaultCliRunner }
export function setHttpFetcher(fn: HttpFetcher | null): void { httpFetcher = fn ?? defaultHttpFetcher }

/** The first https URL in a block of CLI output, if any. */
export function firstUrl(text: string): string | undefined {
  return /https:\/\/[^\s"')\]]+/.exec(text)?.[0]
}

/** The last few lines of output, for a deploy record's note. */
export function outputTail(text: string, lines = 6): string {
  return text.trim().split('\n').slice(-lines).join('\n').slice(0, 300)
}
