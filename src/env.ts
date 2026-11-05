import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { inferProvider } from './providers.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let envPath = path.join(ROOT, '.env')
export function getEnvPath() { return envPath }
export function setEnvPath(file: string) { envPath = path.resolve(file) }
export const ENV_PATH = path.join(ROOT, '.env')

export const DEFAULT_MODEL = 'gpt-4o-mini'

/** Load gitignored `.env` into process.env without overriding real env vars. */
export function loadDotEnv() {
  const file = getEnvPath()
  if (!fs.existsSync(file)) return
  const text = fs.readFileSync(file, 'utf-8')
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const body = line.startsWith('export ') ? line.slice(7).trim() : line
    const eq = body.indexOf('=')
    if (eq < 1) continue
    const k = body.slice(0, eq).trim()
    let v = body.slice(eq + 1)
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (process.env[k] === undefined) process.env[k] = v
  }
}

export function openaiApiKey(): string {
  return process.env.OPENAI_API_KEY?.trim() || process.env.XAI_API_KEY?.trim() || ''
}

export function hasAiKey(): boolean {
  return Boolean(openaiApiKey())
}

export function openaiBaseUrl(): string {
  return process.env.OPENAI_BASE_URL?.trim() || ''
}

export function openaiModelName(): string {
  const raw = process.env.OPENAI_MODEL?.trim()
  if (raw) return raw.replace(/^openai\//, '') || DEFAULT_MODEL
  if (openaiBaseUrl().includes('api.x.ai')) return 'grok-4.7'
  return DEFAULT_MODEL
}

/** Mastra's OpenAI-compatible adapter id (`openai/…` is the protocol, not the company). */
export function currentModelId(): string {
  return `openai/${openaiModelName()}`
}

export function publicProvider() {
  return inferProvider(openaiApiKey(), openaiBaseUrl())
}

/** OpenAI-compatible config, resolved at generate time so a wizard-saved key is used immediately. */
export function resolveAgentModel() {
  const apiKey = openaiApiKey()
  const modelId = openaiModelName()
  const url = openaiBaseUrl()
  return url
    ? { id: `openai/${modelId}` as const, url, apiKey }
    : { id: `openai/${modelId}` as const, apiKey }
}

function truthyEnv(v: string | undefined) {
  const n = v?.trim().toLowerCase()
  return n === '1' || n === 'true' || n === 'yes' || n === 'on'
}

/** `bridge` = Vite page in the user's tab. `pool` = Playwright Chrome (skip the Vite bridge). */
export function liveTarget(): 'bridge' | 'pool' {
  const v = (process.env.LIVE_TARGET || '').trim().toLowerCase()
  if (v === 'pool' || v === 'playwright') return 'pool'
  try {
    const text = fs.readFileSync(getEnvPath(), 'utf-8')
    const m = text.match(/^LIVE_TARGET=(.*)$/m)
    if (m) {
      const n = m[1].trim().replace(/^["']|["']$/g, '').toLowerCase()
      if (n === 'pool' || n === 'playwright') return 'pool'
    }
  } catch { /* no .env */ }
  return 'bridge'
}

export function playwrightPoolEnabled(): boolean {
  if (liveTarget() === 'pool') return true
  if (process.env.PLAYWRIGHT_POOL !== undefined && process.env.PLAYWRIGHT_POOL !== '') {
    return truthyEnv(process.env.PLAYWRIGHT_POOL)
  }
  try {
    const text = fs.readFileSync(getEnvPath(), 'utf-8')
    const m = text.match(/^PLAYWRIGHT_POOL=(.*)$/m)
    if (m) return truthyEnv(m[1].replace(/^["']|["']$/g, ''))
  } catch { /* no .env */ }
  return false
}

export function setPlaywrightPool(enabled: boolean) {
  process.env.PLAYWRIGHT_POOL = enabled ? '1' : '0'
  upsertEnvVar('PLAYWRIGHT_POOL', enabled ? '1' : '0')
}

export function saveAiConfig(input: { key?: string, baseUrl?: string, model?: string }) {
  const key = input.key?.trim()
  if (key) {
    if (/[\r\n]/.test(key)) throw new Error('API key must be a single line')
    if (key.length < 8) throw new Error('API key looks too short')
    process.env.OPENAI_API_KEY = key
    upsertEnvVar('OPENAI_API_KEY', key)
    if (key.startsWith('xai-')) {
      process.env.XAI_API_KEY = key
      upsertEnvVar('XAI_API_KEY', key)
    }
  }
  if (input.baseUrl !== undefined) {
    const url = input.baseUrl.trim().replace(/\/+$/, '')
    if (url && !/^https?:\/\//i.test(url)) throw new Error('Base URL must start with http:// or https://')
    if (url) {
      process.env.OPENAI_BASE_URL = url
      upsertEnvVar('OPENAI_BASE_URL', url)
    } else {
      delete process.env.OPENAI_BASE_URL
      removeEnvVar('OPENAI_BASE_URL')
    }
  }
  if (input.model !== undefined) {
    const model = input.model.trim()
    if (!model) throw new Error('Select a model from the list')
    if (/[\r\n]/.test(model)) throw new Error('Model must be a single line')
    process.env.OPENAI_MODEL = model
    upsertEnvVar('OPENAI_MODEL', model)
  }
  if (!hasAiKey()) throw new Error('API key is empty')
}

function readEnvFile(): string {
  const file = getEnvPath()
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : ''
}

function writeEnvFile(text: string) {
  fs.writeFileSync(getEnvPath(), text, { encoding: 'utf-8', mode: 0o600 })
}

function upsertEnvVar(name: string, value: string) {
  const encoded = /[\s#"']/.test(value) ? JSON.stringify(value) : value
  const line = `${name}=${encoded}`
  let text = readEnvFile()
  const re = new RegExp(`^${name}=.*$`, 'm')
  if (re.test(text)) text = text.replace(re, line)
  else {
    if (text.length && !text.endsWith('\n')) text += '\n'
    text += line + '\n'
  }
  writeEnvFile(text)
}

function removeEnvVar(name: string) {
  if (!fs.existsSync(getEnvPath())) return
  const next = readEnvFile().split(/\r?\n/).filter(line => {
    const t = line.trim()
    return t !== name && !t.startsWith(`${name}=`)
  }).join('\n')
  writeEnvFile(next.endsWith('\n') || next === '' ? next : next + '\n')
}
