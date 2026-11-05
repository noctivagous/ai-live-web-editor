import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Chat } from './components/Chat'
import { getConfig } from './lib/api'
import './index.css'

function ChatEmbed() {
  const [keyKnown, setKeyKnown] = useState<boolean | undefined>(undefined)
  const [projectId, setProjectId] = useState('')
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
