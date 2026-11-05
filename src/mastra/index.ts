import { Mastra } from '@mastra/core/mastra'
import { editorAgent } from './agents/editorAgent.js'

export const mastra = new Mastra({
  agents: { editorAgent }
})
