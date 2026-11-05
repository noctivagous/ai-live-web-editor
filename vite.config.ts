import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
    emptyOutDir: true
  }
})
