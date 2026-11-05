import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { aiLiveEditor } from '../../src/vite-plugin/aiLiveEditor.ts'

const dir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    aiLiveEditor({
      envFile: path.resolve(dir, '../../.env'),
    }),
  ],
  server: { port: 5173 },
  devtools: {
    apply: 'serve',
    builtinDevTools: false,
    embeddedVisibility: 'passive',
  },
})
