import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  declaredTargets,
  effectiveFormat,
  isDesignated,
  parseProjectFormat,
  projectBrief,
  readProjectConfig,
  sanitizeProjectConfig,
  targetWidths,
  writeProjectConfig,
} from './projectConfig.js'
import { parseDeviceTarget, parseDeviceTargets } from './deviceSession.js'

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-live-pc-'))
}

test('absent manifest reads as undesignated {}', () => {
  const root = tmpRoot()
  assert.deepEqual(readProjectConfig(root), {})
  assert.equal(isDesignated(readProjectConfig(root)), false)
})

test('write/read round-trip; patch merges and preserves other fields', () => {
  const root = tmpRoot()
  writeProjectConfig({ type: 'web-app' }, root)
  writeProjectConfig({ styleSet: 'noct' }, root)
  const cfg = readProjectConfig(root)
  assert.equal(cfg.type, 'web-app')
  assert.equal(cfg.styleSet, 'noct')
  assert.equal(isDesignated(cfg), true)
  assert.ok(fs.existsSync(path.join(root, 'project.ai.json')))
})

test('explicit undefined type un-designates', () => {
  const root = tmpRoot()
  writeProjectConfig({ type: 'game' }, root)
  const cfg = writeProjectConfig({ type: undefined }, root)
  assert.equal(cfg.type, undefined)
  assert.equal(isDesignated(readProjectConfig(root)), false)
})

test('sanitize drops junk and dedupes features', () => {
  const cfg = sanitizeProjectConfig({
    type: '  dashboard ',
    deviceTargets: ['desktop', 'phone', 'watch'],
    defaultDeviceTarget: 'watch',
    features: ['chat', 'chat', '', 42],
  })
  assert.equal(cfg.type, 'dashboard')
  assert.deepEqual(cfg.deviceTargets, ['phone', 'desktop'])
  assert.equal(cfg.defaultDeviceTarget, undefined)
  assert.deepEqual(cfg.features, ['chat'])
  assert.deepEqual(sanitizeProjectConfig('nope'), {})
  assert.deepEqual(sanitizeProjectConfig(null), {})
})

test('declared targets default to all three; widths ascend', () => {
  assert.deepEqual(declaredTargets({}), ['phone', 'tablet', 'desktop'])
  assert.deepEqual(targetWidths({}), [375, 768, 1280])
  assert.deepEqual(targetWidths({ deviceTargets: ['desktop'] }), [1280])
  assert.deepEqual(targetWidths({ deviceTargets: ['desktop', 'phone'] }), [375, 1280])
})

test('brief states type, targets and the responsive outcome', () => {
  const undesignated = projectBrief({})
  assert.match(undesignated, /undesignated/)
  assert.match(undesignated, /375px/)
  assert.match(undesignated, /1280px/)
  const designated = projectBrief({ type: 'canvas-tool', deviceTargets: ['desktop'], styleSet: 'noct' })
  assert.match(designated, /canvas-tool/)
  assert.match(designated, /Style set: noct/)
  assert.doesNotMatch(designated, /375px/)
})

test('format: sanitize, type defaults, explicit wins', () => {
  assert.equal(parseProjectFormat('app'), 'app')
  assert.equal(parseProjectFormat('scroll'), undefined)
  assert.equal(sanitizeProjectConfig({ format: 'page' }).format, 'page')
  assert.equal(sanitizeProjectConfig({ format: 'tall' }).format, undefined)
  assert.equal(effectiveFormat({}), undefined)
  assert.equal(effectiveFormat({ type: 'content-site' }), 'page')
  assert.equal(effectiveFormat({ type: 'web-app' }), 'app')
  assert.equal(effectiveFormat({ type: 'content-site', format: 'app' }), 'app')
  const root = tmpRoot()
  writeProjectConfig({ type: 'content-site', format: 'app' }, root)
  assert.equal(readProjectConfig(root).format, 'app')
  const cleared = writeProjectConfig({ format: undefined }, root)
  assert.equal(cleared.format, undefined)
  assert.equal(effectiveFormat(cleared), 'page')
})

test('brief states the format contract', () => {
  assert.match(projectBrief({ type: 'web-app' }), /Format: app/)
  assert.match(projectBrief({ type: 'web-app' }), /never grow the page/)
  assert.match(projectBrief({ type: 'content-site' }), /Format: page/)
  assert.match(projectBrief({ type: 'content-site' }), /reflowing/)
  assert.doesNotMatch(projectBrief({}), /Format:/)
})

test('device parsers accept only known targets', () => {
  assert.equal(parseDeviceTarget('tablet'), 'tablet')
  assert.equal(parseDeviceTarget('watch'), null)
  assert.deepEqual(parseDeviceTargets(['phone', 'x']), ['phone'])
  assert.equal(parseDeviceTargets('phone'), undefined)
  assert.equal(parseDeviceTargets([]), undefined)
})
