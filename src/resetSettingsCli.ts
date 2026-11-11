/**
 * Reset-settings CLI — `npm run reset-settings [-- --with-keys] [-- --root <dir>]`.
 *
 * Returns the editor to first-run state so the setup wizard
 * runs again on next launch. Default run clears the agent
 * settings and the app-settings database — the server record
 * the editor reads its setup state (setupDone / preferences)
 * from; the browser's copy is only a sync cache, so removing
 * the server record is what makes setup run again. Provider
 * keys are KEPT unless --with-keys is passed. Everything
 * removed is copied into a timestamped settings-backup-<stamp>
 * folder beside the settings first, and the run prints exactly
 * what was backed up, removed, or absent.
 *
 * --root <dir> points the whole run at another settings
 * directory (its .env sits at <dir>/.env, its database at
 * <dir>/.ai-live/app-settings.db) — for testing against a
 * scratch directory. Without it, AI_LIVE_SETTINGS is honoured
 * for the database path, as everywhere else.
 */
import path from 'node:path'
import { settingsDbPath } from './appSettings.js'
import { getEnvPath } from './env.js'
import { runResetSettings } from './resetSettings.js'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const withKeys = process.argv.includes('--with-keys')
const root = arg('root')
const envDir = root ? path.resolve(root) : path.dirname(getEnvPath())
const dbPath = root ? path.join(envDir, '.ai-live', 'app-settings.db') : settingsDbPath()

console.log(`Reset the editor's settings in ${envDir}`)
console.log('This clears the global settings so setup runs again: agent-settings.json and the')
console.log('app-settings database (the server record for setup state — the browser copy is a')
console.log('cache, so removing the server record is what matters). Project folders and Muse')
console.log("Code's own sign-in are not touched.")
if (withKeys) {
  console.log('')
  console.log('!! --with-keys: provider keys are cleared too — providers.json is removed and the')
  console.log('!! key entries (CONN_KEY_*, *_API_KEY, *_TOKEN, *_SECRET, *_PASSWORD) are scrubbed')
  console.log('!! from .env. Connections will need their keys re-entered afterwards.')
}

const report = runResetSettings({ envDir, dbPath, withKeys })

if (report.backupDir) {
  console.log(`\nBacked up to ${report.backupDir}:`)
  for (const f of report.backedUp) console.log(`  ${f}`)
}
if (report.removed.length) {
  console.log('Removed:')
  for (const f of report.removed) console.log(`  ${f}`)
}
if (report.envScrubbed) {
  console.log(`Scrubbed ${report.envScrubbedNames.length} key ${report.envScrubbedNames.length === 1 ? 'entry' : 'entries'} from .env: ${report.envScrubbedNames.join(', ')}`)
} else if (!withKeys) {
  console.log('Provider keys kept: providers.json and .env are untouched (pass --with-keys to clear them).')
}
if (report.absent.length) {
  console.log('Absent (nothing to do):')
  for (const f of report.absent) console.log(`  ${f}`)
}
console.log('\nRestart the editor and setup will run from the beginning.')
