/**
 * UI themes: the design-token definitions behind Settings → Themes.
 *
 * A theme is a named set of token values. index.css carries the same
 * values as CSS custom properties — :root holds dark-2020s, and
 * [data-ui-theme="…"] blocks override them per theme — and this module
 * is the typed mirror the Settings UI renders from (cards, swatches,
 * the token list) plus the one place that applies a choice: setting
 * data-ui-theme and the font-size scale on the document root.
 *
 * Two token layers keep flat vs. shaded a data difference, not a
 * markup difference: color/type tokens (bg, panel, text, font stacks)
 * and effect tokens (panelBg, buttonBg, wellShadow, buttonShadow,
 * highlight). In dark-2020s the effect tokens resolve to flat colors
 * and `none`; the pro themes give them gradients, bevels and inset
 * shadows in the manner of late-2000s professional apps.
 *
 * Slice 1 scope: token-driven surfaces (shell background, panels,
 * buttons, inputs, top bar, scrollbars, all CSS font sizes) respond
 * to a theme; components that still hardcode colors in inline styles
 * keep the dark-2020s values until the token sweep (a later slice).
 */

export type UiThemeId = 'dark-2020s' | 'dark-pro-classic' | 'gray-pro-classic'

export const UI_THEME_IDS: UiThemeId[] = ['dark-2020s', 'dark-pro-classic', 'gray-pro-classic']

export const UI_FONT_SIZE_MIN = 11
export const UI_FONT_SIZE_MAX = 16
export const UI_FONT_SIZE_DEFAULT = 13

/** Token values for one theme. Keys are camelCase; the CSS custom
 * property for a key is the kebab-case form (`cardHover` → `--card-hover`). */
export interface UiThemeTokens {
  bg: string
  panel: string
  card: string
  cardHover: string
  border: string
  borderSoft: string
  text: string
  muted: string
  faint: string
  blue: string
  green: string
  amber: string
  red: string
  well: string
  highlight: string
  panelBg: string
  buttonBg: string
  buttonBgPrimary: string
  wellShadow: string
  buttonShadow: string
  topbarBg: string
  scrollbarThumb: string
  radiusPanel: string
  radiusControl: string
  fontUi: string
}

export interface UiTheme {
  id: UiThemeId
  label: string
  /** Short name of the theme's UI font, shown on its Settings card. */
  fontLabel: string
  description: string
  tokens: UiThemeTokens
}

const SYSTEM_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const PRO_FONT = '"Lucida Grande", "Lucida Sans Unicode", Helvetica, Arial, sans-serif'
const PRO_BLUE_GRADIENT = 'linear-gradient(180deg, #6aa6ff, #4a8af4 45%, #2a5cb0)'

