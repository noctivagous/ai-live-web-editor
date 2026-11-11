/**
 * reset-settings (setup polish): return the editor to
 * first-run state so the setup wizard runs again on next
 * launch. The CLI (resetSettingsCli.ts) resolves the paths;
 * this module is the file work, pure fs so it is unit-testable
 * against a scratch directory.
 *
 * What "first-run" means in files: the editor's setup state
 * lives in the app-settings record — a SQLite database whose
 * setupDone/uiPrefs the server is the source of truth for (the
 * browser's copy is only a sync cache), so removing the
 * database (and its -wal/-shm sidecars) is what makes setup run
 * again. The agent settings beside it go too. Provider keys are
 * KEPT by default: providers.json and the key entries in .env
 * are only touched behind the explicit withKeys flag. Project
 * directories, per-project config, and Muse Code's own
 * credential store are never in the target set.
 *
 * Safety: nothing is deleted that was not first copied into a
 * timestamped backup folder beside the settings, and the report
 * names exactly what was backed up, removed, or absent.
 */
import fs from 'node:fs'
import path from 'node:path'

/** The files a reset removes, in order. envDir is the directory
 * beside .env (getEnvPath's directory); dbPath is the
 * app-settings database (settingsDbPath(), or <root>/.ai-live/
 * app-settings.db under an explicit root). providers.json joins
 * the set only with keys. */
export function resetTargetFiles(envDir: string, dbPath: string, withKeys: boolean): string[] {
  const files = [
    path.join(envDir, 'agent-settings.json'),
    dbPath,
    `${dbPath}-wal`,
    `${dbPath}-shm`,
  ]
  if (withKeys) files.push(path.join(envDir, 'providers.json'))
  return files
}

/** An .env assignment name is a key entry when it follows the
 * repo's key conventions: CONN_KEY_* (connection keys) or a
 * *_API_KEY / *_TOKEN / *_SECRET / *_PASSWORD suffix. */
export function isKeyEnvName(name: string): boolean {
  return name.startsWith('CONN_KEY_')
    || name.endsWith('_API_KEY')
    || name.endsWith('_TOKEN')
    || name.endsWith('_SECRET')
    || name.endsWith('_PASSWORD')
}

const ENV_ASSIGN = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/

/** Strip key entries from .env content. Comments, blank lines,
 * and non-key assignments stay, in order. Returns the removed
 * entry NAMES (never values). */
export function scrubEnvContent(content: string): { content: string; removedNames: string[] } {
  const removedNames: string[] = []
  const kept: string[] = []
  for (const line of content.split('\n')) {
    const m = ENV_ASSIGN.exec(line)
    if (m && isKeyEnvName(m[1])) {
      removedNames.push(m[1])
    } else {
      kept.push(line)
    }
  }
  return { content: kept.join('\n'), removedNames }
}

export interface ResetSettingsReport {
  /** Where the copies went (null when nothing existed to back up). */
  backupDir: string | null
  /** Files copied into the backup, in target order. */
  backedUp: string[]
  /** Files deleted after their copy landed. */
  removed: string[]
  /** Targets that did not exist — reported, not an error. */
  absent: string[]
  /** .env key entries scrubbed (--with-keys only). */
  envScrubbedNames: string[]
  /** True when .env exists and was backed up + rewritten. */
  envScrubbed: boolean
}

export function runResetSettings(opts: {
  envDir: string
  dbPath: string
  withKeys: boolean
  /** Backup folder stamp; defaults to the current time. */
  stamp?: string
}): ResetSettingsReport {
  const { envDir, dbPath, withKeys } = opts
  const stamp = opts.stamp ?? new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = path.join(envDir, `settings-backup-${stamp}`)
  const targets = resetTargetFiles(envDir, dbPath, withKeys)
  const envPath = path.join(envDir, '.env')
  const scrubEnv = withKeys && fs.existsSync(envPath)

  const report: ResetSettingsReport = {
    backupDir: null, backedUp: [], removed: [], absent: [], envScrubbedNames: [], envScrubbed: false,
  }

  const anyWork = targets.some((f) => fs.existsSync(f)) || scrubEnv
  if (!anyWork) {
    report.absent = [...targets]
    return report
  }

  fs.mkdirSync(backupDir, { recursive: true })
  report.backupDir = backupDir
  const backupCopy = (file: string) => {
    const dest = path.join(backupDir, path.basename(file))
    fs.copyFileSync(file, dest)
    report.backedUp.push(file)
  }

  for (const file of targets) {
    if (!fs.existsSync(file)) {
      report.absent.push(file)
      continue
    }
    backupCopy(file)
    fs.unlinkSync(file)
    report.removed.push(file)
  }

  if (scrubEnv) {
    backupCopy(envPath)
    const { content, removedNames } = scrubEnvContent(fs.readFileSync(envPath, 'utf8'))
    fs.writeFileSync(envPath, content)
    report.envScrubbedNames = removedNames
    report.envScrubbed = true
  }

  return report
}
