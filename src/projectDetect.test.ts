import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { classifyProject } from './projectDetect.js'

function fixture(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-live-detect-'))
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return dir
}

test('ready react project: package.json with react deps', () => {
  const s = classifyProject(fixture({
    'package.json': JSON.stringify({ dependencies: { react: '^18.3.0', 'react-dom': '^18.3.0' } }),
    'index.html': '<html><body><div id="root"></div></body></html>',
    'src/main.jsx': 'import App from "./App.jsx"',
  }))
  assert.equal(s.kind, 'ready')
  assert.equal(s.stack, 'react')
  assert.equal(s.entry, 'index.html')
  assert.equal(s.hasPackageJson, true)
})

test('ready lit project: lit dependency wins over vanilla', () => {
  const s = classifyProject(fixture({
    'package.json': JSON.stringify({ dependencies: { lit: '^3.0.0' } }),
    'index.html': '<html><body><my-el></my-el></body></html>',
  }))
  assert.equal(s.kind, 'ready')
  assert.equal(s.stack, 'lit')
})

test('ready plain package.json: vanilla stack', () => {
  const s = classifyProject(fixture({
    'package.json': JSON.stringify({ name: 'plain', scripts: { dev: 'vite' } }),
  }))
  assert.equal(s.kind, 'ready')
  assert.equal(s.stack, 'vanilla')
  assert.equal(s.entry, null)
})

test('html folder with index.html: entry is index.html, static when no module script', () => {
  const s = classifyProject(fixture({
    'index.html': '<html><body><h1>Hi</h1></body></html>',
    'style.css': 'body{}',
  }))
  assert.equal(s.kind, 'html')
  assert.equal(s.entry, 'index.html')
  assert.equal(s.stack, 'static')
  assert.equal(s.hasPackageJson, false)
})

test('html folder with a single non-index page: that page is the entry candidate', () => {
  const s = classifyProject(fixture({ 'landing.html': '<html><body>Landing</body></html>' }))
  assert.equal(s.kind, 'html')
  assert.equal(s.entry, 'landing.html')
  assert.deepEqual(s.htmlFiles, ['landing.html'])
})

test('html folder with several pages and no index: entry is ambiguous (null), candidates listed', () => {
  const s = classifyProject(fixture({
    'about.html': '<html></html>',
    'landing.html': '<html></html>',
  }))
  assert.equal(s.kind, 'html')
  assert.equal(s.entry, null)
  assert.deepEqual(s.htmlFiles, ['about.html', 'landing.html'])
})

test('lit without package.json: module script importing lit is detected', () => {
  const s = classifyProject(fixture({
    'index.html': '<html><head><script type="module" src="./my-el.ts"></script></head><body><my-el></my-el></body></html>',
    'my-el.ts': "import { LitElement, html } from 'lit'\nclass MyEl extends LitElement {}",
  }))
  assert.equal(s.kind, 'html')
  assert.equal(s.stack, 'lit')
  assert.equal(s.entry, 'index.html')
})

test('vanilla module page without package.json', () => {
  const s = classifyProject(fixture({
    'index.html': '<html><head><script type="module" src="./main.js"></script></head><body></body></html>',
    'main.js': "console.log('hi')",
  }))
  assert.equal(s.kind, 'html')
  assert.equal(s.stack, 'vanilla')
})

test('loose files only: text and notes, no html', () => {
  const s = classifyProject(fixture({ 'notes.txt': 'hello', 'ideas.md': '# ideas' }))
  assert.equal(s.kind, 'loose')
  assert.equal(s.entry, null)
  assert.equal(s.stack, 'none')
})

test('files only in a subdirectory still count as loose, not empty', () => {
  const s = classifyProject(fixture({ 'drafts/chapter.txt': 'text' }))
  assert.equal(s.kind, 'loose')
})

test('empty directory and missing directory both classify empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-live-detect-empty-'))
  assert.equal(classifyProject(dir).kind, 'empty')
  assert.equal(classifyProject(path.join(dir, 'does-not-exist')).kind, 'empty')
})

test('a broken package.json still counts as ready (the folder declared itself an app)', () => {
  const s = classifyProject(fixture({ 'package.json': '{not json' }))
  assert.equal(s.kind, 'ready')
  assert.equal(s.hasPackageJson, true)
})
