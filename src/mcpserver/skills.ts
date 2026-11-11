/**
 * ALE's skills for the Muse Code path (design §12, slice 6),
 * delivered the way the spike found discovery actually works
 * (spike item 5): there is NO register-by-reference — discovery
 * reads fixed roots only. So ALE's skills are INSTALLED:
 * `muse skills install` copies each skill into the Muse
 * config skills root with Muse's own content-hash provenance,
 * and ALE keeps a manifest of what it installed (name → content
 * hash) beside its agent settings, so installs are idempotent
 * and updates ride `--force` only when the content changed.
 * (This replaces §12's draft wording, which assumed
 * registration by reference; the intent — ALE's skills,
 * versioned with ALE, discoverable by every trusted session —
 * is unchanged.)
 *
 * Installs happen lazily on the first Muse Code turn of the
 * process (ensureAleSkillsInstalled), never at editor startup:
 * a machine without the binary, or a user on another engine,
 * is never touched. Failures are recorded, never thrown into a
 * turn.
 */
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAgentSettingsPath } from '../agentSettings.js'
import { getMuseCodeAvailability } from '../musecode/availability.js'

export interface AleSkillInfo {
  name: string
  sourceDir: string
  hash: string
  description: string
}

export type SkillInstallAction = 'installed' | 'updated' | 'unchanged' | 'adopted' | 'failed' | 'skipped'

export interface SkillInstallRecord {
  name: string
  action: SkillInstallAction
  hash: string
  detail?: string
  at: string
}

const SKILLS_SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'skills')

function skillDescription(md: string): string {
  const m = md.match(/^description:\s*(.+)$/m)
  return m ? m[1].trim() : ''
}

/** ALE's shipped skills for this path, read from the bundled
 * skills directory. A directory without a SKILL.md is not a
 * skill and is ignored. */
