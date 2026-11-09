import type { PageNote, PluginEnsureInfo } from './api'
import type { AnnotationDigest } from './annotationSync'

/**
 * Preview-side annotate state for the LIVE page. The preview iframe
 * is cross-origin, so the editor cannot read the overlay directly
 * the way it does for Static preview: it drives the overlay with
 * postMessage commands and reads state back through the annotation
 * digest (annotationSync). The decisions that don't need the DOM —
 * what to tell the user when the overlay never answers, and how a
 * digest fills the annotation menu — live here so they are testable.
 */

export type HmrState = 'unknown' | 'up' | 'down'

/**
 * Why Annotate can't run on the live page, in plain words for the
 * preview's result line. `ensure` is the launcher's plugin-ensure
 * state (bridge guarantee, slice 1): it distinguishes "the plugin
 * was never added" from "the page simply didn't answer".
 */
export function annotateUnavailableReason(ensure: PluginEnsureInfo | null, hmr: HmrState): string {
  if (hmr === 'down') return 'the live page is not connected — nothing is answering on :5173.'
  switch (ensure?.state) {
    case 'cannot':
      return `the editor plugin is not in this project's vite config${ensure.configFile ? ` (${ensure.configFile})` : ''} — see the notice above the preview for the line to add.`
    case 'missing-declined':
      return 'the editor plugin is off for this project — re-enable it in the notice above the preview.'
    case 'not-vite':
      return 'this project has no live Vite page to annotate.'
    default:
      return 'the live page did not answer — it may still be loading, or the editor plugin is not running in it.'
  }
}

export interface AnnotateMenuFromDigest {
  anns: (PageNote & { id?: string })[]
  /** The digest carries only an abbreviation of the page notes, not
   * the full text; on the live page this is display text only —
   * submitting delegates to the overlay in the page. */
  pageNoteAbbr: string
  pageNotePresent: boolean
  count: number
}

/** Fill the preview's annotation menu from a page digest. */
export function digestToAnnotateMenu(digest: AnnotationDigest): AnnotateMenuFromDigest {
  return {
    anns: digest.annotations.map((a) => {
      const note: PageNote & { id?: string } = { selector: a.selector, text: a.text }
      if (a.id) note.id = a.id
      return note
    }),
    pageNoteAbbr: digest.pageNote.present ? digest.pageNote.abbr : '',
    pageNotePresent: digest.pageNote.present,
    count: digest.annotations.length,
  }
}
