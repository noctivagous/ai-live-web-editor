import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const FS_ROOT = path.resolve(__dirname, '../projects')
export const UI_ROOT = path.resolve(__dirname, '../src/ui')

const SEED_FILES: Record<string, string> = {
  'index.html': `<!doctype html>
<html><head><meta charset="utf-8"/><style>body{font-family:system-ui;padding:24px}</style></head><body><div id="root"><h1>Real FS works ⚡</h1><p>Edit <code>projects/App.jsx</code> and it patches instantly without reload.</p></div><script type="module" src="/main.jsx"></script></body></html>`,
  'App.jsx': `export default function App(){
  return <div style={{padding:24}}>
    <h1>Real FS works ⚡</h1>
    <p>This file lives at <code>projects/App.jsx</code> on your real disk.</p>
    <p>Edit it in the launcher UI or ask AI: "make this a todo app"</p>
    <p>When AI writes, it calls <code>fs.writeFileSync</code> then <code>page.$eval</code> to patch DOM in 5ms - no screenshot tax.</p>
    <div style={{marginTop:24,padding:16,background:'#f5f5f5',borderRadius:8}}>
      <b>Try:</b> Ask AI "Add a counter button that increments"
    </div>
  </div>
}
`,
  'main.jsx': `import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(<App/>)
`,
  'package.json': `{
  "name": "user-project",
  "type": "module",
  "scripts": {
    "dev": "vite --port 5173",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "vite": "^5.4.0",
    "@vitejs/plugin-react": "^4.3.0"
  }
}
`,
  'vite.config.js': `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()], server: { port: 5173 } })
`,
}

export function ensureFsRoot() {
  if (!fs.existsSync(FS_ROOT)) {
    fs.mkdirSync(FS_ROOT, { recursive: true })
  }
  // seed minimal project files if missing (never overwrite user edits)
  for (const [rel, content] of Object.entries(SEED_FILES)) {
    const full = path.join(FS_ROOT, rel)
    if (!fs.existsSync(full)) {
      fs.writeFileSync(full, content, 'utf-8')
    }
  }
  return FS_ROOT
}
