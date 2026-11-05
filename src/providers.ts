export type ProviderInfo = {
  id: string
  name: string
  baseUrl: string
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

async function getJson(url: string, key: string): Promise<unknown> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 12000)
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
    })
    const text = await r.text()
    let json: unknown = null
    try { json = text ? JSON.parse(text) : null } catch { json = { error: text.slice(0, 400) } }
    if (!r.ok) {
      const err = json && typeof json === 'object' && 'error' in json
        ? (json as { error?: { message?: string } | string }).error
        : null
      const msg = typeof err === 'string' ? err : err?.message || `HTTP ${r.status}`
      throw new Error(msg)
    }
    return json
  } finally {
    clearTimeout(t)
  }
}

export async function listProviderModels(key: string, baseUrlHint = '') {
  const trimmed = key.trim()
  if (!trimmed) throw new Error('Paste an API key to load models.')
  const provider = inferProvider(trimmed, baseUrlHint)
  if (!provider) throw new Error('Could not detect a provider from this key. Add a base URL.')

  const base = provider.baseUrl.replace(/\/+$/, '')
  let ids: string[] = []
  if (provider.id === 'xai') {
    try {
      ids = extractIds(await getJson(`${base}/language-models`, trimmed))
    } catch {
      ids = []
    }
  }
  if (!ids.length) ids = extractIds(await getJson(`${base}/models`, trimmed))
  ids = ids.filter(isChatModel).sort((a, b) => a.localeCompare(b))
  if (!ids.length) throw new Error(`No chat models returned by ${provider.name}.`)
  const suggested = PREFERRED.find(p => ids.includes(p)) || ids[0]
  return {
    ok: true as const,
    provider: provider.id,
    providerName: provider.name,
    baseUrl: base,
    models: ids,
    suggested,
  }
}
