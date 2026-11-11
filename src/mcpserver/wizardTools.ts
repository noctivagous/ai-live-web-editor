/**
 * Wizard tools for the ALE MCP server (Muse Code design §9,
 * slice 8): ale_open_wizard (the UI head) and ale_run_wizard
 * (the headless head), over the two-headed registry in
 * wizards.ts.
 *
 * ale_open_wizard is the spike's preferred Q3 channel
 * (SPIKE item 4): the tool call STAYS OPEN while the user
 * completes or cancels the wizard in the editor, then returns
 * the structured outcome (or a cancellation). The machinery
 * rides the WizardCompletion promise registry, so the channel
 * could swap without touching wizards. A cancel or timeout
 * resolves the call with a cancelled outcome — never a hang,
 * never an error the agent would retry against.
 */
import { obj, str, type AleToolDef } from './tools.js'
import {
  completeWizard, openWizardCompletion, wizardReady, wizardRegistration, wizardRegistrations,
  type WizardOutcome,
} from './wizards.js'

type Input = Record<string, any>

async function openWizard(input: Input): Promise<unknown> {
  const wizardId = typeof input.wizardId === 'string' ? input.wizardId : ''
  const reg = wizardRegistration(wizardId)
  if (!reg) return { ok: false, error: `No wizard with id "${wizardId}". ale_list_wizards shows the registry.` }
  if (!wizardReady(reg) || !reg.heads) {
    return { ok: false, error: `"${reg.title}" is not built yet — it is a named stub in the registry with no heads. Say so rather than imitating it.` }
  }
  const prefill = (input.prefill && typeof input.prefill === 'object' ? input.prefill : {}) as Record<string, unknown>
  // The UI head validates its prefill with the shared
  // validation when the prefill carries input-shaped fields:
  // an invalid prefill fails HERE, before the user is shown a
  // wizard that can only refuse.
  if (Object.keys(prefill).length) {
    const problem = reg.heads.validate({ ...prefill })
    if (problem) return { ok: false, error: problem }
  }
  const { promise } = openWizardCompletion(wizardId, prefill)
  const outcome = await promise
  return { ok: outcome.status === 'completed', via: 'ui', ...outcome }
}

async function runWizard(input: Input): Promise<unknown> {
  const wizardId = typeof input.wizardId === 'string' ? input.wizardId : ''
  const reg = wizardRegistration(wizardId)
  if (!reg) return { ok: false, error: `No wizard with id "${wizardId}". ale_list_wizards shows the registry.` }
  if (!wizardReady(reg) || !reg.heads) {
    return { ok: false, error: `"${reg.title}" is not built yet — it is a named stub in the registry with no heads. Say so rather than imitating it.` }
  }
  const args = (input.input && typeof input.input === 'object' ? input.input : {}) as Record<string, any>
  const problem = reg.heads.validate(args)
  if (problem) return { ok: false, error: problem }
  const outcome: WizardOutcome = await reg.heads.headless.execute(args)
  return { ok: outcome.status === 'completed', via: 'headless', ...outcome }
}

async function listWizards(): Promise<unknown> {
  return {
    ok: true,
    wizards: wizardRegistrations().map((r) => ({
      id: r.id, title: r.title, facet: r.facet,
      ready: wizardReady(r),
      ...(r.heads ? {
        uiComponent: r.heads.ui.component,
        headlessInput: r.heads.headless.inputSchema,
        defaults: r.heads.headless.defaults,
      } : { stub: true }),
    })),
  }
}

export const ALE_WIZARD_TOOLS: AleToolDef[] = [
  {
    name: 'ale_open_wizard',
    description: 'Open a wizard in the editor for the USER to drive (the UI head). Use when a real user decision is missing — which pack, which option — that the brief does not settle. The call stays open while the wizard is on screen and returns its structured outcome; if the user cancels, or the wizard is left open past its window, the result is a cancellation (an answer, not an error — acknowledge it, don’t retry the same open). Ready wizards are listed by ale_list_wizards; stubs refuse plainly.',
    inputSchema: obj({
      wizardId: str('The wizard id (e.g. "add-feature")'),
      prefill: { type: 'object', description: 'Fields to prefill the wizard with (validated by the wizard’s shared validation)' },
    }, ['wizardId']),
    run: openWizard,
  },
  {
    name: 'ale_run_wizard',
    description: 'Run a wizard’s effect HEADLESSLY (the headless head) with stated defaults — use when the brief already answers the wizard’s questions (the user named the pack and accepted defaults, or a plan step specifies the effect). The outcome records that the headless head ran and with what input, so the user can see what was decided on their behalf. Validation is shared with the UI head: a refusal here is the same refusal the UI would give.',
    inputSchema: obj({
      wizardId: str('The wizard id (e.g. "add-feature")'),
      input: { type: 'object', description: 'The wizard’s input (see ale_list_wizards for its schema and defaults policy)' },
    }, ['wizardId']),
    run: runWizard,
  },
  {
    name: 'ale_list_wizards',
    description: 'List ALE’s wizards: which are ready (both heads declared, with the headless input schema and defaults policy) and which are named stubs not yet built.',
    inputSchema: obj({}),
    run: () => listWizards(),
  },
]

/** The completion POST's handler shape, exported for the API
 * module: resolve a pending UI completion from the editor's
 * report. */
export function reportWizardCompletion(completionId: string, outcome: WizardOutcome): boolean {
  return completeWizard(completionId, outcome)
}
