import fs from 'fs'
import path from 'path'
import { seedProjectDir } from './launcher.js'

/**
 * Setup wizard operations (Open slice C): the file-writing half of
 * the wizard the Preview pane shows for folders with nothing to
 * preview yet. Everything here is conservative — a template never
 * overwrites an existing file, and converting a text file creates a
 * sibling page next to it (the original stays untouched).
 */

export type PageTemplateId = 'blank-page' | 'article' | 'pricing'
export type TemplateId = PageTemplateId | 'seed-app'

export const TEMPLATE_IDS: TemplateId[] = ['seed-app', 'blank-page', 'article', 'pricing']

const PAGE_SHELL = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; color: #1c1c1e; background: #fff; }
  main { max-width: 720px; margin: 0 auto; padding: 48px 24px; }
  h1 { font-size: 32px; margin: 0 0 12px; }
  p { line-height: 1.65; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`

export const PAGE_TEMPLATES: Record<PageTemplateId, { file: string; html: string }> = {
  'blank-page': {
    file: 'index.html',
    html: PAGE_SHELL('New page', `<h1>New page</h1>
<p>Start writing here.</p>`),
  },
  article: {
    file: 'index.html',
    html: PAGE_SHELL('Article title', `<h1>Article title</h1>
<p>Opening paragraph. State what this article covers and why it matters.</p>
<h2>First section</h2>
<p>Section text.</p>
<h2>Second section</h2>
<p>Section text.</p>`),
  },
  pricing: {
    file: 'index.html',
    html: PAGE_SHELL('Pricing', `<h1>Pricing</h1>
<p>Three plans. Change the names, prices and features to match the product.</p>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:24px">
  <section style="border:1px solid #ddd;border-radius:10px;padding:20px">
    <h2 style="margin-top:0">Starter</h2>
    <p style="font-size:28px;margin:8px 0">$0</p>
    <p>For trying things out.</p>
  </section>
  <section style="border:1px solid #ddd;border-radius:10px;padding:20px">
    <h2 style="margin-top:0">Standard</h2>
    <p style="font-size:28px;margin:8px 0">$9</p>
    <p>For regular use.</p>
  </section>
  <section style="border:1px solid #ddd;border-radius:10px;padding:20px">
    <h2 style="margin-top:0">Pro</h2>
    <p style="font-size:28px;margin:8px 0">$29</p>
    <p>For heavy use.</p>
  </section>
</div>`),
  },
}

/** Write a standalone page template as the folder's index.html.
 * Refuses when index.html already exists — a template never replaces. */
export function applyPageTemplate(root: string, id: PageTemplateId): { created: string } {
  const t = PAGE_TEMPLATES[id]
  if (!t) throw new Error(`Unknown template: ${id}`)
  const full = path.join(root, t.file)
  if (fs.existsSync(full)) throw new Error(`${t.file} already exists — a template will not replace it`)
  fs.writeFileSync(full, t.html, 'utf-8')
  return { created: t.file }
}

/** Seed the React app starter around whatever is already here
 * (seedProjectDir only writes files that are missing). */
export function applySeedApp(root: string): { seeded: true } {
  seedProjectDir(root)
  return { seeded: true }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Minimal markdown for converted notes: headings, bold, lists,
 * paragraphs. Anything else stays literal text — a first page to
 * edit, not a full markdown renderer. */
function markdownLite(text: string): string {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
  return blocks.map((b) => {
    const h = b.match(/^(#{1,3})\s+(.*)$/)
    if (h) return `<h${h[1].length}>${inlineMd(h[2])}</h${h[1].length}>`
    const lines = b.split('\n')
    if (lines.every((l) => /^[-*]\s+/.test(l.trim()))) {
      return `<ul>${lines.map((l) => `<li>${inlineMd(l.trim().replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`
    }
    return `<p>${lines.map(inlineMd).join('<br>\n')}</p>`
  }).join('\n')
}

function inlineMd(s: string): string {
  return escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function plainTextPage(text: string): string {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
  return blocks.map((b) => `<p>${b.split('\n').map(escapeHtml).join('<br>\n')}</p>`).join('\n')
}

export function wrapTextAsPage(text: string, title: string, markdown: boolean): string {
  const body = markdown ? markdownLite(text) : plainTextPage(text)
  return PAGE_SHELL(escapeHtml(title), body)
}

const CONVERTIBLE = new Set(['.txt', '.md', '.markdown', '.text'])

/**
 * Turn a text file into a sibling HTML page ('/notes.txt' →
 * '/notes.html'). The original file is not modified. Refuses when
 * the page already exists.
 */
export function convertTextToPage(root: string, uiPath: string): { created: string } {
  if (typeof uiPath !== 'string' || !uiPath.startsWith('/') || uiPath.includes('..') || uiPath.includes('\\')) {
    throw new Error('A file path inside the project is required')
  }
  const ext = path.extname(uiPath).toLowerCase()
  if (!CONVERTIBLE.has(ext)) throw new Error('Only text files (.txt, .md) can be turned into a page')
  const rel = uiPath.replace(/^\/+/, '')
  const src = path.join(root, rel)
  if (!fs.existsSync(src)) throw new Error(`No such file: ${rel}`)
  const targetRel = rel.slice(0, rel.length - ext.length) + '.html'
  const target = path.join(root, targetRel)
  if (fs.existsSync(target)) throw new Error(`${targetRel} already exists — a conversion will not replace it`)
  const text = fs.readFileSync(src, 'utf-8').slice(0, 512 * 1024)
  const title = path.basename(rel, ext).replace(/[-_]+/g, ' ').trim() || 'Page'
  const titled = title.charAt(0).toUpperCase() + title.slice(1)
  fs.writeFileSync(target, wrapTextAsPage(text, titled, ext === '.md' || ext === '.markdown'), 'utf-8')
  return { created: `/${targetRel}` }
}
