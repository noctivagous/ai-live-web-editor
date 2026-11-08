import React from 'react'
import { rtfAdapter } from '../lib/textDoc'
import { BaseTextEditor } from './BaseTextEditor'

/**
 * RTF in the base text editor: the same surface as markdown, with
 * the RTF adapter — font size, weight and alignment all real here.
 * RTF is a generated format, so the adapter rewrites the whole
 * file from the document model on an edit (the registry records
 * the richtext surface as a 'whole-file' write).
 */
export function RichTextEditor({ path, onSaved, showAi = true, onDispatched }: {
  path: string
  onSaved: () => void
  showAi?: boolean
  onDispatched?: (title: string) => void
}) {
  return <BaseTextEditor path={path} adapter={rtfAdapter} aiRenderer="richtext" showAi={showAi} onSaved={onSaved} onDispatched={onDispatched} />
}
