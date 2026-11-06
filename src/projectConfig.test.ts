import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  declaredTargets,
  isDesignated,
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

test('device parsers accept only known targets', () => {
  assert.equal(parseDeviceTarget('tablet'), 'tablet')
  assert.equal(parseDeviceTarget('watch'), null)
  assert.deepEqual(parseDeviceTargets(['phone', 'x']), ['phone'])
  assert.equal(parseDeviceTargets('phone'), undefined)
  assert.equal(parseDeviceTargets([]), undefined)
})
