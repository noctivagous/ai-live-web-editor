import fs from 'fs'
import path from 'path'
import {
  getEnvPath, loadDotEnv, openaiApiKey, openaiBaseUrl, openaiModelName,
  removeEnvVar, upsertEnvVar,
} from './env.js'
import {
  detectPreset, presetById, type Modality, type ModelInfo,
} from './providerPresets.js'

/**
 * Saved provider connections.
 *
 * Non-secret state (the connection list, which one is active, and the
 * per-modality default models) lives in `providers.json` next to `.env`.
 * Keys themselves stay in `.env`, one variable per connection
 * (`CONN_KEY_<ID>`), and are never returned by the API — only the last
 * four characters, as a fingerprint. The active connection is mirrored
 * into the legacy OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL triple
 * so every existing reader (agent, chat stream, external tooling) keeps
 * working unchanged.
 */

export interface ConnectionPricing { input: number; output: number }

export interface StoredConnection {
  id: string
  presetId: string
  name: string
  baseUrl: string
  model: string
  keyLast4: string
  /** Models from the last successful probe, tagged by modality. */
  verifiedModels: ModelInfo[]
  status: 'verified' | 'configured' | 'failed'
  updatedAt: number
  /** Optional per-1M-token USD prices for cost estimates. Absent = show tokens only. */
  pricing?: ConnectionPricing
}

export interface ModalityDefault {
  connectionId: string
  model: string
}

interface Store {
  connections: StoredConnection[]
  activeId: string | null
  modalityDefaults: Partial<Record<Modality, ModalityDefault>>
}

const EMPTY: Store = { connections: [], activeId: null, modalityDefaults: {} }

export function providersJsonPath(): string {
  return path.join(path.dirname(getEnvPath()), 'providers.json')
}

