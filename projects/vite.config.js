import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { aiLiveEditor } from '../src/vite-plugin/aiLiveEditor.ts'

export default defineConfig({
  plugins: [react(), aiLiveEditor({ launcherUrl: 'http://localhost:4112' })],
  server: { port: 5173 },
  devtools: {
    apply: 'serve',
    builtinDevTools: false,
    embeddedVisibility: 'passive',
  },
})
