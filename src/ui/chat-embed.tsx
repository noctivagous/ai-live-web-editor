import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Chat } from './components/Chat'
import { getConfig } from './lib/api'
import { loadUiPrefs, UI_PREFS_CHANGED_EVENT } from './lib/uiPrefs'
import { applyUiTheme } from './lib/themes'
import './index.css'

function ChatEmbed() {
  const [keyKnown, setKeyKnown] = useState<boolean | undefined>(undefined)
  const [projectId, setProjectId] = useState('')
  // The embed shares the device UI prefs: theme + font size apply
  // here too, and follow changes made in the main window's Settings.
  useEffect(() => {
    const apply = () => { const p = loadUiPrefs(); applyUiTheme(p.uiTheme, p.uiFontSize) }
    apply()
    window.addEventListener(UI_PREFS_CHANGED_EVENT, apply)
    return () => window.removeEventListener(UI_PREFS_CHANGED_EVENT, apply)
  }, [])
  useEffect(() => {
    getConfig()
      .then(c => {
        setKeyKnown(Boolean(c.hasApiKey ?? c.hasOpenAiKey))
        setProjectId(c.activeProject || '')
      })
      .catch(() => setKeyKnown(false))
  }, [])
  return (
    <Chat
      activePath="/"
      embed
      projectId={projectId}
      keyKnown={keyKnown}
      onNeedSetup={() => {}}
      onAfterChat={() => {}}
    />
  )
}

createRoot(document.getElementById('root')!).render(<ChatEmbed />)
