/// <reference types="@vitejs/devtools-kit" />
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function aiLiveEditor(opts: { launcherUrl?: string } = {}): Plugin {
  const launcherUrl = opts.launcherUrl || 'http://localhost:4112'
  const chatFile = path.join(__dirname, 'client', 'chat-overlay.js')
  const annotateFile = path.join(__dirname, 'client', 'annotate.js')

  function loadClient(file: string) {
    return fs.readFileSync(file, 'utf-8').replaceAll('__LAUNCHER_URL__', JSON.stringify(launcherUrl))
  }

  return {
    name: 'ai-live-editor',
    apply: 'serve',
    resolveId(id) {
      if (id === 'ai-live-editor/chat-overlay') return '\0' + id
      if (id === 'ai-live-editor/annotate') return '\0' + id
    },
    load(id) {
      if (id === '\0ai-live-editor/chat-overlay') return loadClient(chatFile)
      if (id === '\0ai-live-editor/annotate') return loadClient(annotateFile)
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] === '/@ai-live-editor/chat-overlay.js') {
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
          res.end(loadClient(chatFile))
          return
        }
        next()
      })
    },
    transformIndexHtml: {
      order: 'post',
      handler() {
        return [
          {
            tag: 'script',
            attrs: { type: 'module', src: '/@ai-live-editor/chat-overlay.js' },
            injectTo: 'body',
          },
        ]
      },
    },
    devtools: {
      setup(ctx) {
        ctx.docks.register({
          id: 'ai-live-editor:chat',
          title: 'AI Chat',
          icon: 'ph:chat-circle-dots-duotone',
          type: 'custom-render',
          renderer: {
            importFrom: 'ai-live-editor/chat-overlay',
            importName: 'default',
          },
        })
        ctx.docks.register({
          id: 'ai-live-editor:annotate',
          title: 'Annotate',
          icon: 'ph:cursor-click-duotone',
          type: 'action',
          action: {
            importFrom: 'ai-live-editor/annotate',
            importName: 'default',
          },
        })
      },
    },
  }
}
