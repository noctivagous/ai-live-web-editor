import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Raw overlay script source (plain JS, dependency-free). */
export function loadOverlaySource(): string {
  return fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf-8')
}

/** Install the overlay into a Playwright pool page. Idempotent. */
export async function installAnnotationOverlay(page: any): Promise<{ installed: boolean; alreadyInstalled?: boolean }> {
  const already = await page.evaluate(() => Boolean((window as any).__AI_LIVE_EDIT__?.installed)).catch(() => false)
  if (already) return { installed: true, alreadyInstalled: true }
  await page.addScriptTag({ content: loadOverlaySource() })
  const installed = await page.evaluate(() => Boolean((window as any).__AI_LIVE_EDIT__?.installed)).catch(() => false)
  return { installed: Boolean(installed) }
}

/** Read overlay state from a pool page. */
export async function exportAnnotationsFromPage(page: any): Promise<{ annotations: any[]; pageNotes: string }> {
  const result = await page.evaluate(() => {
    const api = (window as any).__AI_LIVE_EDIT__
    if (!api) return { annotations: [], pageNotes: '', available: false }
    return {
      annotations: Array.isArray(api.exportAnnotations?.()) ? api.exportAnnotations() : [],
      pageNotes: typeof api.getPageNotes === 'function' ? api.getPageNotes() : '',
      available: true,
    }
  })
  return { annotations: result?.annotations ?? [], pageNotes: result?.pageNotes ?? '' }
}

/** Export annotations and clear them (submit semantics). */
export async function collectAnnotationsFromPage(page: any): Promise<{ annotations: any[]; pageNotes: string }> {
  const out = await exportAnnotationsFromPage(page)
  await page.evaluate(() => { (window as any).__AI_LIVE_EDIT__?.clearAll?.() }).catch(() => {})
  return out
}

/** Push annotations into a pool page (so the agent sees the user's notes where it works). */
export async function importAnnotationsToPage(page: any, annotations: any[]): Promise<boolean> {
  return await page.evaluate((anns: any[]) => {
    const api = (window as any).__AI_LIVE_EDIT__
    if (!api?.importAnnotations) return false
    return api.importAnnotations(anns)
  }, annotations).catch(() => false)
}

/** Stash a baseline wireframe JSON on the page for later diffing. */
export async function setBaselineOnPage(page: any, wireframeJson: string): Promise<void> {
  await page.evaluate((json: string) => {
    const api = (window as any).__AI_LIVE_EDIT__
    if (api) api.baselineWireframeJson = json
    else (window as any).__AI_LIVE_EDIT_BASELINE__ = { wireframeJson: json }
  }, wireframeJson).catch(() => {})
}
