import React, { useEffect } from 'react'
import Editor from '@monaco-editor/react'

function getLang(path: string) {
  if (path.endsWith('.tsx') || path.endsWith('.ts')) return 'typescript'
  if (path.endsWith('.jsx') || path.endsWith('.js')) return 'javascript'
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.html')) return 'html'
  if (path.endsWith('.css')) return 'css'
  if (path.endsWith('.md')) return 'markdown'
  return 'javascript'
}

export function MonacoEditor({ path, value, onChange, theme }: {
  path: string, value: string, onChange: (v:string)=>void, theme?: string
}) {
  return (
    <Editor
      height="100%"
      path={path}
      language={getLang(path)}
      value={value}
      theme={theme || 'vs-dark'}
      onChange={(v)=> onChange(v||'')}
      options={{
        minimap:{enabled:false},
        fontSize:13,
        wordWrap:'on',
        scrollBeyondLastLine:false,
        automaticLayout:true
      }}
    />
  )
}
