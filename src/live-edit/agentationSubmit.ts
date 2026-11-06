/**
 * Shared handler for Agentation submits (Step 5, Rung 1): adapts the
 * toolbar's annotation payload onto the same live-edit pipeline the
 * overlay submit uses — summarize, resolve, build the prompt, run the
 * editor agent — so both server entry points (apiApp, standalone
 * launcher) behave identically, in Files mode and in Live sketch
 * mode alike (the mode-aware prompt and tool set come from the
 * session's current sketch mode, exactly as for overlay submits).
 */
import { agentationToAnnotations, buildLiveEditPrompt, summarizeAnnotations } from './annotationAnalysis.js'
import { activeToolsForMode } from '../agentTools.js'
import { getSketchMode, withSketchPreamble } from '../sketchSession.js'
import { getFsRoot } from '../launcher.js'

export interface AgentationSubmitResult {
  status: number
  payload: Record<string, unknown>
}

export async function handleAgentationSubmit(body: any): Promise<AgentationSubmitResult> {
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
    const { mastra } = await import('../mastra/index.js')
    const agent = mastra.getAgent('editorAgent')
    const messages = mode === 'sketch'
      ? withSketchPreamble([{ role: 'user', content: prompt }])
      : [{ role: 'user', content: prompt }]
    const result = await agent.generate(messages as any, {
      maxSteps: 12,
      activeTools: activeToolsForMode(mode),
    })
    return {
      status: 200,
      payload: {
        ok: true,
        text: result.text,
        toolCalls: result.toolCalls,
        annotationCount: annotations.length,
        prioritizedIds: summary.prioritizedIds,
        mode,
      },
    }
  } catch (e: any) {
    console.error(e)
    return { status: 500, payload: { ok: false, error: e?.message || 'Agent run failed' } }
  }
}
