
import React, { useEffect, useState } from 'react'
import { db, seedIfEmpty, ProjectFile } from './lib/db'
import { FileTree } from './components/FileTree'
import { MonacoEditor } from './components/Editor'
import { chatWithMastra, domAction, submitLiveEdit } from './lib/mastra-client'
import { checkRealFs, isRealFs, listFilesBridge, readFileBridge, writeFileBridge, syncFromRealFs } from './lib/fsBridge'
import JSZip from 'jszip'

export default function App(){
  const [files,setFiles]=useState<ProjectFile[]>([])
  const [activePath,setActivePath]=useState('/src/App.tsx')
  const [activeContent,setActiveContent]=useState('')
  const [chat,setChat]=useState<{role:string,content:string}[]>([{role:'system',content:'AI code editor. Real FS if launcher running, else IndexedDB.'}])
  const [input,setInput]=useState('')
  const [mode,setMode]=useState<'checking'|'real'|'idb'>('checking')
  const [annotating,setAnnotating]=useState(false)

  async function load(){
    await seedIfEmpty()
    const hasReal = await checkRealFs()
    setMode(hasReal ? 'real' : 'idb')
    if (hasReal) await syncFromRealFs()
    
    const all = await db.files.toArray()
    setFiles(all)
    const active = all.find(f=>f.path===activePath)||all[0]
    if(active){ setActivePath(active.path); setActiveContent(active.content) }

    // Also try to get real file list for display
    if (hasReal) {
      const realFiles = await listFilesBridge()
      // merge into display list if not in DB yet
      const existingPaths = new Set(all.map(f=>f.path))
      for (const p of realFiles) {
        if (!existingPaths.has(p)) {
          const content = await readFileBridge(p)
          await db.files.add({ path: p, content, updatedAt: Date.now() })
        }
      }
      setFiles(await db.files.toArray())
    }
  }
  useEffect(()=>{ load(); const id=setInterval(async()=>{ const has=await checkRealFs(); setMode(has?'real':'idb') }, 3000); return()=>clearInterval(id) },[])

  async function saveFile(path:string, content:string){
    const result = await writeFileBridge(path, content)
    setFiles(await db.files.toArray())
    return result
  }

  async function handleSend(){
    if(!input.trim()) return
    const newMsgs=[...chat,{role:'user',content:input + ` [mode=${mode}]`}]
    setChat(newMsgs); setInput('')
    const res=await chatWithMastra(newMsgs)
    if(res?.ok) setChat([...newMsgs,{role:'assistant',content: typeof res.text==='string'?res.text.slice(0,4000):JSON.stringify(res.text ?? res.data).slice(0,4000)}])
    else setChat([...newMsgs,{role:'assistant',content:'Error: '+res?.error}])
    // resync after AI write
    if (isRealFs()) { await syncFromRealFs(); setFiles(await db.files.toArray()) }
  }

  async function exportZip(){
    const zip=new JSZip()
    const all=await db.files.toArray()
    all.forEach(f=>zip.file(f.path.replace(/^\//,''), f.content))
    const blob=await zip.generateAsync({type:'blob'})
    const url=URL.createObjectURL(blob)
    const a=document.createElement('a'); a.href=url; a.download='ai-editor-export.zip'; a.click()
  }

  async function inspectPage(){
    const res=await domAction({ type:'GET_DOM', selector:'body' })
    setChat([...chat,{role:'user',content:'Inspect body'},{role:'assistant',content:'DOM:\n'+(res?.html?.slice(0,3000)||JSON.stringify(res))}])
  }

  async function toggleAnnotate(){
    const res=await domAction({ type: annotating ? 'ANNOTATE_OFF' : 'ANNOTATE_ON' })
    if(res?.ok) setAnnotating(!annotating)
    else setChat([...chat,{role:'assistant',content:'Annotate failed: '+(res?.error||'unknown')}])
  }

  async function submitNotes(){
    const exported=await domAction({ type:'EXPORT_NOTES' })
    if(!exported?.ok){ setChat([...chat,{role:'assistant',content:'No notes: '+(exported?.error||'enable Annotate on the page first')} ]); return }
    const anns=exported.annotations||[]
    if(!anns.length && !exported.pageNotes){ setChat([...chat,{role:'assistant',content:'No notes yet. Click Annotate, click page elements, add notes, then Submit.'}]); return }
    const res=await submitLiveEdit({ annotations:anns, pageNotes:exported.pageNotes||'', url:exported.url })
    if(res?.ok){ await domAction({ type:'CLEAR_NOTES' }); setAnnotating(false); setChat([...chat,{role:'user',content:`Submitted ${anns.length} page note(s)`},{role:'assistant',content:String(res.text||'').slice(0,4000)}]); if(isRealFs()){ await syncFromRealFs(); setFiles(await db.files.toArray()) } }
    else setChat([...chat,{role:'assistant',content:'Live-edit failed: '+(res?.error||'unknown')}])
  }

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100vh'}}>
      <div className="toolbar">
        <span style={{fontSize:11, padding:'4px 8px', borderRadius:10, background: mode==='real'?'#1a4d1a':'#4d1a1a', border:'1px solid #333'}}>{mode==='checking'?'checking...': mode==='real'?'● REAL FS (launcher)' : '● IDB only (no launcher)'}</span>
        <button className="btn" onClick={inspectPage}>Inspect Page</button>
        <button className="btn" onClick={toggleAnnotate} title="Annotate elements on the active tab, then submit notes to the AI">{annotating ? 'Annotating…' : 'Annotate'}</button>
        {annotating && <button className="btn" onClick={submitNotes}>Submit notes</button>}
        <button className="btn" onClick={exportZip}>Export .zip</button>
        <button className="btn" onClick={async()=>{ await domAction({ type:'PATCH_DOM', selector:'body', html:`<div style="padding:24px"><h1>Preview from ${activePath}</h1><pre>${activeContent.slice(0,1000)}</pre><small>mode=${mode}</small></div>` }) }}>Inject Preview</button>
      </div>
      <div style={{display:'flex',flex:1,minHeight:0}}>
        <FileTree files={files} activePath={activePath} onSelect={async p=>{ const content=await readFileBridge(p); setActivePath(p); setActiveContent(content) }} onNew={async()=>{ const p=prompt('Path e.g. /src/new.ts'); if(p){ await saveFile(p,'// new file'); load() } }} />
        <div className="editor-wrap"><MonacoEditor path={activePath} value={activeContent} onChange={v=>{ setActiveContent(v); saveFile(activePath,v) }}/></div>
      </div>
      <div className="chat">
        <div className="chat-log">{chat.map((m,i)=><div key={i} style={{marginBottom:6}}><b>{m.role}:</b> {m.content.slice(0,800)}</div>)}</div>
        <div className="chat-input">
          <input style={{flex:1,background:'#1a1a1e',border:'1px solid #333',color:'#eee',padding:6,borderRadius:6}} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleSend()} placeholder={mode==='real'?'Real FS mode - edits go to disk...':'IDB mode - run launcher for real FS...'}/>
          <button className="btn" onClick={handleSend}>Send</button>
        </div>
      </div>
    </div>
  )
}
