import React from 'react'
import { ProjectFile } from '../lib/db'
export function FileTree({ files, activePath, onSelect, onNew }: { files: ProjectFile[]; activePath: string; onSelect:(p:string)=>void; onNew:()=>void }){
  return (
    <div style={{ width:160, borderRight:'1px solid #222', padding:8, overflow:'auto' }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}><strong style={{fontSize:12}}>FILES</strong><button className='btn' onClick={onNew} style={{padding:'2px 6px'}}>+</button></div>
      {files.map(f=>(<div key={f.path} onClick={()=>onSelect(f.path)} style={{ padding:'4px 6px', cursor:'pointer', background:f.path===activePath?'#1f1f25':'transparent', borderRadius:4, fontSize:12, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{f.path}</div>))}
    </div>
  )
}
