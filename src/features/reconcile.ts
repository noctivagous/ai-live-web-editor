/**
 * Drift reconciliation (feature graphs): the graph is the
 * AS-INTENDED map; the project on disk is the AS-BUILT territory.
 * A node marked done/verified claims its bindings exist in the
 * project — reconcile checks that claim, binding by binding:
 *
 * - a component binding exists when its catalog install file is
 *   present in the project, or (for a binding that names a
 *   project component rather than a vendored catalog entry) the
 *   codebase map finds a component with that name;
 * - a template binding exists when the template's target file is
 *   present;
 * - a parameterized node exists, settings-wise, when its
 *   src/config/<node>.json values file is present.
 *
 * Only done/verified nodes are checked: a proposed node's
 * bindings are SUPPOSED to be missing — that is intent, not
 * drift. Nodes without bindings cannot drift in any checkable
 * way and are skipped. Read-only: reconcile reports; fixes are
 * feature-build-node (re-place), feature-set-status (unclaim),
 * or the ordinary file tools.
 */
import fs from 'node:fs'
import path from 'node:path'
import { getComponent, loadCatalog } from '../catalog/catalog.js'
import { getTemplate } from '../catalog/templates.js'
import { buildMapForRoot } from '../codebaseMap/mapStore.js'
import { configPathFor } from './buildNode.js'
import type { FeatureGraph } from './features.js'

export interface DriftItem {
  nodeId: string
  node: string
  binding: string
  problem: string
}

export function reconcileGraph(graph: FeatureGraph, root: string): { drift: DriftItem[], checked: number } {
  const drift: DriftItem[] = []
  let checked = 0
  // The codebase map is built at most once per reconcile, and
  // only when a non-catalog component binding actually needs it.
  let mapNames: Set<string> | null = null
  const projectComponentNames = () => {
    if (!mapNames) {
      mapNames = new Set(buildMapForRoot(root).components.map(c => c.name))
    }
    return mapNames
  }

  for (const node of graph.nodes) {
    if (node.status !== 'done' && node.status !== 'verified') continue
    if (node.component) {
      checked += 1
      const entry = getComponent(node.component, loadCatalog())
      if (entry?.sourceFile?.startsWith('catalog/stock/')) {
        const dest = `/src/components/ui/${path.basename(entry.sourceFile)}`
        if (!fs.existsSync(path.join(root, '.' + dest))) {
          drift.push({
            nodeId: node.id, node: node.name, binding: `component ${node.component}`,
            problem: `marked ${node.status} but the installed component file ${dest} is not in the project`,
          })
        }
      } else {
        const names = entry?.exports?.length ? entry.exports : [node.component]
        if (!names.some(name => projectComponentNames().has(name))) {
          drift.push({
            nodeId: node.id, node: node.name, binding: `component ${node.component}`,
            problem: `marked ${node.status} but the codebase map finds no component named ${names.join(' or ')}`,
          })
        }
      }
    }
    if (node.template) {
      checked += 1
      const template = getTemplate(node.template)
      if (!template) {
        drift.push({
          nodeId: node.id, node: node.name, binding: `template ${node.template}`,
          problem: `marked ${node.status} but no template with id ${node.template} exists in the catalog anymore`,
        })
      } else if (!fs.existsSync(path.join(root, '.' + template.target))) {
        drift.push({
          nodeId: node.id, node: node.name, binding: `template ${node.template}`,
          problem: `marked ${node.status} but the placed template file ${template.target} is not in the project`,
        })
      }
    }
    if (node.params?.length) {
      checked += 1
      const rel = configPathFor(node)
      if (!fs.existsSync(path.join(root, '.' + rel))) {
        drift.push({
          nodeId: node.id, node: node.name, binding: 'parameters',
          problem: `marked ${node.status} but its values file ${rel} is not in the project`,
        })
      }
    }
  }
  return { drift, checked }
}
