import type { Express } from 'express'
import fs from 'fs'
import path from 'path'
import { getFsRoot } from './launcher.js'
import { applyStrReplace } from './mastra/tools/fsEdit.js'
import { indexProjectSources } from './mastra/tools/resolveSourceTool.js'
import { resolveSelector } from './sourceMap/resolveSource.js'
import { livePageOp } from './liveTarget.js'
import {
  acceptSketch,
  appendSketchPatch,
  discardSketch,
  getSketchState,
  parseSketchMode,
  setSketchMode,
  snapshotPublic,
  undoLastSketch,
  type SketchPatch,
} from './sketchSession.js'
import { getDeviceTarget, parseDeviceTarget, setDeviceTarget } from './deviceSession.js'

function restoreFailed(result: unknown): string | null {
  if (!result || typeof result !== 'object') return 'restore returned nothing'
  const r = result as Record<string, unknown>
  if (r.ok === false || r.error) return String(r.error || 'restore failed')
  return null
}

export type SketchTranslation = {
  translated: Array<{ selector: string, op: string, file: string }>
  untranslated: Array<{ selector: string, op: string, reason: string }>
}

/**
 * Sketch→source persistence (Rung 0 consumer): translate each patch-log entry
 * into an equivalent `str-replace` edit via the DOM↔source resolver.
 * Only text/class ops carry enough recorded state to translate; everything
 * else is reported, never guessed.
 */
export function translateSketchToSource(): SketchTranslation {
  const report: SketchTranslation = { translated: [], untranslated: [] }
  const files = indexProjectSources(getFsRoot())
  const root = getFsRoot()
  for (const patch of getSketchState().patches) {
    const fail = (reason: string) => report.untranslated.push({ selector: patch.selector, op: patch.op, reason })
    let oldStr: string | null = null
    let newStr: string | null = null
    if (patch.op === 'text') {
      oldStr = patch.before.textContent ?? null
      newStr = patch.after.text ?? null
    } else if (patch.op === 'class') {
      oldStr = patch.before.className ?? null
      newStr = patch.after.className ?? null
    } else {
      fail(`${patch.op} patches are not translatable yet (recorded: text, class)`)
      continue
    }
    if (!oldStr || !newStr || oldStr === newStr) {
      fail(`no before/after ${patch.op} text recorded`)
      continue
    }
    const resolved = resolveSelector(
      { selector: patch.selector, textSnippet: (patch.before.textContent || '').slice(0, 200) },
      files,
    )
    if (!resolved.ok || !resolved.file) {
      fail(resolved.error || 'selector did not resolve to a file')
      continue
    }
    const full = path.resolve(root, '.' + resolved.file)
    if (!full.startsWith(root) || !fs.existsSync(full)) {
      fail(`resolved file not on disk: ${resolved.file}`)
      continue
    }
    const content = fs.readFileSync(full, 'utf-8')
    const result = applyStrReplace(content, oldStr, newStr)
    if (result.ok === false) {
      fail(`str-replace refused in ${resolved.file}: ${result.error}`)
      continue
    }
    fs.writeFileSync(full, result.content, 'utf-8')
    const idx = files.findIndex((f) => f.path === resolved.file)
    if (idx >= 0) files[idx] = { path: resolved.file, content: result.content }
    report.translated.push({ selector: patch.selector, op: patch.op, file: resolved.file })
  }
  return report
}

async function restoreOnPage(patch: SketchPatch) {
  return livePageOp('patch', {
    selector: patch.selector,
    op: 'restore',
    restoreOp: patch.op,
    before: patch.before,
  })
}

function workflowSnapshot() {
  return { ...snapshotPublic(getSketchState()), deviceTarget: getDeviceTarget() }
}

export function mountWorkflowApi(app: Express) {
  app.get('/api/workflow', (_req, res) => {
    res.json(workflowSnapshot())
  })

  app.post('/api/workflow', async (req, res) => {
    try {
      const body = req.body || {}
      const mode = parseSketchMode(body.mode)
      if (mode) setSketchMode(mode)
      const device = parseDeviceTarget(body.deviceTarget)
      if (device) setDeviceTarget(device)
      const action = body.action
      if (action === 'undo') {
        const { undone } = undoLastSketch()
        if (undone) {
          const result = await restoreOnPage(undone)
          const err = restoreFailed(result)
          if (err) {
            appendSketchPatch(undone)
            return res.status(502).json({ ...workflowSnapshot(), restoreError: err })
          }
        }
      } else if (action === 'discard') {
        const { undone } = discardSketch()
        const errors: string[] = []
        for (const patch of undone) {
          const err = restoreFailed(await restoreOnPage(patch))
          if (err) errors.push(`${patch.selector}: ${err}`)
        }
        if (errors.length) {
          return res.status(502).json({ ...workflowSnapshot(), restoreError: errors.join('; ') })
        }
      } else if (action === 'accept') {
        const translation = translateSketchToSource()
        acceptSketch()
        res.json({ ...workflowSnapshot(), translation })
        return
      }
      res.json(workflowSnapshot())
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      res.status(500).json({ ok: false, error: message })
    }
  })
}
