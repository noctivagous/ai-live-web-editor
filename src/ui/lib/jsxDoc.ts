/**
 * The .jsx document model: a friendly nested read of one component
 * file — its imports, its components (props with defaults, hooks,
 * state), and its plain helpers — plus in-place text edits (rename a
 * component, change a prop default) that splice the source, the same
 * core the agent's data tools pattern follows for the tree formats.
 *
 * Parsing runs through the TypeScript compiler (already a repo
 * dependency), loaded with a dynamic import so the compiler stays
 * out of the main UI bundle and only loads when a .jsx file opens.
 */
import type * as ts from 'typescript'

export interface JsxImport {
  source: string
  names: string[]
  range: { start: number, end: number }
}

export interface JsxProp {
  name: string
  /** Source text of the default value, when the prop destructures one. */
  defaultSrc?: string
  optional: boolean
  /** Offset range of the initializer (when defaultSrc is set). */
  defaultRange?: { start: number, end: number }
  /** Offset just past the prop name — where ` = <default>` is inserted. */
  nameEnd: number
}

export interface JsxHookUse {
  name: string
  /** Local names the hook call binds (the useState pair, the ref …). */
  bound: string[]
}

export interface JsxComponent {
  name: string
  exported: boolean
  props: JsxProp[]
  hooks: JsxHookUse[]
  /** Outline of the returned element tree: tag names, depth-first. */
  outline: string[]
  range: { start: number, end: number }
}

export interface JsxDoc {
  imports: JsxImport[]
  components: JsxComponent[]
  helpers: { name: string, exported: boolean }[]
}

/** The js-based family the base viewer covers. `tsx` parses types
 * too; `js` parses the same shape (imports/exports/functions) with
 * no JSX outline — a future WebComponent view inherits the same
 * shell with its own doc provider. */
export type JsDocKind = 'jsx' | 'tsx' | 'js'

const SCRIPT_KIND = { jsx: 'JSX', tsx: 'TSX', js: 'JS' } as const

async function loadTs(): Promise<typeof import('typescript')> {
  return import('typescript')
}

function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name)
}