export function listAleSkills(srcDir: string = SKILLS_SRC): AleSkillInfo[] {
  let entries: string[] = []
  try { entries = fs.readdirSync(srcDir) } catch { return [] }
  const out: AleSkillInfo[] = []
  for (const name of entries.sort()) {
    const dir = path.join(srcDir, name)
    const mdPath = path.join(dir, 'SKILL.md')
    try {
      const md = fs.readFileSync(mdPath, 'utf-8')
      out.push({
        name,
        sourceDir: dir,
        hash: crypto.createHash('sha256').update(md).digest('hex').slice(0, 16),
        description: skillDescription(md),
      })
    } catch { /* not a skill directory */ }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Manifest: what ALE installed, by content hash                       */
/* ------------------------------------------------------------------ */

export function aleSkillsManifestPath(): string {
  return path.join(path.dirname(getAgentSettingsPath()), 'ale-musecode-skills.json')
}

function readManifest(): Record<string, { hash: string; at: string }> {
  try {
    const raw = JSON.parse(fs.readFileSync(aleSkillsManifestPath(), 'utf-8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch { return {} }
}

function writeManifest(m: Record<string, { hash: string; at: string }>): void {
  try {
    fs.mkdirSync(path.dirname(aleSkillsManifestPath()), { recursive: true })
    fs.writeFileSync(aleSkillsManifestPath(), JSON.stringify(m, null, 2), 'utf-8')
  } catch { /* a read-only settings dir must not break installs' reporting */ }
}

/* ------------------------------------------------------------------ */
/* Install                                                             */
/* ------------------------------------------------------------------ */

export type SkillInstallRunner = (binPath: string, args: string[]) => Promise<{ stdout: string; stderr: string }>

const defaultRunner: SkillInstallRunner = (binPath, args) => new Promise((resolve) => {
  execFile(binPath, args, { timeout: 30_000 }, (err, stdout, stderr) => {
    // A non-zero exit still carries the JSON verdict on stdout
    // (e.g. skill-already-installed); the caller parses it.
    resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || (err ? err.message : '') })
  })
})

function parseInstallOutcome(stdout: string): { ok: boolean; code?: string; message?: string } {
  try {
    const j = JSON.parse(stdout) as any
    if (j?.installed) return { ok: true }
    if (j?.error) return { ok: false, code: String(j.error.code ?? ''), message: String(j.error.message ?? 'install failed') }
  } catch { /* fall through */ }
  return { ok: false, message: stdout.slice(0, 200) || 'install produced no verdict' }
}

/**
 * Install (or update) every ALE skill whose content hash
 * differs from the manifest. Idempotent: unchanged skills are
 * not re-installed, and a skill Muse already has (manifest
 * lost) is adopted, not fought. Never throws.
 */
export async function installAleSkills(runner: SkillInstallRunner = defaultRunner): Promise<SkillInstallRecord[]> {
  const at = new Date().toISOString()
  const skills = listAleSkills()
  const availability = await getMuseCodeAvailability().catch(() => null)
  if (!availability?.available || !availability.binPath) {
    return skills.map((s) => ({ name: s.name, action: 'skipped' as const, hash: s.hash, detail: 'Muse Code is not installed on this machine.', at }))
  }
  const manifest = readManifest()
  const records: SkillInstallRecord[] = []
  for (const skill of skills) {
    const prev = manifest[skill.name]
    if (prev?.hash === skill.hash) {
      records.push({ name: skill.name, action: 'unchanged', hash: skill.hash, at })
      continue
    }
    const args = ['skills', 'install', skill.sourceDir, '--json', ...(prev ? ['--force'] : [])]
    const { stdout } = await runner(availability.binPath, args)
    const outcome = parseInstallOutcome(stdout)
    if (outcome.ok) {
      manifest[skill.name] = { hash: skill.hash, at }
      records.push({ name: skill.name, action: prev ? 'updated' : 'installed', hash: skill.hash, at })
    } else if (outcome.code === 'skill-already-installed' && !prev) {
      // Muse already has it (an earlier install whose manifest
      // was lost): adopt it at the current hash.
      manifest[skill.name] = { hash: skill.hash, at }
      records.push({ name: skill.name, action: 'adopted', hash: skill.hash, detail: outcome.message, at })
    } else {
      records.push({ name: skill.name, action: 'failed', hash: skill.hash, detail: outcome.message, at })
    }
  }
  writeManifest(manifest)
  return records
}

let ensurePromise: Promise<SkillInstallRecord[]> | null = null
let lastRecords: SkillInstallRecord[] = []
let runnerOverride: SkillInstallRunner | null = null

/** Test hook (the setMusecodeSpawner pattern): replace the
 * install runner so pipe-level tests don't shell out to the
 * real CLI, and drop the memoised pass. */
export function setAleSkillInstallRunner(next: SkillInstallRunner | null): void {
  runnerOverride = next
  ensurePromise = null
  lastRecords = []
}

/** Process-memoised lazy install for the chat path: the first
 * call runs the installs; later calls return the same promise.
 * Records are kept for status surfaces; failures never throw. */
export function ensureAleSkillsInstalled(): Promise<SkillInstallRecord[]> {
  if (!ensurePromise) {
    ensurePromise = installAleSkills(runnerOverride ?? undefined)
      .then((records) => {
        lastRecords = records
        const changed = records.filter((r) => r.action === 'installed' || r.action === 'updated' || r.action === 'adopted')
        if (changed.length) console.log(`[musecode] ALE skills ${changed.map((r) => `${r.name}:${r.action}`).join(', ')}`)
        const failed = records.filter((r) => r.action === 'failed')
        for (const f of failed) console.log(`[musecode] ALE skill ${f.name} install failed: ${f.detail ?? ''}`)
        return records
      })
      .catch((e) => {
        console.log('[musecode] ALE skill install pass failed:', e?.message || e)
        return []
      })
  }
  return ensurePromise
}

export function aleSkillInstallRecords(): SkillInstallRecord[] {
  return [...lastRecords]
}

/** Test hook: forget the memoised install pass. */
export function resetAleSkillInstall(): void {
  ensurePromise = null
  lastRecords = []
}
