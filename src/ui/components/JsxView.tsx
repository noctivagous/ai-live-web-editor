import React from 'react'
import { JsBasedComponentView } from './JsBasedComponentView'

/**
 * The .jsx surface: the shared js-based component viewer at
 * `kind="jsx"`. `.tsx` and plain `.js` viewers inherit the same
 * base with their own kind; a WebComponent viewer will inherit
 * the shell with a different doc provider.
 */
export function JsxView({ path, onSaved }: { path: string, onSaved: () => void }) {
  return <JsBasedComponentView path={path} kind="jsx" onSaved={onSaved} />
}
