/// <reference types="chrome" />
type Msg = { type: 'GET_DOM' | 'PATCH_DOM' | 'READ_SELECTION' | 'ANNOTATE_ON' | 'ANNOTATE_OFF' | 'EXPORT_NOTES' | 'CLEAR_NOTES'; selector?: string; html?: string }
const CONTENT_LAUNCHER_URL = 'http://localhost:4112'

async function ensureOverlay(): Promise<boolean> {
  const w = window as any
  if (w.__AI_LIVE_EDIT__?.installed) return true
  try {
    const res = await fetch(`${CONTENT_LAUNCHER_URL}/live-edit/overlay.js`)
    if (!res.ok) return false
    const src = await res.text()
    const script = document.createElement('script')
    script.textContent = src
    document.documentElement.appendChild(script)
    return Boolean(w.__AI_LIVE_EDIT__?.installed)
  } catch { return false }
}

chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse)=>{
  (async()=>{
    try{
      if(msg.type==='GET_DOM'){
        const el = msg.selector ? document.querySelector(msg.selector) : document.documentElement
        if(!el) return sendResponse({ ok:false, error:'Selector not found' })
        sendResponse({ ok:true, html: (el as HTMLElement).outerHTML.slice(0,20000), text: el.textContent?.slice(0,8000), url: location.href, title: document.title })
        return
      }
      if(msg.type==='PATCH_DOM'){
        const el = document.querySelector(msg.selector || 'body')
        if(!el) return sendResponse({ ok:false, error:'Selector not found' })
        if(msg.html){ el.innerHTML = msg.html; el.setAttribute('data-ai-patched','true') }
        sendResponse({ ok:true })
        return
      }
      if(msg.type==='READ_SELECTION'){
        const sel = window.getSelection()?.toString() || ''
        sendResponse({ ok:true, selection: sel, url: location.href })
        return
      }
      if(msg.type==='ANNOTATE_ON'){
        const ok = await ensureOverlay()
        if (!ok) return sendResponse({ ok:false, error:'Overlay inject failed — is the launcher running?' })
        ;(window as any).__AI_LIVE_EDIT__.enableSelectMode()
        sendResponse({ ok:true })
        return
      }
      if(msg.type==='ANNOTATE_OFF'){
        ;(window as any).__AI_LIVE_EDIT__?.disableSelectMode?.()
        sendResponse({ ok:true })
        return
      }
      if(msg.type==='EXPORT_NOTES'){
        const api = (window as any).__AI_LIVE_EDIT__
        if(!api) return sendResponse({ ok:false, error:'Annotate mode was never enabled on this page' })
        sendResponse({ ok:true, annotations: api.exportAnnotations(), pageNotes: api.getPageNotes(), url: location.href, title: document.title })
        return
      }
      if(msg.type==='CLEAR_NOTES'){
        ;(window as any).__AI_LIVE_EDIT__?.clearAll?.()
        sendResponse({ ok:true })
        return
      }
      sendResponse({ ok:false, error:'Unknown message' })
    }catch(e:any){ sendResponse({ ok:false, error:e.message }) }
  })()
  return true
})
console.log('[AI Editor] content ready')
