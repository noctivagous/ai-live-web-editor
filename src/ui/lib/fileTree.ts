/**
 * File-tree model for the file browser pane: build a folder tree from
 * the flat path list the launcher returns, sort it, filter it, and
 * flatten it to the visible rows the pane renders. Pure functions
 * only — rendering and all filesystem effects live elsewhere, and
 * every operation the pane offers goes through the fs API, never
 * through state invented here.
 */

export interface TreeNode {
  name: string
  /** Absolute project path, e.g. /src/lib/a.ts (no trailing slash). */
  path: string
  isDir: boolean
  children: TreeNode[]
}

export type SortMode = 'name' | 'name-desc' | 'type' | 'type-desc' | 'modified' | 'modified-asc'

export type SortBase = 'name' | 'type' | 'modified'

/** Split a SortMode into field + direction. Ascending means A→Z for
 * name/type and oldest-first for modified. */
export function splitSort(mode: SortMode): { base: SortBase; asc: boolean } {
  if (mode === 'name-desc') return { base: 'name', asc: false }
  if (mode === 'type') return { base: 'type', asc: true }
  if (mode === 'type-desc') return { base: 'type', asc: false }
  if (mode === 'modified') return { base: 'modified', asc: false }
  if (mode === 'modified-asc') return { base: 'modified', asc: true }
  return { base: 'name', asc: true }
}

/** Recombine a field + direction into a SortMode. */
export function joinSort(base: SortBase, asc: boolean): SortMode {
  if (base === 'type') return asc ? 'type' : 'type-desc'
  if (base === 'modified') return asc ? 'modified-asc' : 'modified'
  return asc ? 'name' : 'name-desc'
}

function segments(p: string): string[] {
  return p.split('/').filter(Boolean)
}

/** Build the tree from the flat file list plus the (possibly empty)
 * directory list — directories come from the server so empty folders
 * exist in the tree too, not just ones implied by file paths. */
export function buildTree(files: string[], dirs: string[] = []): TreeNode[] {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] }
  const ensureDir = (parts: string[]): TreeNode => {
    let node = root
    let acc = ''
    for (const part of parts) {
      acc += '/' + part
      let next = node.children.find(c => c.isDir && c.path === acc)
      if (!next) {
        next = { name: part, path: acc, isDir: true, children: [] }
        node.children.push(next)
      }
      node = next
    }
    return node
  }
  for (const d of [...dirs].sort()) ensureDir(segments(d))
  for (const f of files) {
    const parts = segments(f)
    if (!parts.length) continue
    const parent = ensureDir(parts.slice(0, -1))
    const path = '/' + parts.join('/')
    if (!parent.children.some(c => c.path === path)) {
      parent.children.push({ name: parts[parts.length - 1], path, isDir: false, children: [] })
    }
  }
  return root.children
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

function newestMtime(node: TreeNode, mtimes: Record<string, number>): number {
  if (!node.isDir) return mtimes[node.path] ?? 0
  return node.children.reduce((m, c) => Math.max(m, newestMtime(c, mtimes)), 0)
}

/** Sort recursively: folders always group before files; within a group
 * the mode decides (name A→Z or Z→A, type by extension then name in
 * either direction, modified newest-first or oldest-first — a folder
 * sorts by its newest descendant). */
export function sortTree(nodes: TreeNode[], mode: SortMode, mtimes: Record<string, number> = {}): TreeNode[] {
  const { base, asc } = splitSort(mode)
  const dir = asc ? 1 : -1
  const byName = (a: TreeNode, b: TreeNode) => a.name.localeCompare(b.name)
  const cmp = (a: TreeNode, b: TreeNode): number => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    let d = 0
    if (base === 'name') d = dir * byName(a, b)
    else {
      if (base === 'type' && !a.isDir) d = dir * extensionOf(a.name).localeCompare(extensionOf(b.name))
      if (!d && base === 'modified') d = dir * (newestMtime(a, mtimes) - newestMtime(b, mtimes))
      if (!d) d = byName(a, b)
    }
    return d
  }
  return [...nodes].sort(cmp).map(n => (n.isDir ? { ...n, children: sortTree(n.children, mode, mtimes) } : n))
}

