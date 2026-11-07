import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  UI_THEMES, UI_THEME_IDS, isUiThemeId, monacoThemeFor, themeById, uiScaleFor,
  UI_FONT_SIZE_DEFAULT,
} from './themes.js'

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const chan = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('themes', () => {
  it('defines exactly the three themes, in picker order', () => {
    assert.deepEqual(UI_THEMES.map(t => t.id), ['dark-2020s', 'dark-pro-classic', 'gray-pro-classic'])
    assert.deepEqual(UI_THEME_IDS, UI_THEMES.map(t => t.id))
  })

  it('every theme defines the same token keys', () => {
    const keys = Object.keys(UI_THEMES[0].tokens).sort()
    for (const t of UI_THEMES) assert.deepEqual(Object.keys(t.tokens).sort(), keys, t.id)
  })

  it('dark-2020s codifies the current UI values', () => {
    const t = themeById('dark-2020s').tokens
    assert.equal(t.bg, '#0e0e10')
    assert.equal(t.panel, '#141417')
    assert.equal(t.card, '#1a1a1e')
    assert.equal(t.border, '#26262c')
    assert.equal(t.text, '#e4e4e7')
    assert.equal(t.blue, '#3b82f6')
    assert.equal(t.wellShadow, 'none')
    assert.equal(t.buttonShadow, 'none')
    assert.equal(t.panelBg, t.panel)
    assert.match(t.fontUi, /system-ui/)
  })

  it('the pro themes share one shading model and font, and differ in palette', () => {
    const dark = themeById('dark-pro-classic')
    const gray = themeById('gray-pro-classic')
    assert.equal(dark.tokens.fontUi, gray.tokens.fontUi)
    assert.match(dark.tokens.fontUi, /Lucida Grande/)
    assert.equal(dark.tokens.radiusPanel, gray.tokens.radiusPanel)
    assert.equal(dark.tokens.radiusControl, gray.tokens.radiusControl)
    assert.match(dark.tokens.panelBg, /linear-gradient/)
    assert.match(gray.tokens.panelBg, /linear-gradient/)
    assert.match(gray.tokens.wellShadow, /inset/)
    assert.notEqual(dark.tokens.bg, gray.tokens.bg)
  })

  it('dark-pro-classic has more bg/text contrast than dark-2020s', () => {
    const flat = themeById('dark-2020s').tokens
    const pro = themeById('dark-pro-classic').tokens
    assert.ok(contrast(pro.text, pro.bg) > contrast(flat.text, flat.bg),
      `${contrast(pro.text, pro.bg)} should exceed ${contrast(flat.text, flat.bg)}`)
    // Its panels also sit lighter against a darker base.
    assert.ok(luminance(pro.panel) > luminance(flat.panel))
    assert.ok(luminance(pro.bg) < luminance(pro.panel))
  })

  it('gray-pro-classic is the light theme: dark text on a mid-gray ground', () => {
    const gray = themeById('gray-pro-classic').tokens
    assert.ok(luminance(gray.bg) > 0.15)
    assert.ok(contrast(gray.text, gray.panel) > 7)
  })

  it('themeById falls back to dark-2020s and isUiThemeId validates', () => {
    assert.equal(themeById('nope').id, 'dark-2020s')
    assert.ok(isUiThemeId('gray-pro-classic'))
    assert.ok(!isUiThemeId('vs-dark'))
    assert.ok(!isUiThemeId(undefined))
  })

  it('monaco mapping and font-size scale', () => {
    assert.equal(monacoThemeFor('dark-2020s'), 'vs-dark')
    assert.equal(monacoThemeFor('dark-pro-classic'), 'vs-dark')
    assert.equal(monacoThemeFor('gray-pro-classic'), 'light')
    assert.equal(uiScaleFor(UI_FONT_SIZE_DEFAULT), 1)
    assert.ok(uiScaleFor(16) > 1 && uiScaleFor(11) < 1)
  })
})
