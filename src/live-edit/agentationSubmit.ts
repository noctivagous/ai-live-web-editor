/**
 * Shared handler for Agentation submits (Step 5, Rung 1): adapts the
 * toolbar's annotation payload onto the same live-edit pipeline the
 * overlay submit uses — summarize, build the prompt, run the editor
 * agent — so both server entry points (apiApp, standalone launcher)
 * behave identically.
 */
import { agentationToAnnotations, buildLiveEditPrompt, summarizeAnnotations } from './annotationAnalysis.js'
import { activeToolsForMode } from '../agentTools.js'
import { getSketchMode } from '../sketchSession.js'
import { getFsRoot } from '../launcher.js'

export interface AgentationSubmitResult {
  status: number
  payload: Record<string, unknown>
}

export async function handleAgentationSubmit(body: any): Promise<AgentationSubmitResult> {
  const raw = Array.isArray(body?.annotations) ? body.annotations : []
  const annotations = agentationToAnnotations(raw, getFsRoot())
  const pageNotes = typeof body?.notes === 'string' ? body.notes : ''
  if (!annotations.length && !pageNotes) {
    return { status: 400, payload: { ok: false, error: 'No annotations submitted' } }
  }
  const summary = summarizeAnnotations(annotations)
  const prompt = buildLiveEditPrompt({
    annotations,
    summary,
    pageNotes,
    pageUrl: typeof body?.url === 'string' ? body.url : '',
  })
  try {
    const { mastra } = await import('../mastra/index.js')
    const agent = mastra.getAgent('editorAgent')
    const result = await agent.generate([{ role: 'user', content: prompt }], {
      maxSteps: 12,
      activeTools: activeToolsForMode(getSketchMode()),
    })
    return {
      status: 200,
      payload: {
        ok: true,
        text: result.text,
        toolCalls: result.toolCalls,
        annotationCount: annotations.length,
        prioritizedIds: summary.prioritizedIds,
      },
    }
  } catch (e: any) {
    console.error(e)
    return { status: 500, payload: { ok: false, error: e?.message || 'Agent run failed' } }
  }
}
