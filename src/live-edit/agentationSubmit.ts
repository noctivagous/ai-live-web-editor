/**
 * Shared handler for Agentation submits (Step 5, Rung 1): adapts the
 * toolbar's annotation payload onto the same live-edit prompt the
 * overlay submit uses — summarize, resolve, build the prompt — and
 * returns it so the caller can send it as a real AI-chat turn. The
 * agent run itself happens in the chat (streaming, visible, with the
 * chat's workflow routing), not in a hidden call here, so both server
 * entry points (apiApp, standalone launcher) behave identically, in
 * Files mode and in Live sketch mode alike.
 */
import { agentationToAnnotations, buildLiveEditPrompt, summarizeAnnotations } from './annotationAnalysis.js'
import { getSketchMode } from '../sketchSession.js'
import { getFsRoot } from '../launcher.js'

export interface AgentationPromptResult {
  status: number
  payload: Record<string, unknown>
}

export async function prepareAgentationPrompt(body: any): Promise<AgentationPromptResult> {
  try {
    const raw = Array.isArray(body?.annotations) ? body.annotations : []
    const annotations = agentationToAnnotations(raw, getFsRoot())
    const pageNotes = typeof body?.notes === 'string' ? body.notes : ''
    if (!annotations.length && !pageNotes) {
      return { status: 400, payload: { ok: false, error: 'No annotations submitted' } }
    }
    const mode = getSketchMode()
    const summary = summarizeAnnotations(annotations)
    const { resolveAnnotationSelectors } = await import('../mastra/tools/resolveSourceTool.js')
    const resolutions = resolveAnnotationSelectors(annotations)
    const prompt = buildLiveEditPrompt({
      annotations,
      summary,
      pageNotes,
      pageUrl: typeof body?.url === 'string' ? body.url : '',
      resolutions,
      mode,
    })
    return {
      status: 200,
      payload: {
        ok: true,
        prompt,
        annotationCount: annotations.length,
        prioritizedIds: summary.prioritizedIds,
        mode,
      },
    }
  } catch (e: any) {
    console.error(e)
    return { status: 500, payload: { ok: false, error: e?.message || 'Prompt build failed' } }
  }
}