/** Parse one js-based file into its nested document model. */
export async function parseJsxDocument(text: string, kind: JsDocKind = 'jsx'): Promise<JsxDoc> {
  const ts = await loadTs()
  const sf = ts.createSourceFile(`file.${kind}`, text, ts.ScriptTarget.Latest, true, ts.ScriptKind[SCRIPT_KIND[kind]])
  const doc: JsxDoc = { imports: [], components: [], helpers: [] }

  const exportedNames = new Set<string>()
  const collectExports = (node: ts.Node) => {
    if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
        exportedNames.add(node.name.text)
      }
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) exportedNames.add(decl.name.text)
        }
      }
    }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const el of node.exportClause.elements) exportedNames.add(el.name.text)
    }
    ts.forEachChild(node, collectExports)
  }
  collectExports(sf)

  const outlineOf = (node: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment, out: string[], depth: number) => {
    if (out.length >= 40 || depth > 4) return
    if (ts.isJsxFragment(node)) {
      out.push('<>')
    } else if (ts.isJsxSelfClosingElement(node)) {
      out.push(`<${node.tagName.getText(sf)} />`)
    } else {
      out.push(`<${node.openingElement.tagName.getText(sf)}>`)
    }
    const children = ts.isJsxElement(node) ? node.children : []
    for (const child of children) {
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
        outlineOf(child, out, depth + 1)
      }
    }
  }

  const findReturnJsx = (body: ts.Node): (ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment) | null => {
    let found: (ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment) | null = null
    const visit = (node: ts.Node) => {
      if (found) return
      if (ts.isReturnStatement(node) && node.expression &&
        (ts.isJsxElement(node.expression) || ts.isJsxSelfClosingElement(node.expression) || ts.isJsxFragment(node.expression))) {
        found = node.expression
        return
      }
      // A bare JSX expression body (arrow shorthand) counts too.
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
        found = node as ts.JsxElement
        return
      }
      ts.forEachChild(node, visit)
    }
    visit(body)
    return found
  }

  const hooksIn = (body: ts.Node): JsxHookUse[] => {
    const hooks: JsxHookUse[] = []
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const name = node.expression.getText(sf)
        if (/^use[A-Z]/.test(name)) {
          const bound: string[] = []
          const parent = node.parent
          if (parent && ts.isVariableDeclaration(parent) && ts.isArrayBindingPattern(parent.name)) {
            for (const el of parent.name.elements) {
              if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) bound.push(el.name.text)
            }
          } else if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
            bound.push(parent.name.text)
          }
          hooks.push({ name, bound })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(body)
    return hooks
  }

  const propsOf = (params: ts.NodeArray<ts.ParameterDeclaration>): JsxProp[] => {
    const first = params[0]
    if (!first || !ts.isObjectBindingPattern(first.name)) return []
    const props: JsxProp[] = []
    for (const el of first.name.elements) {
      if (!ts.isBindingElement(el)) continue // rest element has no local to edit
      const name = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text
        : ts.isIdentifier(el.name) ? el.name.text : null
      if (!name) continue
      const prop: JsxProp = {
        name,
        optional: Boolean(el.dotDotDotToken) ? false : true,
        nameEnd: el.name.getEnd(),
      }
      if (el.initializer) {
        prop.defaultSrc = el.initializer.getText(sf)
        prop.defaultRange = { start: el.initializer.getStart(sf), end: el.initializer.getEnd() }
      }
      props.push(prop)
    }
    return props
  }

  const componentFromFunction = (name: string, node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction, exported: boolean) => {
    const body = node.body
    if (!body) return
    const returned = findReturnJsx(body)
    if (!returned) return
    const outline: string[] = []
    outlineOf(returned, outline, 0)
    doc.components.push({
      name,
      exported,
      props: propsOf(node.parameters),
      hooks: hooksIn(body),
      outline,
      range: { start: node.getStart(sf), end: node.getEnd() },
    })
  }

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const source = stmt.moduleSpecifier.getText(sf).replace(/^['"]|['"]$/g, '')
      const names: string[] = []
      const clause = stmt.importClause
      if (clause?.name) names.push(clause.name.text)
      if (clause?.namedBindings) {
        if (ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) names.push(el.name.text)
        } else if (ts.isNamespaceImport(clause.namedBindings)) {
          names.push(`* as ${clause.namedBindings.name.text}`)
        }
      }
      doc.imports.push({ source, names, range: { start: stmt.getStart(sf), end: stmt.getEnd() } })
      continue
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      if (isComponentName(stmt.name.text)) {
        componentFromFunction(stmt.name.text, stmt, exportedNames.has(stmt.name.text))
      } else {
        doc.helpers.push({ name: stmt.name.text, exported: exportedNames.has(stmt.name.text) })
      }
      continue
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
        const name = decl.name.text
        const exported = exportedNames.has(name)
        const init = decl.initializer
        if (isComponentName(name) && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          componentFromFunction(name, init, exported)
        } else {
          doc.helpers.push({ name, exported })
        }
      }
      continue
    }
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      doc.helpers.push({ name: 'default', exported: true })
    }
  }
  return doc
}

/** Rename a component everywhere it is defined or used in the file
 * (its declaration, export specifiers, and JSX open/close tags).
 * Kind-independent — it matches identifiers, never syntax. */
export async function renameComponentInText(text: string, oldName: string, newName: string): Promise<string> {
  const ts = await loadTs()
  const sf = ts.createSourceFile('file.jsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX)
  const hits: { start: number, end: number }[] = []
  const isRef = (node: ts.Node): node is ts.Identifier => ts.isIdentifier(node) && node.text === oldName &&
    !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
  const visit = (node: ts.Node) => {
    if (isRef(node)) hits.push({ start: node.getStart(sf), end: node.getEnd() })
    ts.forEachChild(node, visit)
  }
  visit(sf)
  hits.sort((a, b) => b.start - a.start)
  let out = text
  for (const h of hits) out = out.slice(0, h.start) + newName + out.slice(h.end)
  return out
}

/** Rewrite (or insert) one prop's default value in a component's
 * destructured parameter list. `defaultSrc` is source text. */
export async function setPropDefaultInText(
  text: string, componentName: string, propName: string, defaultSrc: string, kind: JsDocKind = 'jsx',
): Promise<string> {
  const doc = await parseJsxDocument(text, kind)
  const comp = doc.components.find(c => c.name === componentName)
  if (!comp) throw new Error(`No component ${componentName} in this file`)
  const prop = comp.props.find(p => p.name === propName)
  if (!prop) throw new Error(`No prop ${propName} on ${componentName}`)
  if (prop.defaultRange) {
    return text.slice(0, prop.defaultRange.start) + defaultSrc + text.slice(prop.defaultRange.end)
  }
  return text.slice(0, prop.nameEnd) + ` = ${defaultSrc}` + text.slice(prop.nameEnd)
}
