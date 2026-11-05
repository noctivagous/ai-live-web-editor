import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getPage } from '../../browserPool.js'
import {
  installAnnotationOverlay,
  collectAnnotationsFromPage,
  exportAnnotationsFromPage,
  importAnnotationsToPage,
  setBaselineOnPage,
} from '../../live-edit/annotationOverlay.js'

export const getPageAnnotationsTool = createTool({
  id: 'get-page-annotations',
  description:
    'Export the user page annotations from the live browser pool and clear them (submit semantics). Use when handling a live-edit request.',
  inputSchema: z.object({ url: z.string().optional().describe('Navigate the pool page here first') }),
  execute: async (input: Record<string, any>) => {
    try {
      const page = await getPage(input.url)
      await installAnnotationOverlay(page).catch(() => {})
      const { annotations, pageNotes } = await collectAnnotationsFromPage(page)
      return { annotations, pageNotes, count: annotations.length }
    } catch (e: any) {
      return { error: e.message }
    }
  },
})

export const peekPageAnnotationsTool = createTool({
  id: 'peek-page-annotations',
  description: 'Read user page annotations from the live browser pool without clearing them.',
  inputSchema: z.object({ url: z.string().optional() }),
  execute: async (input: Record<string, any>) => {
    try {
      const page = await getPage(input.url)
      const { annotations, pageNotes } = await exportAnnotationsFromPage(page)
      return { annotations, pageNotes, count: annotations.length }
    } catch (e: any) {
      return { error: e.message }
    }
  },
})

export const importPageAnnotationsTool = createTool({
  id: 'import-page-annotations',
  description: 'Push annotations into the pool page overlay so they render as tags where the agent works.',
  inputSchema: z.object({
    annotations: z.array(z.object({
      selector: z.string(),
      text: z.string(),
      type: z.string().optional(),
      targetSelector: z.string().optional(),
    })),
    url: z.string().optional(),
  }),
  execute: async (input: Record<string, any>) => {
    try {
      const page = await getPage(input.url)
      await installAnnotationOverlay(page).catch(() => {})
      const ok = await importAnnotationsToPage(page, input.annotations || [])
      return { ok, count: (input.annotations || []).length }
    } catch (e: any) {
      return { error: e.message }
    }
  },
})

export const setAnnotateBaselineTool = createTool({
  id: 'set-annotate-baseline',
  description: 'Stash a baseline wireframe JSON on the pool page for before/after diffing.',
  inputSchema: z.object({
    wireframeJson: z.string().describe('Wireframe snapshot JSON from layout-snapshot'),
    url: z.string().optional(),
  }),
  execute: async (input: Record<string, any>) => {
    try {
      const page = await getPage(input.url)
      await setBaselineOnPage(page, input.wireframeJson)
      return { ok: true }
    } catch (e: any) {
      return { error: e.message }
    }
  },
})
