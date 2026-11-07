/**
 * Shared Mastra storage: ONE LibSQLStore instance for the whole editor.
 *
 * The Mastra instance and the agent's Memory must open the same store —
 * two LibSQLStore instances on one file would race their schema setup
 * and split the data. Everything imports `mastraStorage` from here;
 * nobody constructs their own.
 */
import { LibSQLStore } from '@mastra/libsql'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Durable local store (gitignored `.ai-live/` at the editor root — one
 * store per editor install, NOT per project; projects are separated by
 * thread, see chatMemory.ts). Without this Mastra falls back to an
 * in-memory store and warns on every agent call. Override the file
 * location with AI_LIVE_STORAGE (a `file:` URL or plain path). */
export function storageUrl(): string {
  const override = process.env.AI_LIVE_STORAGE
  if (override) return override.startsWith('file:') ? override : `file:${path.resolve(override)}`
  return `file:${path.join(PKG_ROOT, '.ai-live', 'mastra.db')}`
}

/** Ensure the store file's directory exists (libsql won't create parents). */
function ensureStorageDir(url: string): void {
  try {
    const file = url.startsWith('file:') ? url.slice('file:'.length) : url
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  } catch { /* store construction will surface real errors */ }
}

const storeUrl = storageUrl()
ensureStorageDir(storeUrl)

export const mastraStorage = new LibSQLStore({ id: 'ai-live-editor', url: storeUrl })
