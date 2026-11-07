import { askAi } from './api'
import { promptTextFor, type ActionContext, type AgentAction } from './agentActions'

/** View changes only App can make; everything else rides window events. */
export interface ActionViewHooks {
  openLibrary: () => void
  openSettings: (section: string) => void
}

/**
 * The one dispatch path every action surface uses (menu, palette,
 * ⌘K search): prompt actions through the existing ask-AI channel,
 * plan/graph through their overlay events, Library/Settings through
 * the App hooks.
 */
export function runAction(a: AgentAction, ctx: ActionContext, view: ActionViewHooks): void {
  const d = a.dispatch
  if (d.kind === 'prompt') askAi(promptTextFor(a, ctx))
  else if (d.kind === 'plan') window.dispatchEvent(new CustomEvent('ai-live:plan-open', { detail: { goal: d.goal } }))
  else if (d.kind === 'graph') window.dispatchEvent(new CustomEvent('ai-live:graph-open', {}))
  else if (d.kind === 'library') view.openLibrary()
  else if (d.kind === 'settings') view.openSettings(d.section)
}
