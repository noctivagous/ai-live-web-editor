export interface Panes { leftW: number, rightW: number, previewH: number }

export const PANE_DEFAULTS: Panes = { leftW: 220, rightW: 360, previewH: 42 }

const MIN_SIDE = 140
const MIN_MID = 280
const CHROME = 64

export function clampPanes(p: Panes, viewportW: number): Panes {
  let leftW = Math.min(600, Math.max(MIN_SIDE, p.leftW))
  let rightW = Math.min(600, Math.max(MIN_SIDE, p.rightW))
  const previewH = Math.min(85, Math.max(10, p.previewH))
  const maxSides = Math.max(MIN_SIDE * 2, viewportW - CHROME - MIN_MID)
  if (leftW + rightW > maxSides) {
    const scale = maxSides / (leftW + rightW)
    leftW = Math.max(MIN_SIDE, Math.round(leftW * scale))
    rightW = Math.max(MIN_SIDE, Math.round(rightW * scale))
  }
  return { leftW, rightW, previewH }
}
