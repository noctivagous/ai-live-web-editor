/// <reference types="chrome" />
const LAUNCHER_URL = 'http://localhost:4112'
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
  (async()=>{
    if(msg.type==='MASTRA_CHAT'){
      try{
        const res = await fetch(`${LAUNCHER_URL}/api/chat`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ messages: msg.messages }) })
        const data = await res.json()
        sendResponse({ ok: data.ok !== false, ...data })
      }catch(e:any){ sendResponse({ ok:false, error:e.message, hint:'Is the launcher running? npm run dev (http://localhost:4112)' }) }
      return
    }
    if(msg.type==='DOM_ACTION'){
      const [tab] = await chrome.tabs.query({ active:true, currentWindow:true })
      if(!tab?.id) return sendResponse({ ok:false, error:'No active tab' })
      const result = await chrome.tabs.sendMessage(tab.id, msg.payload)
      sendResponse(result)
      return
    }
    if(msg.type==='LIVE_EDIT_SUBMIT'){
      try{
        const res = await fetch(`${LAUNCHER_URL}/api/live-edit/submit`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(msg.payload) })
        const data = await res.json()
        sendResponse(data)
      }catch(e:any){ sendResponse({ ok:false, error:e.message, hint:'Is the launcher running? npm run dev (http://localhost:4112)' }) }
      return
    }
  })()
  return true
})
