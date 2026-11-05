import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  root: 'src/ui',
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:4112',
      '/projects': 'http://localhost:4112'
    }
  },
  build: {
    outDir: '../ui-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(rootDir, 'src/ui/index.html'),
        chatEmbed: path.resolve(rootDir, 'src/ui/chat-embed.html'),
      },
    },
  },
})
