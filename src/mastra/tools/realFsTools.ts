import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { getFsRoot } from '../../launcher.js'
import { livePageOp, poolOpen } from '../../liveTarget.js'

function safe(p: string) {
  const root = getFsRoot()
  const full = path.resolve(root, '.' + p)
  if (!full.startsWith(root)) throw new Error('traversal')
  return full
}

export const listRealFilesTool = createTool({
  id: 'list-real-files',
  description: 'List files from real FS projects/',
  inputSchema: z.object({}),
  execute: async () => {
    const files: string[] = []
    function walk(dir: string, base = '') {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.chrome-data') || e.name === 'node_modules' || e.name === '.vite') continue
        const full = path.join(dir, e.name)
        const rel = path.join(base, e.name)
        if (e.isDirectory()) walk(full, rel)
        else files.push('/' + rel.replace(/\\/g, '/'))
      }
    }
    const root = getFsRoot()
    if (fs.existsSync(root)) walk(root)
    return { files, root }
  }
})

export const readRealFileTool = createTool({
  id: 'read-real-file',
  description: 'Read file from real FS',
  inputSchema: z.object({ path: z.string() }),
  execute: async ({ path: p }) => {
    const full = safe(p)
    if (!fs.existsSync(full)) return { error: 'Not found: ' + p }
    return { path: p, content: fs.readFileSync(full, 'utf-8').slice(0, 20000) }
  }
})

export const writeRealFileTool = createTool({
  id: 'write-real-file',
  description: 'Write file to real FS - instant',
  inputSchema: z.object({ path: z.string(), content: z.string() }),
  execute: async ({ path: p, content }) => {
    const full = safe(p)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content, 'utf-8')
    return { ok: true, path: p, bytes: content.length, mode: 'real-fs', elapsedMs: 1 }
  }
})

export const inspectDOMTool = createTool({
  id: 'inspect-dom',
  description: 'Inspect a live element. Default: the Vite app page. Pass url (another origin) to use the optional Playwright pool.',
  inputSchema: z.object({ selector: z.string().optional(), url: z.string().optional() }),
  execute: async ({ selector, url }) => livePageOp('inspect', { selector, url }),
})

export const patchDOMTool = createTool({
  id: 'patch-dom',
  description: 'Patch innerHTML of a live element. Default: Vite app. Pass url (another origin) for the Playwright pool. Prefer write-real-file + HMR for lasting source edits.',
  inputSchema: z.object({ selector: z.string(), html: z.string(), url: z.string().optional() }),
  execute: async ({ selector, html, url }) => livePageOp('patch', { selector, html, url }),
})

export const evalTool = createTool({
  id: 'eval-js',
  description: 'Run JavaScript in the live Vite app, or in the Playwright pool when url is another origin.',
  inputSchema: z.object({ code: z.string(), url: z.string().optional() }),
  execute: async ({ code, url }) => livePageOp('eval', { code, url }),
})

export const poolOpenTool = createTool({
  id: 'pool-open',
  description: 'Open a URL in the optional Playwright Chrome pool (headed, persistent profile). Requires Playwright pool enabled in Settings.',
  inputSchema: z.object({ url: z.string() }),
  execute: async ({ url }) => poolOpen(url),
})
