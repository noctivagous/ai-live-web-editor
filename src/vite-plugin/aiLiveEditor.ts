/// <reference types="@vitejs/devtools-kit" />
/**
 * One plugin, two ways in:
 * - Official workspace: `projects/vite.config.js` already registers this; `npm run dev`
 *   in the repo root runs that Vite app. FS root is `projects/`, keys from repo `.env`.
 * - Existing Vite repo: `plugins: [aiLiveEditor()]`. FS root is that app's `config.root`,
 *   keys from that repo's `.env`.
 *
 * `configureServer` hosts /api/* (FS, chat, config) so no separate :4112 process is required.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin, ViteDevServer } from 'vite'
import { createApiApp } from '../apiApp.js'
import { loadDotEnv, setEnvPath } from '../env.js'
import { setFsRoot } from '../launcher.js'
import { markPageOwner } from '../pageBridge.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(__dirname, '..')
/* Agentation ships with the editor (repo-root node_modules), not with the
 * user's project — but the agentation entry is resolved from the project
 * root, so bare `import 'agentation'` fails there. Alias + allow it here. */
const AGENTATION_DIR = path.resolve(__dirname, '..', '..', 'node_modules', 'agentation')
const AGENTATION_OK = fs.existsSync(path.join(AGENTATION_DIR, 'package.json'))

export type AiLiveEditorOptions = {
  /** Disk the agent may read/write. Default: Vite `config.root`. */
  fsRoot?: string
  /** API-key `.env`. Default: `<fsRoot>/.env`, then parent `.env`. */
  envFile?: string
  /** Prefix for overlay fetches. Empty (default) = same origin as the Vite app. */
  apiBase?: string
}

function resolveEnvFile(fsRoot: string, explicit?: string) {
  if (explicit) return path.resolve(explicit)
  const local = path.join(fsRoot, '.env')
  if (fs.existsSync(local)) return local
  const parent = path.join(fsRoot, '..', '.env')
  if (fs.existsSync(parent)) return parent
  return local
}

export function aiLiveEditor(opts: AiLiveEditorOptions = {}): Plugin {
  const apiBase = opts.apiBase ?? ''
  const chatFile = path.join(__dirname, 'client', 'chat-overlay.js')
  const chatUi = path.resolve(__dirname, '../ui/chat-embed.tsx')
  const agentationEntry = path.join(__dirname, 'client', 'agentation-entry.jsx')

  function loadClient(file: string) {
    return fs.readFileSync(file, 'utf-8').replaceAll('__LAUNCHER_URL__', JSON.stringify(apiBase))
  }

  return {
    name: 'ai-live-editor',
    apply: 'serve',
    config() {
      return {
        server: { fs: { allow: AGENTATION_OK ? [PKG_ROOT, AGENTATION_DIR] : [PKG_ROOT] } },
        resolve: {
          alias: AGENTATION_OK ? { agentation: AGENTATION_DIR } : {},
          // The agentation entry is served from the editor repo via /@fs,
          // so its bare `react` imports would resolve to the repo copy
          // while the app uses the project copy — two Reacts, invalid
          // hook call, empty toolbar. Dedupe pins a single copy.
          dedupe: ['react', 'react-dom'],
        },
      }
    },
    configResolved(config) {
      const fsRoot = path.resolve(opts.fsRoot || config.root)
      setFsRoot(fsRoot)
      setEnvPath(resolveEnvFile(fsRoot, opts.envFile))
      loadDotEnv()
    },
    resolveId(id) {
      if (id === 'ai-live-editor/chat-overlay') return '\0' + id
    },
    load(id) {
      if (id === '\0ai-live-editor/chat-overlay') return loadClient(chatFile)
    },
    configureServer(server: ViteDevServer) {
      const publicUrl = () => {
        const local = server.resolvedUrls?.local?.[0]
        return local ? local.replace(/\/$/, '') : `http://localhost:${server.config.server.port || 5173}`
      }
      const api = createApiApp({ publicUrl })
      markPageOwner()
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0] || ''
        if (pathname.startsWith('/api') || pathname === '/live-edit/overlay.js' || pathname === '/pool') {
          api(req as any, res as any, next)
          return
        }
        next()
      })
      server.middlewares.use(async (req, res, next) => {
        const pathname = req.url?.split('?')[0]
        if (pathname !== '/chat-embed' && pathname !== '/chat-embed/') return next()
        try {
          const raw = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>AI Chat</title>
  <style>html,body,#root{height:100%;margin:0;background:#141417}</style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/@fs${chatUi}"></script>
</body>
</html>`
          const html = await server.transformIndexHtml('/chat-embed', raw)
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(html)
        } catch (err) {
          next(err)
        }
      })
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0]
        if (pathname === '/@ai-live-editor/chat-overlay.js') {
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
          res.end(loadClient(chatFile))
          return
        }
        if (pathname === '/@ai-live-editor/page-bridge.js') {
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
          const engine = fs.readFileSync(path.join(__dirname, '..', 'live-edit', 'patchEngine.js'), 'utf-8')
          const snap = fs.readFileSync(path.join(__dirname, '..', 'live-edit', 'pageSnapshot.js'), 'utf-8')
          const bridge = fs.readFileSync(path.join(__dirname, 'client', 'page-bridge.js'), 'utf-8')
          res.end(engine + '\n' + snap + '\n' + bridge)
          return
        }
        next()
      })
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const p = ctx.path || ''
        if (p === '/chat-embed' || p.startsWith('/chat-embed') || p === '/pool') return []
        return [
          {
            tag: 'script',
            attrs: { type: 'module', src: '/@ai-live-editor/chat-overlay.js' },
            injectTo: 'body',
          },
          {
            tag: 'script',
            attrs: { type: 'module', src: '/@ai-live-editor/page-bridge.js' },
            injectTo: 'body',
          },
          {
            tag: 'script',
            children: `window.__AI_LIVE_LAUNCHER__ = ${JSON.stringify(apiBase)}`,
            injectTo: 'body',
          },
          {
            tag: 'script',
            attrs: { type: 'module', src: `/@fs${agentationEntry}` },
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
      },
    },
  }
}
