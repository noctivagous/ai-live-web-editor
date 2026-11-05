import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Chat } from './components/Chat'
import { getConfig } from './lib/api'
import './index.css'

function ChatEmbed() {
  const [keyKnown, setKeyKnown] = useState<boolean | undefined>(undefined)
  useEffect(() => {
    getConfig()
      .then(c => setKeyKnown(Boolean(c.hasApiKey ?? c.hasOpenAiKey)))
      .catch(() => setKeyKnown(false))
  }, [])
  return (
    <Chat
      activePath="/"
      embed
      keyKnown={keyKnown}
      onNeedSetup={() => { window.top?.open('http://localhost:4112/', '_blank') }}
      onAfterChat={() => {}}
    />
  )
}

createRoot(document.getElementById('root')!).render(<ChatEmbed />)
