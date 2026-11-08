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
 * Slice 1 made the shell token-driven (panels, buttons, inputs, top
 * bar, scrollbars, all CSS font sizes). Slice 2 extended the token
 * set (text shades, strong borders, accent-soft and status text,
 * overlay, segmented-control and header effects) and converted the
 * remaining stylesheet surfaces — Settings, menus, dialogs, chat and
 * deck cards, panel view, file tree. Components that still hardcode
 * colors in TSX inline styles keep the dark-2020s values until the
 * inline-style sweep (slice 3).
 */

export type UiThemeId = 'dark-2020s' | 'dark-pro-classic' | 'gray-pro-classic' | 'light-gray-2020s' | 'lightgray-2020s-regular'

export const UI_THEME_IDS: UiThemeId[] = ['dark-2020s', 'dark-pro-classic', 'gray-pro-classic', 'light-gray-2020s', 'lightgray-2020s-regular']

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
  /** Slice-2 tokens: the shades the chrome CSS used to hardcode. */
  textStrong: string
  textSoft: string
  borderStrong: string
  accentSoftBg: string
  accentSoftBorder: string
  accentSoftText: string
  redText: string
  greenText: string
  amberText: string
  violet: string
  overlayBg: string
  segBg: string
  segShadow: string
  headBg: string
  onPrimary: string
  /**
   * Function-button wash: the style for buttons that DO things (New
   * file, Refresh, Marked/Follow…) as opposed to buttons that switch
   * the loaded view in a pane. An accent-tinted surface in every
   * theme so actions read as actions wherever they appear.
   */
  buttonFunctionBg: string
  buttonFunctionBorder: string
  buttonFunctionText: string
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
const TAHOMA_FONT = 'Tahoma, "Segoe UI", Verdana, Geneva, sans-serif'
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
      textStrong: '#fafafa',
      textSoft: '#c9c9d1',
      borderStrong: '#34343e',
      accentSoftBg: '#0f172a',
      accentSoftBorder: '#1e293b',
      accentSoftText: '#bfdbfe',
      redText: '#fca5a5',
      greenText: '#86efac',
      amberText: '#fde68a',
      violet: '#a78bfa',
      overlayBg: 'rgba(8, 8, 10, 0.72)',
      segBg: 'transparent',
      segShadow: 'none',
      headBg: 'linear-gradient(180deg, #17171c, #141418)',
      onPrimary: '#dbeafe',
      buttonFunctionBg: '#122639',
      buttonFunctionBorder: '#2c4a6f',
      buttonFunctionText: '#d6e7ff',
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
      textStrong: '#ffffff',
      textSoft: '#d6d6d6',
      borderStrong: '#000000',
      accentSoftBg: 'rgba(74, 138, 244, 0.16)',
      accentSoftBorder: '#2a5cb0',
      accentSoftText: '#bfdcff',
      redText: '#fca5a5',
      greenText: '#86efac',
      amberText: '#fde68a',
      violet: '#c4b5fd',
      overlayBg: 'rgba(5, 5, 6, 0.72)',
      segBg: '#0f0f10',
      segShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.9)',
      headBg: 'linear-gradient(180deg, #3a3b3e, #2a2b2e)',
      onPrimary: '#ffffff',
      buttonFunctionBg: '#1d2f45',
      buttonFunctionBorder: '#33507a',
      buttonFunctionText: '#e8f1ff',
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
      textStrong: '#000000',
      textSoft: '#333336',
      borderStrong: '#4a4a4c',
      accentSoftBg: 'rgba(42, 92, 176, 0.14)',
      accentSoftBorder: '#2a5cb0',
      accentSoftText: '#1e40af',
      redText: '#7f1d1d',
      greenText: '#14532d',
      amberText: '#92400e',
      violet: '#5b21b6',
      overlayBg: 'rgba(38, 38, 40, 0.5)',
      segBg: '#e9e9e9',
      segShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.35)',
      headBg: 'linear-gradient(180deg, #c4c4c6, #a8a8aa)',
      onPrimary: '#ffffff',
      buttonFunctionBg: '#bccadd',
      buttonFunctionBorder: '#7d94b5',
      buttonFunctionText: '#1e3a5f',
    },
  },
  {
    // The Agent Actions prototype's palette, token for token: its
    // --chrome is the frame the panes sit on (bg + topbar), --chrome2
    // its toolbar tone (panel heads), --panel/--panel2 the pane and
    // segmented surfaces, --field the raised white of cards and
    // wells, --accent-soft the hover of its menu and action cards,
    // and its .scrim the overlay. Its status soft-backgrounds and
    // drop shadow have no token here (status surfaces use the text
    // tokens; menu/dialog shadows are still hardcoded in the CSS).
    id: 'light-gray-2020s',
    label: 'Light Gray 2020s',
    fontLabel: 'Tahoma',
    description: 'The Agent Actions prototype\u2019s look, matched exactly: warm light-gray chrome, near-white panels, white fields.',
    tokens: {
      bg: '#dcd9d0',
      panel: '#f6f5f1',
      card: '#ffffff',
      cardHover: '#dbe6f7',
      border: '#b9b5aa',
      borderSoft: '#cdc9bd',
      text: '#1d1d1b',
      muted: '#4c4a44',
      faint: '#76736a',
      blue: '#2f5aa6',
      green: '#2e7d46',
      amber: '#9a6a12',
      red: '#b3362b',
      well: '#ffffff',
      highlight: 'rgba(255, 255, 255, 0)',
      panelBg: '#f6f5f1',
      buttonBg: '#f6f5f1',
      buttonBgPrimary: '#2f5aa6',
      wellShadow: 'none',
      buttonShadow: 'none',
      topbarBg: '#dcd9d0',
      scrollbarThumb: '#cfcbc0',
      radiusPanel: '10px',
      radiusControl: '6px',
      fontUi: TAHOMA_FONT,
      textStrong: '#1d1d1b',
      textSoft: '#4c4a44',
      borderStrong: '#b9b5aa',
      accentSoftBg: '#dbe6f7',
      accentSoftBorder: '#2f5aa6',
      accentSoftText: '#2f5aa6',
      redText: '#b3362b',
      greenText: '#2e7d46',
      amberText: '#9a6a12',
      violet: '#6a5aa8',
      overlayBg: 'rgba(15, 15, 12, 0.5)',
      segBg: '#efeee8',
      segShadow: 'none',
      headBg: '#cfcbc0',
      onPrimary: '#ffffff',
      buttonFunctionBg: '#dde7f3',
      buttonFunctionBorder: '#a9bed6',
      buttonFunctionText: '#1e3a5f',
    },
  },
  {
    // The regular interpretation: dark-2020s' flat model flipped to
    // light — neutral zinc grays, white cards, the standard 2020s
    // blue, its radii and system font. Independently derived, in the
    // same spirit as light-gray-2020s but not copied from it, so the
    // two can be compared in the picker.
    id: 'lightgray-2020s-regular',
    label: 'Light Gray 2020s Regular',
    fontLabel: 'System UI',
    description: 'A light-gray 2020s look in the same spirit: flat neutral grays, white cards, standard blue accent.',
    tokens: {
      bg: '#e5e5e5',
      panel: '#f4f4f5',
      card: '#ffffff',
      cardHover: '#ededf0',
      border: '#d4d4d8',
      borderSoft: '#e4e4e7',
      text: '#27272a',
      muted: '#71717a',
      faint: '#a1a1aa',
      blue: '#2563eb',
      green: '#16a34a',
      amber: '#d97706',
      red: '#dc2626',
      well: '#ffffff',
      highlight: 'rgba(255, 255, 255, 0)',
      panelBg: '#f4f4f5',
      buttonBg: '#ffffff',
      buttonBgPrimary: '#dbeafe',
      wellShadow: 'none',
      buttonShadow: 'none',
      topbarBg: 'rgba(244, 244, 245, 0.9)',
      scrollbarThumb: '#d4d4d8',
      radiusPanel: '12px',
      radiusControl: '8px',
      fontUi: SYSTEM_FONT,
      textStrong: '#18181b',
      textSoft: '#3f3f46',
      borderStrong: '#a1a1aa',
      accentSoftBg: '#eff6ff',
      accentSoftBorder: '#bfdbfe',
      accentSoftText: '#1d4ed8',
      redText: '#b91c1c',
      greenText: '#15803d',
      amberText: '#b45309',
      violet: '#7c3aed',
      overlayBg: 'rgba(24, 24, 27, 0.45)',
      segBg: 'transparent',
      segShadow: 'none',
      headBg: '#f4f4f5',
      onPrimary: '#1e40af',
      buttonFunctionBg: '#e0eaf5',
      buttonFunctionBorder: '#a9bed6',
      buttonFunctionText: '#1e40af',
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
 * theme; the dark pro theme keeps vs-dark until a custom one is built.
 * The light themes (gray pro and both light-grays) use Monaco's light. */
export function monacoThemeFor(id: UiThemeId): string {
  return id === 'gray-pro-classic' || id === 'light-gray-2020s' || id === 'lightgray-2020s-regular' ? 'light' : 'vs-dark'
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
