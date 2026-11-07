import type { CSSProperties } from 'react'

/**
 * Theme tokens for dynamic inline styles. The values are CSS custom
 * properties (defined per theme in index.css, sourced from
 * lib/themes.ts), so inline styles follow the selected UI theme and
 * the UI font-size scale just like the stylesheet does.
 */
export const theme = {
  bg: 'var(--bg)',
  panel: 'var(--panel)',
  card: 'var(--card)',
  cardHover: 'var(--card-hover)',
  border: 'var(--border)',
  borderSoft: 'var(--border-soft)',
  text: 'var(--text)',
  muted: 'var(--muted)',
  faint: 'var(--faint)',
  blue: 'var(--blue)',
  green: 'var(--green)',
  amber: 'var(--amber)',
  red: 'var(--red)',
} as const

export type PillTone = 'ok' | 'good' | 'bad' | 'warn' | undefined

export const btn: CSSProperties = {
  background: theme.card,
  border: `1px solid ${theme.border}`,
  color: theme.text,
  borderRadius: 8,
  padding: '7px 11px',
  fontSize: 'calc(12.5px * var(--ui-scale, 1))',
  fontWeight: 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

export const btnPrimary: CSSProperties = {
  ...btn,
  background: 'var(--button-bg-primary)',
  borderColor: 'var(--accent-soft-border)',
  color: 'var(--on-primary)',
}

export const SETUP_DONE_KEY = 'ai-live-editor.setupDone'
export const SETUP_DONE_VALUE = 'v1'

export const PANE_KEY = 'ai-live-editor.panes'
export const EDITOR_THEME_KEY = 'ai-live-editor.editorTheme'
