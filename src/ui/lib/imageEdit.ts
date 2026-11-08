/**
 * The base image editor's edit model: the state the normal toolbar
 * manipulates, and the pure helpers that turn it into a canvas
 * render and an output encoding. One editor for every raster
 * format — the format only decides how the result is encoded when
 * it is saved back (whole-file write, via /api/fs/write-binary).
 *
 * SVG is not a raster format: it is vector text, and rasterising
 * it would destroy it. outputFor says so, and the editor shows
 * the SVG with its AI actions only — a vector editor is a
 * different base, for a later slice.
 */

export interface ImageEditState {
  /** Clockwise degrees: 0 | 90 | 180 | 270. */
  rotate: number
  flipH: boolean
  flipV: boolean
  /** Percentages, 100 = unchanged. */
  brightness: number
  contrast: number
  saturation: number
  /** Output size in px; null = natural size (after rotation). */
  width: number | null
  height: number | null
}

export const DEFAULT_IMAGE_EDIT: ImageEditState = {
  rotate: 0, flipH: false, flipV: false,
  brightness: 100, contrast: 100, saturation: 100,
  width: null, height: null,
}

/** The CSS/canvas filter string for the adjustment sliders. */
export function filterFor(state: ImageEditState): string {
  return `brightness(${state.brightness / 100}) contrast(${state.contrast / 100}) saturate(${state.saturation / 100})`
}

export function isIdentityEdit(state: ImageEditState): boolean {
  return state.rotate === 0 && !state.flipH && !state.flipV
    && state.brightness === 100 && state.contrast === 100 && state.saturation === 100
    && state.width === null && state.height === null
}

/** Canvas dimensions for a source of w×h under the state's rotation. */
export function outputDims(naturalW: number, naturalH: number, state: ImageEditState): { width: number; height: number } {
  const swapped = state.rotate === 90 || state.rotate === 270
  const baseW = swapped ? naturalH : naturalW
  const baseH = swapped ? naturalW : naturalH
  if (state.width === null && state.height === null) return { width: baseW, height: baseH }
  if (state.width !== null && state.height === null) {
    return { width: state.width, height: Math.max(1, Math.round(baseH * (state.width / baseW))) }
  }
  if (state.width === null && state.height !== null) {
    return { width: Math.max(1, Math.round(baseW * (state.height / baseH))), height: state.height }
  }
  return { width: state.width!, height: state.height! }
}

export interface ImageOutput {
  /** Canvas mime type to encode as, when saving in place is honest. */
  mime: string | null
  canSave: boolean
  /** Why not, when canSave is false — shown on the disabled Save. */
  reason?: string
  /** True for vector text (SVG): the raster tools do not apply. */
  vector?: boolean
}

const RASTER_SAVE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export function outputForPath(path: string): ImageOutput {
  const ext = (path.split('.').pop() || '').toLowerCase()
  if (ext === 'svg') {
    return { mime: null, canSave: false, vector: true, reason: 'SVG is vector text — raster tools would destroy it. Edit it as text, or use the AI actions.' }
  }
  const mime = RASTER_SAVE[ext]
  if (mime) return { mime, canSave: true }
  return { mime: null, canSave: false, reason: `Saving edited ${ext || 'image'} files in place isn't supported — PNG, JPEG and WebP are.` }
}
