import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getPreviewLocation,
  getPreviewMark,
  parsePreviewPath,
  resetPreviewSession,
  seedPreviewSession,
  setPreviewLocation,
  setPreviewMark,
} from './previewSession.js'
import { parseProjectEntry, sanitizeProjectConfig } from './projectConfig.js'

test('parsePreviewPath accepts UI paths and refuses traversal', () => {
  assert.equal(parsePreviewPath('/landing.html'), '/landing.html')
  assert.equal(parsePreviewPath('/docs/guide.md'), '/docs/guide.md')
  assert.equal(parsePreviewPath('landing.html'), null)
  assert.equal(parsePreviewPath('/../secret'), null)
  assert.equal(parsePreviewPath('/a\\b'), null)
  assert.equal(parsePreviewPath(42), null)
  assert.equal(parsePreviewPath(null), null)
})

test('mark and drift: setting a mark clears drift; clearing drift keeps the mark', () => {
  resetPreviewSession()
  setPreviewMark('/index.html')
  setPreviewLocation('/about.html')
  assert.equal(getPreviewMark(), '/index.html')
  assert.equal(getPreviewLocation(), '/about.html')
  setPreviewMark('/pricing.html')
  assert.equal(getPreviewMark(), '/pricing.html')
  assert.equal(getPreviewLocation(), null)
  setPreviewLocation('/about.html')
  setPreviewLocation(null)
  assert.equal(getPreviewMark(), '/pricing.html')
  assert.equal(getPreviewLocation(), null)
})

test('seed: designated entry wins over the detected candidate', () => {
  seedPreviewSession('home.html', 'index.html')
  assert.equal(getPreviewMark(), '/home.html')
  seedPreviewSession(null, 'landing.html')
  assert.equal(getPreviewMark(), '/landing.html')
  seedPreviewSession(null, null)
  assert.equal(getPreviewMark(), null)
  assert.equal(getPreviewLocation(), null)
})

test('manifest entry: only plain root-relative .html paths survive sanitize', () => {
  assert.equal(parseProjectEntry('index.html'), 'index.html')
  assert.equal(parseProjectEntry('/pages/about.html'), 'pages/about.html')
  assert.equal(parseProjectEntry(' pages/About.HTML '), 'pages/About.HTML')
  assert.equal(parseProjectEntry('../escape.html'), undefined)
  assert.equal(parseProjectEntry('app.tsx'), undefined)
  assert.equal(parseProjectEntry(''), undefined)
  assert.equal(parseProjectEntry(7), undefined)
  assert.deepEqual(sanitizeProjectConfig({ entry: 'main.html' }).entry, 'main.html')
  // An empty string in a patch clears the designation (merge + sanitize).
  assert.equal(sanitizeProjectConfig({ entry: '' }).entry, undefined)
})
