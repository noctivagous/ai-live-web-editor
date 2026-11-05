import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { FS_ROOT } from '../../launcher.js'
import { patchDOM, inspectDOM, evalJS } from '../../browserPool.js'

function safe(p: string) {
  const full = path.resolve(FS_ROOT, '.' + p)
  if (!full.startsWith(FS_ROOT)) throw new Error('traversal')
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
    if (fs.existsSync(FS_ROOT)) walk(FS_ROOT)
    return { files, root: FS_ROOT }
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

export const patchDOMTool = createTool({
  id: 'patch-dom',
  description: 'Patch live DOM in browser pool - returns rect instantly, no screenshot',
  inputSchema: z.object({ selector: z.string(), html: z.string(), url: z.string().optional() }),
  execute: async ({ selector, html, url }) => {
    try {
      const res = await patchDOM(selector, html, url)
      return res
    } catch (e: any) { return { error: e.message } }
  }
})

export const inspectDOMTool = createTool({
  id: 'inspect-dom',
  description: 'Inspect live DOM from browser pool',
  inputSchema: z.object({ selector: z.string(), url: z.string().optional() }),
  execute: async ({ selector, url }) => {
    try { return await inspectDOM(selector, url) } catch (e: any) { return { error: e.message } }
  }
})

export const evalTool = createTool({
  id: 'eval-js',
  description: 'Run JS in live browser pool',
  inputSchema: z.object({ code: z.string(), url: z.string().optional() }),
  execute: async ({ code, url }) => {
    try { return await evalJS(code, url) } catch (e: any) { return { error: e.message } }
  }
})
