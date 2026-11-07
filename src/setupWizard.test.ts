import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { applyPageTemplate, applySeedApp, convertTextToPage, wrapTextAsPage } from './setupWizard.js'

function fixture(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-live-wizard-'))
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return dir
}

test('page templates write index.html and refuse to replace an existing one', () => {
  const dir = fixture()
  assert.deepEqual(applyPageTemplate(dir, 'blank-page'), { created: 'index.html' })
  assert.match(fs.readFileSync(path.join(dir, 'index.html'), 'utf-8'), /<h1>New page<\/h1>/)
  assert.throws(() => applyPageTemplate(dir, 'article'), /already exists/)
})

test('seed app fills in the starter files and keeps existing ones', () => {
  const dir = fixture({ 'notes.txt': 'mine' })
  applySeedApp(dir)
  assert.ok(fs.existsSync(path.join(dir, 'package.json')))
  assert.ok(fs.existsSync(path.join(dir, 'index.html')))
  assert.equal(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf-8'), 'mine')
})

test('convert a text file: sibling page created, original untouched, text wrapped as paragraphs', () => {
  const dir = fixture({ 'notes.txt': 'first para\n\nsecond para\nwith two lines' })
  assert.deepEqual(convertTextToPage(dir, '/notes.txt'), { created: '/notes.html' })
  const html = fs.readFileSync(path.join(dir, 'notes.html'), 'utf-8')
  assert.match(html, /<p>first para<\/p>/)
  assert.match(html, /second para<br>/)
  assert.match(html, /<title>Notes<\/title>/)
  assert.equal(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf-8'), 'first para\n\nsecond para\nwith two lines')
  assert.throws(() => convertTextToPage(dir, '/notes.txt'), /already exists/)
})

test('convert markdown: headings, bold and lists become elements', () => {
  const dir = fixture({ 'guide.md': '# Visitor Guide\n\nBring **water**.\n\n- hat\n- map' })
  convertTextToPage(dir, '/guide.md')
  const html = fs.readFileSync(path.join(dir, 'guide.html'), 'utf-8')
  assert.match(html, /<h1>Visitor Guide<\/h1>/)
  assert.match(html, /<strong>water<\/strong>/)
  assert.match(html, /<li>hat<\/li>/)
})

test('convert refuses code files, traversal, and missing files', () => {
  const dir = fixture({ 'main.ts': 'code' })
  assert.throws(() => convertTextToPage(dir, '/main.ts'), /Only text files/)
  assert.throws(() => convertTextToPage(dir, '/../secret.txt'), /inside the project/)
  assert.throws(() => convertTextToPage(dir, '/missing.txt'), /No such file/)
})

test('wrapTextAsPage escapes raw html in the source text', () => {
  const html = wrapTextAsPage('a <script> b', 'T', false)
  assert.ok(!html.includes('<script> b'))
  assert.match(html, /&lt;script&gt;/)
})
