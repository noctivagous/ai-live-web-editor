import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getTemplate, loadTemplates, placeTemplate } from '../../catalog/templates.js'
import { getFsRoot } from '../../launcher.js'

export const placeTemplateTool = createTool({
  id: 'place-template',
  description:
    'Place one of the editor\'s layout templates (named arrangements from catalog/templates.json — hero module, three-column row, pricing section) into the active project as ONE file write at its target path. Use this instead of generating a common layout from scratch: after placing, customise the constants at the top of the file with str-replace and import the component where it belongs. Fails if the target file already exists (placing never replaces). Pass a template id; omit it to list the available templates.',
  inputSchema: z.object({
    template: z.string().optional().describe('Template id, e.g. "pricing-section". Omit to list templates.'),
  }),
  execute: async ({ template }) => {
    if (!template) {
      return { ok: true, templates: loadTemplates().templates }
    }
    const entry = getTemplate(template)
    if (!entry) return { ok: false, error: `No template with id ${template}` }
    const placed = placeTemplate(template, getFsRoot())
    return placed.ok
      ? { ...placed, note: `Placed ${entry.name} at ${placed.dest}. Customise the constants at the top of the file with str-replace, then import it where it belongs.` }
      : placed
  },
})
