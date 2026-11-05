import type { CSSProperties } from 'react'

/** Deck design tokens (mirrors :root in index.css) for dynamic inline styles. */
export const theme = {
  bg: '#0e0e10',
  panel: '#141417',
  card: '#1a1a1e',
  cardHover: '#1f1f24',
  border: '#26262c',
  borderSoft: '#1e1e23',
  text: '#e4e4e7',
  muted: '#a1a1aa',
  faint: '#71717a',
  blue: '#3b82f6',
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
} as const

export type PillTone = 'ok' | 'good' | 'bad' | 'warn' | undefined

export const btn: CSSProperties = {
  background: theme.card,
  border: `1px solid ${theme.border}`,
  color: theme.text,
  borderRadius: 8,
  padding: '7px 11px',
  fontSize: 12.5,
  fontWeight: 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

export const btnPrimary: CSSProperties = {
  ...btn,
  background: '#16283f',
  borderColor: '#2a4a6f',
  color: '#dbeafe',
}

export const SETUP_DONE_KEY = 'ai-live-editor.setupDone'
export const SETUP_DONE_VALUE = 'v1'

export const PANE_KEY = 'ai-live-editor.panes'
export const EDITOR_THEME_KEY = 'ai-live-editor.editorTheme'
