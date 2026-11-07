import { Mastra } from '@mastra/core/mastra'
import { editorAgent } from './agents/editorAgent.js'
import { mastraStorage } from './storage.js'

export { storageUrl } from './storage.js'

export const mastra = new Mastra({
  agents: { editorAgent },
  storage: mastraStorage,
})