export const UI_THEMES: UiTheme[] = [
  {
    id: 'dark-2020s',
    label: 'Dark 2020s',
    fontLabel: 'System UI',
    description: 'The current look: flat surfaces, soft borders, round pills.',
    tokens: {
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
      well: '#0f0f12',
      highlight: 'rgba(255, 255, 255, 0)',
      panelBg: '#141417',
      buttonBg: '#1a1a1e',
      buttonBgPrimary: '#16283f',
      wellShadow: 'none',
      buttonShadow: 'none',
      topbarBg: 'rgba(12, 12, 14, 0.9)',
      scrollbarThumb: '#23232a',
      radiusPanel: '12px',
      radiusControl: '8px',
      fontUi: SYSTEM_FONT,
    },
  },
  {
    id: 'dark-pro-classic',
    label: 'Dark Pro Classic',
    fontLabel: 'Lucida Grande',
    description: 'Late-2000s pro apps: gradient panels, recessed wells, glossy buttons, higher contrast.',
    tokens: {
      bg: '#121214',
      panel: '#242528',
      card: '#2d2e30',
      cardHover: '#353638',
      border: '#0a0a0b',
      borderSoft: '#1a1a1c',
      text: '#ececec',
      muted: '#a7a9ab',
      faint: '#7a7c7e',
      blue: '#4a8af4',
      green: '#22c55e',
      amber: '#f59e0b',
      red: '#ef4444',
      well: '#0f0f10',
      highlight: 'rgba(255, 255, 255, 0.12)',
      panelBg: 'linear-gradient(180deg, #2d2e30, #1e1f21)',
      buttonBg: 'linear-gradient(180deg, #4a4c4f, #2a2c2f)',
      buttonBgPrimary: PRO_BLUE_GRADIENT,
      wellShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.9), inset 0 0 0 1px rgba(0, 0, 0, 1)',
      buttonShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.18), 0 1px 2px rgba(0, 0, 0, 0.6)',
      topbarBg: 'linear-gradient(180deg, #3a3b3e, #242528)',
      scrollbarThumb: 'linear-gradient(180deg, #3a3b3e, #222326)',
      radiusPanel: '8px',
      radiusControl: '6px',
      fontUi: PRO_FONT,
    },
  },
  {
    id: 'gray-pro-classic',
    label: 'Gray Pro Classic',
    fontLabel: 'Lucida Grande',
    description: 'The same pro shading in a lighter gray, with dark text and near-white wells.',
    tokens: {
      bg: '#6e6e70',
      panel: '#a8a8aa',
      card: '#b2b2b4',
      cardHover: '#bcbcbe',
      border: '#555557',
      borderSoft: '#8a8a8c',
      text: '#1d1d1f',
      muted: '#3f3f42',
      faint: '#5c5c5f',
      blue: '#2a5cb0',
      green: '#15803d',
      amber: '#b45309',
      red: '#dc2626',
      well: '#e9e9e9',
      highlight: 'rgba(255, 255, 255, 0.45)',
      panelBg: 'linear-gradient(180deg, #b8b8ba, #a2a2a4)',
      buttonBg: 'linear-gradient(180deg, #f2f2f2, #c9c9c9)',
      buttonBgPrimary: PRO_BLUE_GRADIENT,
      wellShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.35)',
      buttonShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 1px 2px rgba(0, 0, 0, 0.3)',
      topbarBg: 'linear-gradient(180deg, #c4c4c6, #a8a8aa)',
      scrollbarThumb: 'linear-gradient(180deg, #d8d8d8, #a8a8aa)',
      radiusPanel: '8px',
      radiusControl: '6px',
      fontUi: PRO_FONT,
    },
  },
]

export function themeById(id: string): UiTheme {
  return UI_THEMES.find(t => t.id === id) ?? UI_THEMES[0]
}

export function isUiThemeId(v: unknown): v is UiThemeId {
  return typeof v === 'string' && (UI_THEME_IDS as string[]).includes(v)
}

/** The Monaco theme that matches a UI theme. Monaco ships no pro-app
 * theme; the dark pro theme keeps vs-dark until a custom one is built. */
export function monacoThemeFor(id: UiThemeId): string {
  return id === 'gray-pro-classic' ? 'light' : 'vs-dark'
}

/** The font-size scale factor: 1 at the default size, so the default
 * renders exactly the sizes the CSS was written with. */
export function uiScaleFor(fontSize: number): number {
  return fontSize / UI_FONT_SIZE_DEFAULT
}

/**
 * Apply a theme choice to the document: the data attribute selects
 * the theme's CSS custom properties, and two inline properties carry
 * the font size — --ui-font-size for anything that reads it directly,
 * --ui-scale as the multiplier every CSS font-size is written with.
 * Safe to call outside a browser (no document): it just does nothing.
 */
export function applyUiTheme(theme: UiThemeId, fontSize: number): void {
  try {
    const root = globalThis.document?.documentElement
    if (!root) return
    root.dataset.uiTheme = theme
    root.style.setProperty('--ui-font-size', `${fontSize}px`)
    root.style.setProperty('--ui-scale', String(uiScaleFor(fontSize)))
  } catch { /* non-DOM environment — nothing to apply to */ }
}
