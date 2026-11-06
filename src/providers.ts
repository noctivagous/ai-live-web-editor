import { detectPreset, presetById, tagModels, type AuthStyle, type ModelInfo } from './providerPresets.js'

export type ProviderInfo = {
  id: string
  name: string
  baseUrl: string
}

export type ProbeErrorKind = 'invalid_key' | 'no_credit' | 'unreachable' | 'no_models' | 'unknown'

export class ProbeError extends Error {
  kind: ProbeErrorKind
  constructor(kind: ProbeErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

export function authHeaders(style: AuthStyle, key: string): Record<string, string> {
  switch (style) {
    case 'x-api-key': return { 'x-api-key': key }
    case 'key': return { Authorization: `Key ${key}` }
    case 'xi-api-key': return { 'xi-api-key': key }
    case 'none': return {}
    default: return { Authorization: `Bearer ${key}` }
  }
}

const XAI_BASE = 'https://api.x.ai/v1'
const OPENAI_BASE = 'https://api.openai.com/v1'
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'
const GROQ_BASE = 'https://api.groq.com/openai/v1'
const GATEWAY_BASE = 'https://ai-gateway.vercel.sh/v1'

const SKIP = /imagine|image|video|voice|tts|whisper|embed|dall-e|moderation|realtime/

const PREFERRED = [
  'grok-4.7',
  'grok-4.6',
  'grok-build-0.1',
  'grok-4.5',
  'grok-4.3',
  'gpt-4o-mini',
  'gpt-4o',
]

export function inferProvider(key: string, baseUrl: string): ProviderInfo | null {
  const k = key.trim()
  const u = baseUrl.trim().replace(/\/+$/, '')
  if (u.includes('api.x.ai') || k.startsWith('xai-')) {
    return { id: 'xai', name: 'xAI', baseUrl: u.includes('api.x.ai') ? u : XAI_BASE }
  }
  if (u.includes('openrouter') || k.startsWith('sk-or-')) {
    return { id: 'openrouter', name: 'OpenRouter', baseUrl: u || OPENROUTER_BASE }
  }
  if (u.includes('groq.com') || k.startsWith('gsk_')) {
    return { id: 'groq', name: 'Groq', baseUrl: u || GROQ_BASE }
  }
  if (u.includes('ai-gateway.vercel.sh')) {
    return { id: 'vercel', name: 'Vercel AI Gateway', baseUrl: u || GATEWAY_BASE }
  }
  if (u) return { id: 'custom', name: 'OpenAI-compatible', baseUrl: u }
  if (k.startsWith('sk-')) return { id: 'openai', name: 'OpenAI', baseUrl: OPENAI_BASE }
  return null
}

function isChatModel(id: string) {
  const s = id.toLowerCase()
  if (!s || s === 'latest') return false
  return !SKIP.test(s)
}

function extractIds(json: unknown): string[] {
  if (!json || typeof json !== 'object') return []
  const rec = json as Record<string, unknown>
  const rows = Array.isArray(rec.data) ? rec.data : Array.isArray(rec.models) ? rec.models : []
  const ids: string[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    if (typeof item.id === 'string') ids.push(item.id)
    else if (typeof item.name === 'string') ids.push(item.name)
    if (Array.isArray(item.aliases)) {
      for (const a of item.aliases) if (typeof a === 'string') ids.push(a)
    }
  }
  return [...new Set(ids)]
}

async function getJson(url: string, key: string, style: AuthStyle = 'bearer'): Promise<unknown> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 12000)
  let r: Response
  try {
    r = await fetch(url, {
      headers: authHeaders(style, key),
      signal: ctrl.signal,
    })
  } catch (e) {
    throw new ProbeError('unreachable', `Could not reach ${url}: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    clearTimeout(t)
  }
  const text = await r.text()
  let json: unknown = null
  try { json = text ? JSON.parse(text) : null } catch { json = { error: text.slice(0, 400) } }
  if (!r.ok) {
    const err = json && typeof json === 'object' && 'error' in json
      ? (json as { error?: { message?: string } | string }).error
      : null
    const msg = typeof err === 'string' ? err : err?.message || `HTTP ${r.status}`
    if (r.status === 401 || r.status === 403) throw new ProbeError('invalid_key', msg)
    if (r.status === 402) throw new ProbeError('no_credit', msg)
    throw new ProbeError('unknown', msg)
  }
  return json
}

export interface ProbeResult {
  ok: true
  provider: string
  providerName: string
  baseUrl: string
  /** Model ids (chat-filtered unless allModels was requested). */
  models: string[]
  /** Every returned model, tagged with inferred modalities. */
  tagged: ModelInfo[]
  suggested: string
}

export async function listProviderModels(
  key: string,
  baseUrlHint = '',
  opts: { allModels?: boolean, presetId?: string } = {},
): Promise<ProbeResult> {
  const trimmed = key.trim()
  const preset = opts.presetId ? presetById(opts.presetId) : detectPreset(trimmed, baseUrlHint)?.preset
  const needsKey = !preset?.noKey
  if (!trimmed && needsKey) throw new ProbeError('invalid_key', 'Paste an API key to load models.')
  const provider = preset
    ? { id: preset.slotId, name: preset.name, baseUrl: (baseUrlHint.trim() || preset.defaultBaseUrl) }
    : inferProvider(trimmed, baseUrlHint)
  if (!provider) throw new ProbeError('unknown', 'Could not detect a provider from this key. Add a base URL.')

  const base = provider.baseUrl.replace(/\/+$/, '')
  const style: AuthStyle = preset?.authHeader || 'bearer'
  let ids: string[] = []
  if (preset?.modelsPath) {
    try {
      ids = extractIds(await getJson(`${base}${preset.modelsPath}`, trimmed, style))
    } catch {
      ids = []
    }
    if (ids.length) {
      // Merge the full /models list too, so media models show up by type.
      try {
        ids = [...new Set([...ids, ...extractIds(await getJson(`${base}/models`, trimmed, style))])]
      } catch { /* chat list alone is fine */ }
    }
  }
  if (!ids.length) ids = extractIds(await getJson(`${base}/models`, trimmed, style))
  const tagged = tagModels([...new Set(ids)].sort((a, b) => a.localeCompare(b)))
  if (!tagged.length) throw new ProbeError('no_models', `No models returned by ${provider.name}.`)
  const chat = tagged.filter(m => m.modalities.includes('text') && isChatModel(m.id))
  const listed = opts.allModels ? tagged : chat
  if (!listed.length) throw new ProbeError('no_models', `No chat models returned by ${provider.name}.`)
  const suggested = PREFERRED.find(p => chat.some(m => m.id === p)) || chat[0]?.id || listed[0].id
  return {
    ok: true as const,
    provider: provider.id,
    providerName: provider.name,
    baseUrl: base,
    models: listed.map(m => m.id),
    tagged,
    suggested,
  }
}