/** A path is hidden when any segment starts with a dot. */
export function isHiddenPath(p: string): boolean {
  return segments(p).some(s => s.startsWith('.'))
}

export function visibleTree(nodes: TreeNode[], showHidden: boolean): TreeNode[] {
  if (showHidden) return nodes
  return nodes
    .filter(n => !isHiddenPath(n.path))
    .map(n => (n.isDir ? { ...n, children: visibleTree(n.children, showHidden) } : n))
}

/** Keep only nodes whose name/path matches the query, plus ancestors
 * of matches (and, for a matching folder, its whole subtree). */
export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes
  const out: TreeNode[] = []
  for (const n of nodes) {
    const selfMatch = n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)
    if (!n.isDir) {
      if (selfMatch) out.push(n)
    } else if (selfMatch) {
      out.push(n)
    } else {
      const kids = filterTree(n.children, q)
      if (kids.length) out.push({ ...n, children: kids })
    }
  }
  return out
}

export function countMatches(nodes: TreeNode[], query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  let n = 0
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.name.toLowerCase().includes(q)) n += 1
      if (node.isDir) walk(node.children)
    }
  }
  walk(nodes)
  return n
}

export interface FlatRow { node: TreeNode, depth: number }

export function flattenVisible(nodes: TreeNode[], collapsed: ReadonlySet<string>): FlatRow[] {
  const out: FlatRow[] = []
  const walk = (list: TreeNode[], depth: number) => {
    for (const node of list) {
      out.push({ node, depth })
      if (node.isDir && !collapsed.has(node.path)) walk(node.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return out
}

/** All folder paths in the tree (for collapse-all). */
export function allDirPaths(nodes: TreeNode[]): string[] {
  const out: string[] = []
  const walk = (list: TreeNode[]) => {
    for (const n of list) if (n.isDir) { out.push(n.path); walk(n.children) }
  }
  walk(nodes)
  return out
}

/** Entries strictly under a node (0 for a file). The delete
 * confirmation names this number plus the node itself. */
export function entriesUnder(node: TreeNode): number {
  let n = 0
  for (const c of node.children) {
    n += 1
    if (c.isDir) n += entriesUnder(c)
  }
  return n
}

/** Validate a new entry name against its future siblings. Returns a
 * user-readable error, or null when the name is fine. */
export function validateEntryName(name: string, siblingNames: ReadonlySet<string>): string | null {
  const n = name.trim()
  if (!n) return 'Name required'
  if (n !== name) return 'Name cannot start or end with a space'
  if (n.includes('/') || n.includes('\\')) return 'Name cannot contain / or \\'
  if (n === '.' || n === '..') return 'Name cannot be . or ..'
  if (siblingNames.has(n)) return `A file or folder named ${n} already exists here`
  return null
}

/** Find a node by path ('' finds nothing; the root is not a node). */
export function findNode(nodes: TreeNode[], target: string): TreeNode | null {
  for (const n of nodes) {
    if (n.path === target) return n
    if (n.isDir && target.startsWith(n.path + '/')) {
      const hit = findNode(n.children, target)
      if (hit) return hit
    }
  }
  return null
}

/** Child names of a directory path ('' = root), for validation. */
export function siblingNames(nodes: TreeNode[], dirPath: string): Set<string> {
  const kids = dirPath === '' ? nodes : (findNode(nodes, dirPath)?.children ?? [])
  return new Set(kids.map(c => c.name))
}

export function parentPath(p: string): string {
  const i = p.lastIndexOf('/')
  return i <= 0 ? '' : p.slice(0, i)
}

export function baseName(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1)
}
