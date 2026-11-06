/**
 * P0-b verify gate: pure decision logic (host gate, not model memory).
 * After a Files turn that wrote files, the host re-checks layout geometry
 * and console errors itself and folds NEW findings back into the turn.
 */

export type LayoutFinding = {
  key: string
  kind: string
  detail: string
  width?: number
}

export type ConsoleEntry = {
  seq: number
  level: string
  text: string
  stack?: string
  url?: string
  ts?: number
}

/** Gate trigger: a Files-mode turn whose tool trace wrote files. */
export function shouldTriggerGate(mode: string, toolNames: string[]): boolean {
  if (mode !== 'files') return false
  return toolNames.some((n) => n === 'str-replace' || n === 'write-real-file')
}

/**
 * Key a layout overlap/clipping finding from the snapshot analysis shape.
 * Overlap pairs carry a/b stableIds; clipping carries target/clippedBy;
 * overflow offenders carry stableId + axis.
 */
export function findingKey(f: Record<string, unknown>, width?: number): string {
  const parts: string[] = []
  const a = f.a
  const b = f.b
  if (typeof a === 'string' && typeof b === 'string') parts.push(`overlap:${[a, b].sort().join('|')}`)
  if (typeof f.target === 'string') parts.push(`clip:${f.target}->${String(f.clippedBy || '?')}`)
  if (typeof f.stableId === 'string' && (f.axis || f.right !== undefined || f.bottom !== undefined)) {
    parts.push(`overflow:${f.stableId}:${String(f.axis || (f.right !== undefined ? 'x' : 'y'))}`)
  }
  if (!parts.length) parts.push(`misc:${JSON.stringify(f).slice(0, 120)}`)
  if (width !== undefined) parts.push(`@${width}`)
  return parts.join(' ')
}

export function toLayoutFindings(
  analysis: Record<string, unknown> | null | undefined,
  width?: number,
): LayoutFinding[] {
  if (!analysis || typeof analysis !== 'object') return []
  const out: LayoutFinding[] = []
  const push = (kind: string, list: unknown) => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const f = item as Record<string, unknown>
      out.push({ key: findingKey(f, width), kind, detail: JSON.stringify(f).slice(0, 300), width })
    }
  }
  push('overlap', analysis.overlaps ?? analysis.overlapping)
  push('clipping', analysis.clippings ?? analysis.clipped)
  push('overflow', analysis.overflowXOffenders ?? analysis.overflow)
  return out
}

/** New-only diff: findings whose key was absent at baseline. */
export function diffFindings(before: LayoutFinding[], after: LayoutFinding[]): LayoutFinding[] {
  const base = new Set(before.map((f) => f.key))
  return after.filter((f) => !base.has(f.key))
}

/** Console signal: entries at/after the baseline seq that look like failures. */
export function consoleFindings(entries: ConsoleEntry[], sinceSeq: number): ConsoleEntry[] {
  return entries.filter(
    (e) =>
      e.seq > sinceSeq &&
      (e.level === 'error' || e.level === 'pageerror' || e.level === 'warn') &&
      !/^\s*$/.test(e.text || ''),
  )
}

export function formatGatePrompt(args: {
  layout: LayoutFinding[]
  console: ConsoleEntry[]
  unverified: string[]
}): string {
  const lines = [
    'Automatic verification found new issues after your edits. Fix each one or explicitly waive it with a one-line reason.',
  ]
  if (args.layout.length) {
    lines.push('Layout (new since before your edits):')
    for (const f of args.layout.slice(0, 12)) {
      lines.push(`- [${f.kind}${f.width ? ` @${f.width}px` : ''}] ${f.detail}`)
    }
    if (args.layout.length > 12) lines.push(`- …and ${args.layout.length - 12} more (see layout-snapshot)`)
  }
  if (args.console.length) {
    lines.push('Console (new since before your edits):')
    for (const e of args.console.slice(0, 12)) {
      lines.push(`- [${e.level}] ${e.text.slice(0, 220)}`)
    }
    if (args.console.length > 12) lines.push(`- …and ${args.console.length - 12} more (see get-console)`)
  }
  if (args.unverified.length) {
    lines.push('Could not verify (treat as unverified, not clean):')
    for (const u of args.unverified) lines.push(`- ${u}`)
  }
  lines.push('Use resolve-source / layout-snapshot / get-console to investigate, then str-replace the fix.')
  return lines.join('\n')
}
