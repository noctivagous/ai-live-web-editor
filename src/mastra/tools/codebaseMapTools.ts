import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getFsRoot } from '../../launcher.js'
import { formatCodebaseMap, findRegistryComponent } from '../../codebaseMap/codebaseMap.js'
import { adoptRegistry, buildAndPersistMap, installCatalogComponent } from '../../codebaseMap/mapStore.js'

export const codebaseMapTool = createTool({
  id: 'codebase-map',
  description:
    'Generated index of the active project: entry file, every source file\'s components/exports/renders/imports ranked by how imported they are, plus styles/token files — within a ~1k-token budget. Call this FIRST when you need "where is X rendered / who imports Y / what components already exist" instead of grepping file bodies. The same map is persisted at .ai-live/map.json. Pass focus (a component or need, e.g. "Button") to get the registry entry for reusing an existing component instead of inventing one.',
  inputSchema: z.object({
    budgetTokens: z.number().int().positive().max(4000).optional().describe('Signature budget in tokens (default 1000)'),
    focus: z.string().optional().describe('A component name or need to look up in the project registry, e.g. "button" or "pricing card"'),
  }),
  execute: async ({ budgetTokens, focus }) => {
    const map = buildAndPersistMap(getFsRoot())
    if (focus) {
      const hit = findRegistryComponent(map.components, focus)
      if (!hit) return { ok: true, focus, found: false, note: `No existing project component matches "${focus}" — building one is appropriate, or check the editor catalog with find-component.` }
      return {
        ok: true,
        focus,
        found: true,
        component: hit,
        reuse: `Reuse ${hit.name} from ${hit.file} (origin ${hit.origin}, used by ${hit.usedBy} file${hit.usedBy === 1 ? '' : 's'}): import it by name instead of inventing an equivalent.`,
      }
    }
    return {
      ok: true,
      text: formatCodebaseMap(map, budgetTokens ?? 1000),
      fileCount: map.fileCount,
      entry: map.entry,
      components: map.components.length,
      persistedAt: '.ai-live/map.json',
    }
  },
})

export const adoptRegistryTool = createTool({
  id: 'adopt-registry',
  description:
    'Adopt the inferred project component registry: writes it to .ai-live/components.json so it is treated as declared thereafter. Opt-in only — call this when the user agrees the discovered components are the project\'s registry. Never call it unprompted on project open/import.',
  inputSchema: z.object({}),
  execute: async () => adoptRegistry(getFsRoot()),
})

export const installCatalogComponentTool = createTool({
  id: 'install-catalog-component',
  description:
    'Copy a catalog component file into the active project (src/components/ui/), alongside — never replacing — the project\'s own components, so it appears in the codebase map/registry and later turns import it by name. Use after find-component identifies a fit. Fails if the file is already present.',
  inputSchema: z.object({
    tag: z.string().describe('Exact catalog tag, e.g. "Button"'),
  }),
  execute: async ({ tag }) => installCatalogComponent(tag, getFsRoot()),
})
