/**
 * Workbench programs: pure code transforms that take source text in and
 * return an organised, structured result — the heavy lifting happens here,
 * once, instead of the model re-deriving structure from raw text on every
 * step. Programs never touch the original file; callers persist outputs
 * to scratch space (.ai-live/) and hand the agent the map, not the mass.
 *
 * Slice 1 is `unpack`: de-minify + section index for one dense JS/TS file.
 * Programs that need the live environment (DOM/CSSOM) will run the same
 * shape through the browser pool when they arrive.
 */
import { transformSync } from 'esbuild'
import * as acorn from 'acorn'

export interface UnpackSection {
  kind: 'imports' | 'function' | 'class' | 'const' | 'export' | 'statement'
  name: string
  startLine: number
  endLine: number
  /** First line of the section, clipped — enough to recognise it. */
  signature: string
}

export interface UnpackOutput {
  formatted: string
  loader: string
  sections: UnpackSection[]
  /** Set when formatting failed; `formatted` is then the untouched source. */
  formatError?: string
  /** Set when the section index could not be built (exotic syntax). */
  sectionNote?: string
}

const LOADERS: Record<string, 'js' | 'jsx' | 'ts' | 'tsx'> = {
  '.ts': 'ts',
  '.tsx': 'tsx',
  '.jsx': 'jsx',
  '.js': 'jsx',
  '.mjs': 'jsx',
  '.cjs': 'jsx',
}

export function loaderForPath(p: string): string | null {
  const dot = p.lastIndexOf('.')
  if (dot < 0) return null
  return LOADERS[p.slice(dot).toLowerCase()] ?? null
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

type AstNode = {
  type: string
  loc?: { start: { line: number }, end: { line: number } } | null
  [key: string]: unknown
}

function sectionIndex(formatted: string): { sections: UnpackSection[], note?: string } {
  let ast: { body: AstNode[] } | null = null
  let lastError: unknown = null
  for (const sourceType of ['module', 'script'] as const) {
    try {
      ast = acorn.parse(formatted, { ecmaVersion: 'latest', sourceType, locations: true }) as unknown as { body: AstNode[] }
      lastError = null
      break
    } catch (e) {
      lastError = e
    }
  }
  if (!ast) {
    return { sections: [], note: `Section index unavailable: ${lastError instanceof Error ? lastError.message : String(lastError)}` }
  }
  const lines = formatted.split('\n')
  const sections: UnpackSection[] = []
  let importRun: AstNode[] = []
  const flushImports = () => {
    if (!importRun.length) return
    const first = importRun[0]
    const last = importRun[importRun.length - 1]
    sections.push({
      kind: 'imports',
      name: `${importRun.length} import${importRun.length === 1 ? '' : 's'}`,
      startLine: first.loc?.start.line ?? 1,
      endLine: last.loc?.end.line ?? 1,
      signature: clip(lines[(first.loc?.start.line ?? 1) - 1] || '', 100),
    })
    importRun = []
  }
  const push = (node: AstNode, kind: UnpackSection['kind'], name: string) => {
    const startLine = node.loc?.start.line ?? 1
    sections.push({
      kind,
      name,
      startLine,
      endLine: node.loc?.end.line ?? startLine,
      signature: clip(lines[startLine - 1] || '', 100),
    })
  }
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      importRun.push(node)
      continue
    }
    flushImports()
    if (node.type === 'FunctionDeclaration') {
      push(node, 'function', (node.id as { name?: string } | null)?.name || '(anonymous)')
    } else if (node.type === 'ClassDeclaration') {
      push(node, 'class', (node.id as { name?: string } | null)?.name || '(anonymous)')
    } else if (node.type === 'VariableDeclaration') {
      const decls = (node.declarations as AstNode[]) || []
      const first = decls[0]
      const id = first?.id as { name?: string, type?: string } | undefined
      const init = first?.init as { type?: string } | null | undefined
      const isFn = init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression'
      const name = (id?.name || '(pattern)') + (decls.length > 1 ? ` +${decls.length - 1}` : '')
      push(node, isFn ? 'function' : 'const', name)
    } else if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration' || node.type === 'ExportAllDeclaration') {
      const decl = node.declaration as AstNode | null | undefined
      const declId = decl?.id as { name?: string } | null | undefined
      const declName = decl?.type === 'VariableDeclaration'
        ? (((decl.declarations as AstNode[])?.[0]?.id as { name?: string } | undefined)?.name || '')
        : (declId?.name || '')
      push(node, 'export', declName || (node.type === 'ExportDefaultDeclaration' ? 'default' : 'export'))
    } else {
      push(node, 'statement', clip(lines[(node.loc?.start.line ?? 1) - 1] || node.type, 40))
    }
  }
  flushImports()
  return { sections }
}

/** De-minify one JS/TS source and index its top-level sections. Pure. */
export function unpackSource(source: string, filename: string): UnpackOutput {
  const loader = loaderForPath(filename) || 'tsx'
  let formatted: string
  try {
    formatted = transformSync(source, {
      loader: loader as 'js' | 'jsx' | 'ts' | 'tsx',
      minify: false,
      // No keepNames: it injects __name helper statements that pollute
      // the section map. Source names survive printing regardless.
      target: 'esnext',
    }).code
  } catch (e) {
    return {
      formatted: source,
      loader,
      sections: [],
      formatError: e instanceof Error ? e.message.split('\n')[0] : String(e),
    }
  }
  const { sections, note } = sectionIndex(formatted)
  return { formatted, loader, sections, ...(note ? { sectionNote: note } : {}) }
}
