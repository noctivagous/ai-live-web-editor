/**
 * Build-out (feature graphs): turning one graph node from a
 * description into project reality.
 *
 * - A `component` binding is copy-installed from the catalog
 *   (the install-catalog-component path, registry included).
 * - A `template` binding is placed (the place-template path).
 * - A node with parameters gets its values seeded from defaults,
 *   and its effective values written to `src/config/<node>.json` —
 *   the file the built app reads its settings from. feature-set-param
 *   rewrites that file on every change, so graph and app never
 *   disagree about a setting's value.
 * - The node's status moves to `building` when it was only
 *   proposed/planned.
 *
 * Placement is idempotent by the underlying operations' own rule
 * (install/place never replace a project file): a repeat build
 * reports each binding as `already`, it does not fail. A binding
 * that cannot be placed (unknown tag, missing source) reports
 * `error` for that binding without rolling back the others.
 */
import fs from 'node:fs'
import path from 'node:path'
import { installCatalogComponent } from '../codebaseMap/mapStore.js'
import { placeTemplate } from '../catalog/templates.js'
import {
  effectiveValues, getNode, nodeSummary, seedValues, setNodeStatus,
  type FeatureGraph, type FeatureNode, type NodeSummary,
} from './features.js'

export interface BindingResult {
  state: 'placed' | 'already' | 'error'
  dest?: string
  error?: string
}

export type BuildNodeResult =
  | {
      ok: true
      node: NodeSummary
      component?: BindingResult
      template?: BindingResult
      valuesSeeded: number
      configFile?: string
    }
  | { ok: false, error: string }

function slugFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'settings'
}

/** The project path of a parameterized node's values file. */
export function configPathFor(node: FeatureNode): string {
  return `/src/config/${slugFor(node.name)}.json`
}

/** Write a parameterized node's effective values where the app reads them. */
export function writeNodeConfig(node: FeatureNode, root: string): string | undefined {
  if (!node.params?.length) return undefined
  const rel = configPathFor(node)
  const dest = path.join(root, '.' + rel)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, JSON.stringify(effectiveValues(node), null, 2) + '\n', 'utf-8')
  return rel
}

function placement(result: { ok: boolean, dest?: string, error?: string }): BindingResult {
  if (result.ok) return { state: 'placed', dest: result.dest }
  if (result.error?.startsWith('Already present')) return { state: 'already', error: result.error }
  return { state: 'error', error: result.error ?? 'placement failed' }
}

export function buildNode(graph: FeatureGraph, nodeId: string, root: string): BuildNodeResult {
  const node = getNode(graph, nodeId)
  if (!node) return { ok: false, error: `No node with id ${nodeId} in the feature graph.` }

  const component = node.component
    ? placement(installCatalogComponent(node.component, root))
    : undefined
  const template = node.template
    ? placement(placeTemplate(node.template, root))
    : undefined
  const valuesSeeded = node.params?.length ? seedValues(node) : 0
  const configFile = writeNodeConfig(node, root)
  if (node.status === 'proposed' || node.status === 'planned') {
    setNodeStatus(graph, node.id, 'building')
  }
  return {
    ok: true,
    node: nodeSummary(node),
    ...(component ? { component } : {}),
    ...(template ? { template } : {}),
    valuesSeeded,
    ...(configFile ? { configFile } : {}),
  }
}