function keyEnvName(id: string): string {
  return `CONN_KEY_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
}

export function connectionKey(conn: Pick<StoredConnection, 'id' | 'presetId'>): string {
  const own = process.env[keyEnvName(conn.id)]?.trim()
  if (own) return own
  const preset = presetById(conn.presetId)
  if (preset) {
    const shared = process.env[preset.envKey]?.trim()
    if (shared) return shared
  }
  return ''
}

function readStore(): Store {
  try {
    const file = providersJsonPath()
    if (!fs.existsSync(file)) return structuredClone(EMPTY)
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<Store>
    return {
      connections: Array.isArray(raw.connections) ? raw.connections : [],
      activeId: typeof raw.activeId === 'string' ? raw.activeId : null,
      modalityDefaults: raw.modalityDefaults && typeof raw.modalityDefaults === 'object' ? raw.modalityDefaults : {},
    }
  } catch {
    return structuredClone(EMPTY)
  }
}

function writeStore(store: Store) {
  fs.writeFileSync(providersJsonPath(), JSON.stringify(store, null, 2) + '\n', 'utf-8')
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'provider'
}

function uniqueId(store: Store, base: string): string {
  let id = base
  let n = 2
  while (store.connections.some(c => c.id === id)) id = `${base}-${n++}`
  return id
}

/** Mirror the active connection into the legacy OPENAI_* triple. */
function mirrorLegacy(store: Store) {
  const active = store.connections.find(c => c.id === store.activeId)
  if (!active) return
  const key = connectionKey(active)
  const preset = presetById(active.presetId)
  if (key) {
    process.env.OPENAI_API_KEY = key
    upsertEnvVar('OPENAI_API_KEY', key)
    if (preset && preset.envKey !== 'OPENAI_API_KEY') {
      process.env[preset.envKey] = key
      upsertEnvVar(preset.envKey, key)
    }
  }
  if (active.baseUrl) {
    process.env.OPENAI_BASE_URL = active.baseUrl
    upsertEnvVar('OPENAI_BASE_URL', active.baseUrl)
  } else {
    delete process.env.OPENAI_BASE_URL
    removeEnvVar('OPENAI_BASE_URL')
  }
  if (active.model) {
    process.env.OPENAI_MODEL = active.model
    upsertEnvVar('OPENAI_MODEL', active.model)
  }
}

let migrated = false

/** One-time silent migration: the old single triple becomes connection #1. */
export function ensureMigrated(): Store {
  const store = readStore()
  if (migrated) return store
  migrated = true
  if (store.connections.length) return store
  loadDotEnv()
  const key = openaiApiKey()
  if (!key) return store
  const baseUrl = openaiBaseUrl()
  const detected = detectPreset(key, baseUrl)
  const preset = detected?.preset || presetById('custom')!
  const model = openaiModelName()
  const conn: StoredConnection = {
    id: uniqueId(store, slugify(preset.slotId)),
    presetId: preset.slotId,
    name: preset.name,
    baseUrl: baseUrl || preset.defaultBaseUrl,
    model,
    keyLast4: key.slice(-4),
    // The key was live in the old flow; count its model as verified text.
    verifiedModels: model ? [{ id: model, modalities: ['text'] }] : [],
    status: 'configured',
    updatedAt: Date.now(),
  }
  store.connections.push(conn)
  store.activeId = conn.id
  store.modalityDefaults = model ? { text: { connectionId: conn.id, model } } : {}
  process.env[keyEnvName(conn.id)] = key
  upsertEnvVar(keyEnvName(conn.id), key)
  writeStore(store)
  return store
}

export function getStore(): Store {
  return ensureMigrated()
}

export interface PublicConnection extends Omit<StoredConnection, 'verifiedModels'> {
  verifiedModels: ModelInfo[]
  hasKey: boolean
  active: boolean
}

export function publicStore() {
  const store = getStore()
  return {
    ok: true as const,
    connections: store.connections.map(c => ({
      ...c,
      hasKey: Boolean(connectionKey(c)) || Boolean(presetById(c.presetId)?.noKey),
      active: c.id === store.activeId,
    })) as PublicConnection[],
    activeId: store.activeId,
    modalityDefaults: store.modalityDefaults,
  }
}

/** A connection counts for the wizard gate when it has a key (or needs
 *  none) and a chosen model that a probe verified as a text model. */
export function hasValidConnection(store = getStore()): boolean {
  return store.connections.some(c => {
    const preset = presetById(c.presetId)
    const keyOk = Boolean(connectionKey(c)) || Boolean(preset?.noKey)
    if (!keyOk || !c.model) return false
    return c.verifiedModels.some(m => m.id === c.model && m.modalities.includes('text'))
  })
}

export function upsertConnection(input: {
  id?: string
  presetId: string
  name?: string
  baseUrl?: string
  model: string
  key?: string
  verifiedModels?: ModelInfo[]
  pricing?: ConnectionPricing | null
}): StoredConnection {
  const store = getStore()
  const preset = presetById(input.presetId) || presetById('custom')!
  const baseUrl = (input.baseUrl ?? preset.defaultBaseUrl).trim().replace(/\/+$/, '')
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) throw new Error('Base URL must start with http:// or https://')
  const model = input.model.trim()
  if (!model) throw new Error('Select a model from the list')
  let conn = input.id ? store.connections.find(c => c.id === input.id) : undefined
  if (!conn) {
    conn = {
      id: uniqueId(store, slugify(input.name || preset.slotId)),
      presetId: preset.slotId,
      name: (input.name || preset.name).trim() || preset.name,
      baseUrl,
      model,
      keyLast4: '',
      verifiedModels: [],
      status: 'configured',
      updatedAt: Date.now(),
    }
    store.connections.push(conn)
    if (!store.activeId) store.activeId = conn.id
  } else {
    conn.presetId = preset.slotId
    if (input.name?.trim()) conn.name = input.name.trim()
    conn.baseUrl = baseUrl
    conn.model = model
    conn.updatedAt = Date.now()
  }
  if (input.key !== undefined && input.key.trim()) {
    const key = input.key.trim()
    if (/[\r\n]/.test(key)) throw new Error('API key must be a single line')
    if (key.length < 8 && !preset.noKey) throw new Error('API key looks too short')
    process.env[keyEnvName(conn.id)] = key
    upsertEnvVar(keyEnvName(conn.id), key)
    conn.keyLast4 = key.slice(-4)
  }
  if (input.verifiedModels) {
    conn.verifiedModels = input.verifiedModels
    conn.status = 'verified'
  }
  if (input.pricing !== undefined) {
    const p = input.pricing
    if (p === null) {
      delete conn.pricing
    } else if (
      p && typeof p.input === 'number' && typeof p.output === 'number' &&
      Number.isFinite(p.input) && Number.isFinite(p.output) && p.input >= 0 && p.output >= 0
    ) {
      conn.pricing = { input: p.input, output: p.output }
    } else {
      throw new Error('Pricing must be two non-negative numbers (USD per 1M tokens)')
    }
  }
  if (!store.modalityDefaults.text) {
    store.modalityDefaults.text = { connectionId: conn.id, model: conn.model }
  }
  writeStore(store)
  mirrorLegacy(store)
  return conn
}

export function removeConnection(id: string) {
  const store = getStore()
  const conn = store.connections.find(c => c.id === id)
  if (!conn) throw new Error('Connection not found')
  store.connections = store.connections.filter(c => c.id !== id)
  delete process.env[keyEnvName(id)]
  removeEnvVar(keyEnvName(id))
  if (store.activeId === id) store.activeId = store.connections[0]?.id || null
  for (const mod of Object.keys(store.modalityDefaults) as Modality[]) {
    if (store.modalityDefaults[mod]?.connectionId === id) delete store.modalityDefaults[mod]
  }
  writeStore(store)
  mirrorLegacy(store)
}

export function activateConnection(id: string) {
  const store = getStore()
  if (!store.connections.some(c => c.id === id)) throw new Error('Connection not found')
  store.activeId = id
  writeStore(store)
  mirrorLegacy(store)
}

export function setModalityDefaults(defaults: Partial<Record<Modality, ModalityDefault>>) {
  const store = getStore()
  for (const [mod, sel] of Object.entries(defaults) as [Modality, ModalityDefault][]) {
    if (!sel || !sel.connectionId || !sel.model) {
      delete store.modalityDefaults[mod]
      continue
    }
    const conn = store.connections.find(c => c.id === sel.connectionId)
    if (!conn) throw new Error(`Connection not found for ${mod}`)
    if (!conn.verifiedModels.some(m => m.id === sel.model && m.modalities.includes(mod))) {
      throw new Error(`${sel.model} is not a verified ${mod} model on ${conn.name}`)
    }
    store.modalityDefaults[mod] = sel
  }
  writeStore(store)
  return store.modalityDefaults
}

export function recordProbe(id: string, verifiedModels: ModelInfo[], ok: boolean) {
  const store = getStore()
  const conn = store.connections.find(c => c.id === id)
  if (!conn) return
  if (ok) {
    conn.verifiedModels = verifiedModels
    conn.status = 'verified'
  } else {
    conn.status = 'failed'
  }
  conn.updatedAt = Date.now()
  writeStore(store)
}

/** What /api/config should report: the active connection, when one exists. */
export function activePublic(): {
  hasKey: boolean, model: string, providerId: string | null, providerName: string | null, baseUrl: string,
} | null {
  const store = getStore()
  const active = store.connections.find(c => c.id === store.activeId)
  if (!active) return null
  const preset = presetById(active.presetId)
  return {
    hasKey: Boolean(connectionKey(active)) || Boolean(preset?.noKey),
    model: active.model,
    providerId: active.presetId,
    providerName: active.name,
    baseUrl: active.baseUrl,
  }
}

/**
 * Keep the active connection in step when the legacy single-key endpoint
 * (POST /api/config/key) writes the OPENAI_* triple directly.
 */
export function syncFromLegacy() {
  const store = getStore()
  const active = store.connections.find(c => c.id === store.activeId)
  if (!active) return
  const key = openaiApiKey()
  if (key && connectionKey(active) !== key) {
    process.env[keyEnvName(active.id)] = key
    upsertEnvVar(keyEnvName(active.id), key)
    active.keyLast4 = key.slice(-4)
  }
  const model = openaiModelName()
  if (model) active.model = model
  const baseUrl = openaiBaseUrl()
  if (baseUrl) active.baseUrl = baseUrl
  active.updatedAt = Date.now()
  writeStore(store)
}

/** Agent model config from the active connection; null when none applies. */
export function resolveConnectionModel() {
  const store = getStore()
  const active = store.connections.find(c => c.id === store.activeId)
  if (!active || !active.model) return null
  const key = connectionKey(active)
  const preset = presetById(active.presetId)
  if (!key && !preset?.noKey) return null
  return {
    id: `openai/${active.model}` as const,
    ...(active.baseUrl ? { url: active.baseUrl } : {}),
    apiKey: key || 'not-needed',
  }
}
