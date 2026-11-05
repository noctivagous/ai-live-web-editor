import React, { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
export function MonacoEditor({ path, value, onChange }: { path:string; value:string; onChange:(v:string)=>void }){
  const ref = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor|null>(null)
  useEffect(()=>{
    if(!ref.current) return
    const editor = monaco.editor.create(ref.current, { value, language: path.endsWith('.tsx')||path.endsWith('.ts')?'typescript':path.endsWith('.css')?'css':'html', theme:'vs-dark', minimap:{enabled:false}, fontSize:13, automaticLayout:true })
    editor.onDidChangeModelContent(()=>onChange(editor.getValue()))
    editorRef.current=editor
    return()=>editor.dispose()
  },[path])
  useEffect(()=>{ if(editorRef.current && value!==editorRef.current.getValue()) editorRef.current.setValue(value) },[value])
  return <div ref={ref} style={{width:'100%',height:'100%'}}/>
}
