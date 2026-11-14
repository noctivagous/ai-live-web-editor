import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { isDemoMode } from './lib/demoMode'

function boot() {
  createRoot(document.getElementById('root')!).render(<App/>)
}

// Demo mode: install the fixture transport (which answers the
// API in-browser) before the app's first fetch. The transport and
// its fixture are a lazy chunk — a normal build never loads them.
if (isDemoMode()) {
  void import('./lib/demoTransport')
    .then(m => { m.installDemoTransport(); boot() })
    .catch(() => boot())
} else {
  boot()
}
