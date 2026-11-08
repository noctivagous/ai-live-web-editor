import type React from 'react'

/**
 * Orderly wrapping button bar: equal grid columns instead of ragged
 * flex flow. Narrow bars wrap 4→2+2 or to a single column while
 * staying aligned. `min` is the column floor in px (tracks grow with
 * wider content and stretch to fill the row); the same value keeps
 * every bar on one system.
 *
 * Usage: <ButtonGrid className="panel-head">…buttons…</ButtonGrid>
 * The grid display wins over the bar classes' own flex rules via the
 * compound selectors on `.btn-grid` in index.css.
 */
export function ButtonGrid({ children, min = 72, className = '', style }: {
  children: React.ReactNode
  min?: number
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      className={`btn-grid${className ? ` ${className}` : ''}`}
      style={{ ...style, '--btn-grid-min': `${min}px` } as React.CSSProperties}
    >
      {children}
    </div>
  )
}
