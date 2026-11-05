import { useEffect } from 'react'
import { heartbeat } from '../lib/api'

// Presence heartbeat so the pool page knows an editor is open.
export function usePresence() {
  useEffect(() => {
    heartbeat()
    const id = setInterval(heartbeat, 15000)
    return () => clearInterval(id)
  }, [])
}
