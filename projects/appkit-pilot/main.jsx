import React from 'react'
import { createRoot } from 'react-dom/client'
import './noct/styles/theme-tokens.css'
import './noct/styles/rectangular-dark.css'
import './noct/index.ts'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
