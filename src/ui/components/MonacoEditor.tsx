import React, { useEffect } from 'react'
import Editor from '@monaco-editor/react'
import type { UiPrefs } from '../lib/uiPrefs'

function getLang(path: string) {
  if (path.endsWith('.tsx') || path.endsWith('.ts')) return 'typescript'
  if (path.endsWith('.jsx') || path.endsWith('.js')) return 'javascript'
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.html')) return 'html'
  if (path.endsWith('.css')) return 'css'
  if (path.endsWith('.md')) return 'markdown'
  return 'javascript'
}

type EditorOptionPrefs = Pick<UiPrefs, 'editorFontSize' | 'editorTabSize' | 'editorWordWrap' | 'editorMinimap' | 'editorLineNumbers'>

export function MonacoEditor({ path, value, onChange, theme, editorPrefs }: {
  path: string, value: string, onChange: (v: string) => void, theme?: string, editorPrefs?: EditorOptionPrefs
}) {
  return (
    <Editor
      height="100%"
      path={path}
      language={getLang(path)}
      value={value}
      theme={theme || 'vs-dark'}
      onChange={(v) => onChange(v || '')}
      options={{
        minimap: { enabled: editorPrefs?.editorMinimap ?? false },
        fontSize: editorPrefs?.editorFontSize ?? 13,
        wordWrap: (editorPrefs?.editorWordWrap ?? true) ? 'on' : 'off',
        tabSize: editorPrefs?.editorTabSize ?? 4,
        lineNumbers: (editorPrefs?.editorLineNumbers ?? true) ? 'on' : 'off',
        scrollBeyondLastLine: false,
        automaticLayout: true
      }}
    />
  )
}
