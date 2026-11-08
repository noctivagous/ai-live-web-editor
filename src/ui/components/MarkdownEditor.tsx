import React from 'react'
import { markdownAdapter } from '../lib/textDoc'
import { BaseTextEditor } from './BaseTextEditor'

/**
 * Markdown in the base text editor: the surface is BaseTextEditor,
 * the customisation is the markdown adapter (offset splices into
 * the .md file; size = heading levels; alignment and block weight
 * honestly unavailable, with their reasons on the greyed controls).
 */
export function MarkdownEditor({ path, onSaved, showAi = true, onDispatched }: {
  path: string
  onSaved: () => void
  showAi?: boolean
  onDispatched?: (title: string) => void
}) {
  return <BaseTextEditor path={path} adapter={markdownAdapter} aiRenderer="markdown" showAi={showAi} onSaved={onSaved} onDispatched={onDispatched} />
}
