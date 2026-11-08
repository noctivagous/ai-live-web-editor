/**
 * App settings in SQL: the device-scope settings (UI prefs incl. theme,
 * Monaco theme, setup flag) live in a server-side SQLite database instead
 * of only the browser's localStorage. localStorage stays as a validated
 * sync cache so reads stay synchronous; this module is the source of
 * truth both sides converge on.
 *
 * The store is its own file (.ai-live/app-settings.db), not a table in
 * mastra.db — Mastra owns that schema, and settings must never contend
 * with agent memory migrations. One key-value table, three known keys.
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateUiPrefs, type UiPrefs } from './ui/lib/uiPrefs.js'

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export interface AppSettings {
  uiPrefs: UiPrefs | null
  editorTheme: string | null
  setupDone: boolean | null
}

const EMPTY: AppSettings = { uiPrefs: null, editorTheme: null, setupDone: null }

/** Override the file location with AI_LIVE_SETTINGS (plain path). */
export function settingsDbPath(): string {
  const override = process.env.AI_LIVE_SETTINGS
  if (override) return path.resolve(override)
  return path.join(PKG_ROOT, '.ai-live', 'app-settings.db')
}

export interface SettingsStore {
  get(): AppSettings
  save(patch: { uiPrefs?: unknown, editorTheme?: unknown, setupDone?: unknown }): AppSettings
  clear(): void
}

export function createSettingsStore(dbPath: string): SettingsStore {
  if (dbPath !== ':memory:') {
    try { fs.mkdirSync(path.dirname(dbPath), { recursive: true }) } catch { /* open surfaces real errors */ }
  }
  const db = new DatabaseSync(dbPath)
  db.exec('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')

  const readAll = (): AppSettings => {
    const out: AppSettings = { ...EMPTY }
    try {
      const rows = db.prepare('SELECT key, value FROM app_settings').all() as { key: string, value: string }[]
      for (const r of rows) {
        if (r.key === 'uiPrefs') {
          try { out.uiPrefs = validateUiPrefs(JSON.parse(r.value)) } catch { /* corrupt: treat as unset */ }
        } else if (r.key === 'editorTheme') {
          if (r.value) out.editorTheme = r.value
        } else if (r.key === 'setupDone') {
          out.setupDone = r.value === '1'
        }
      }
    } catch { /* unreadable store reads as empty */ }
    return out
  }

  const write = (key: string, value: string): void => {
    db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  return {
    get: readAll,
    save(patch) {
      const current = readAll()
      if (patch.uiPrefs !== undefined && patch.uiPrefs !== null) {
        const merged = validateUiPrefs({
          ...(current.uiPrefs ?? {}),
          ...((patch.uiPrefs && typeof patch.uiPrefs === 'object' ? patch.uiPrefs : {}) as Record<string, unknown>),
        })
        write('uiPrefs', JSON.stringify(merged))
      }
      if (typeof patch.editorTheme === 'string' && patch.editorTheme && patch.editorTheme.length <= 120) {
        write('editorTheme', patch.editorTheme)
      }
      if (typeof patch.setupDone === 'boolean') {
        write('setupDone', patch.setupDone ? '1' : '0')
      }
      return readAll()
    },
    clear() {
      db.exec('DELETE FROM app_settings')
    },
  }
}

let singleton: SettingsStore | null = null

/** The server's shared store (tests build their own via createSettingsStore). */
export function appSettings(): SettingsStore {
  if (!singleton) singleton = createSettingsStore(settingsDbPath())
  return singleton
}

/* Device-scope app settings in server-side SQL — the source of truth
 * the browsers' localStorage copies converge on. Reads validate, so a
 * corrupt row surfaces as unset rather than breaking a pane. */
export function mountAppSettingsApi(app: {
  get(path: string, handler: (req: { body?: unknown }, res: { json(o: unknown): void, status(c: number): { json(o: unknown): void } }) => void): void
  put(path: string, handler: (req: { body?: unknown }, res: { json(o: unknown): void, status(c: number): { json(o: unknown): void } }) => void): void
}): void {
  app.get('/api/app-settings', (_req, res) => {
    try {
      res.json({ ok: true, ...appSettings().get() })
    } catch (e: unknown) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'settings store unavailable' })
    }
  })

  app.put('/api/app-settings', (req, res) => {
    try {
      res.json({ ok: true, ...appSettings().save(req.body || {}) })
    } catch (e: unknown) {
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : 'invalid settings patch' })
    }
  })
}
