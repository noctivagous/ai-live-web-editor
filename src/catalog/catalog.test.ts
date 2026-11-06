import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { catalogSummary, findComponents, getComponent, loadCatalog } from './catalog.js'
import { setAppkitEnabled } from './catalogSession.js'
import { extractCatalog, extractEntryFromSource } from './extract.js'
import { extractReactEntry } from './extractReact.js'

test('the shipped catalog merges both stocks: 63 AppKit + 10 shadcn = 73', () => {
  setAppkitEnabled(false)
  const catalog = loadCatalog()
  assert.equal(catalog.components.length, 73)
  assert.equal(catalog.components.filter(c => c.runtime === 'react').length, 10)
  const settings = getComponent('noct-app-settings', catalog)
  assert.ok(settings)
  assert.equal(settings?.category, 'app')
  // Extracted from the real sources the user supplied (2026-11-06).
  assert.equal(settings?.origin, 'extracted')
  assert.deepEqual(settings?.props.map(p => p.name), ['show', 'title'])
  // The meta/ introspection pair exports no meta of its own: seed stays.
  assert.equal(getComponent('noct-registry', catalog)?.origin, 'inventory-seed')
  // By default only the shadcn stock is enabled, and the summary says so.
  const summary = catalogSummary(catalog)
  assert.ok(summary.includes('10 ready-made components'))
  assert.ok(summary.includes('AppKit stock (63 Lit components) is off by default'))
})

test('the shadcn stock resolves by tag with its react runtime marked', () => {
  setAppkitEnabled(false)
  const catalog = loadCatalog()
  const button = getComponent('Button', catalog)
  assert.ok(button)
  assert.equal(button?.runtime, 'react')
  assert.equal(button?.origin, 'shadcn-stock')
  assert.equal(button?.category, 'ui')
  assert.equal(button?.sourceFile, 'catalog/stock/shadcn/ui/button.tsx')
})

test('shadcn extraction is truthful for the vendored set', () => {
  const catalog = loadCatalog()
  const button = getComponent('Button', catalog)
  const variant = button?.props.find(p => p.name === 'variant')
  assert.ok(variant?.type?.includes("'destructive'"))
  const size = button?.props.find(p => p.name === 'size')
  assert.ok(size?.type?.includes("'icon'"))
  assert.equal(button?.props.find(p => p.name === 'asChild')?.type, 'boolean')
  const sw = getComponent('Switch', catalog)
  assert.equal(sw?.props.find(p => p.name === 'size')?.type, '"sm" | "default"')
  const dialog = getComponent('Dialog', catalog)
  assert.ok(dialog?.exports?.includes('DialogContent'))
  assert.ok(dialog?.exports?.includes('DialogTitle'))
  assert.ok(dialog?.dependencies.includes('button'))
  assert.ok(dialog?.dependencies.includes('radix-ui'))
})

test('AppKit entries stay out of default search; includeAppkit or the session opt-in admits them', () => {
  setAppkitEnabled(false)
  const catalog = loadCatalog()
  try {
    // Default search: the AppKit stock is off, so no noct-* results.
    const byDefault = findComponents('settings', 6, catalog)
    assert.ok(!byDefault.some(c => c.tag === 'noct-app-settings'))
    assert.ok(byDefault.every(c => c.runtime === 'react'))
    assert.deepEqual(findComponents('zzzz-not-a-thing', 6, catalog), [])
    // Explicit per-call opt-in.
    const included = findComponents('settings', 6, catalog, { includeAppkit: true })
    assert.equal(included[0].tag, 'noct-app-settings')
    const splits = findComponents('split panes', 6, catalog, { includeAppkit: true })
    assert.ok(splits.some(c => c.tag === 'noct-splitter'))
    // Session opt-in (a project whose manifest sets "appkit": true).
    setAppkitEnabled(true)
    const optedIn = findComponents('settings', 6, catalog)
    assert.equal(optedIn[0].tag, 'noct-app-settings')
    assert.ok(catalogSummary(catalog).includes('73 ready-made components'))
  } finally {
    setAppkitEnabled(false)
  }
})

test('exact tag lookup resolves an AppKit entry even while the stock is off', () => {
  setAppkitEnabled(false)
  const catalog = loadCatalog()
  assert.equal(getComponent('noct-app-settings', catalog)?.tag, 'noct-app-settings')
  assert.equal(getComponent('noct-nope', catalog), undefined)
})

const FIXTURE = `
import { LitElement } from 'lit'

export const NoctWidgetMeta: NoctComponentMeta = {
  tag: 'noct-widget',
  category: 'widgets',
  description: 'A widget that does {curly} things',
  props: [
    { name: 'label', type: 'string', description: 'Visible label' },
    { name: 'count', type: 'number' },
  ],
  slots: [{ name: 'icon' }, { name: 'default' }],
  emits: ['noct-change'],
  dependencies: ['noct-stack'],
  examples: ['<noct-widget label="Hi"></noct-widget>'],
}

export class NoctWidget extends LitElement {}
`

test('extractor reads a NoctComponentMeta literal faithfully', () => {
  const entry = extractEntryFromSource(FIXTURE, 'widgets/noct-widget.ts')
  assert.ok(entry)
  assert.equal(entry?.tag, 'noct-widget')
  assert.equal(entry?.category, 'widgets')
  assert.equal(entry?.description, 'A widget that does {curly} things')
  assert.deepEqual(entry?.props.map(p => p.name), ['label', 'count'])
  assert.equal(entry?.props[0].type, 'string')
  assert.deepEqual(entry?.slots, [{ name: 'icon' }, { name: 'default' }])
  assert.deepEqual(entry?.emits, ['noct-change'])
  assert.deepEqual(entry?.dependencies, ['noct-stack'])
  assert.equal(entry?.origin, 'extracted')
})

test('extractor supports object-map props and directory category fallback', () => {
  const src = `export const NoctGridMeta = {
    tag: 'noct-grid',
    description: 'Grid layout',
    props: { columns: { type: 'number' }, gap: { type: 'string' } },
  }`
  const entry = extractEntryFromSource(src, 'layout/noct-grid.ts')
  assert.equal(entry?.category, 'layout')
  assert.deepEqual(entry?.props.map(p => p.name), ['columns', 'gap'])
  assert.equal(entry?.props[0].type, 'number')
})

test('extractor skips files without metadata instead of guessing', () => {
  assert.equal(extractEntryFromSource('export class Plain {}', 'x/plain.ts'), null)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-live-cat-'))
  fs.mkdirSync(path.join(root, 'widgets'), { recursive: true })
  fs.writeFileSync(path.join(root, 'widgets', 'noct-widget.ts'), FIXTURE)
  fs.writeFileSync(path.join(root, 'widgets', 'plain.ts'), 'export class Plain {}')
  const entries = extractCatalog(root)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].sourceFile, path.join('widgets', 'noct-widget.ts'))
})

const REACT_FIXTURE = `
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const widgetVariants = cva("base classes", {
  variants: {
    tone: {
      plain: "tone-plain",
      danger: "tone-danger",
    },
    size: {
      default: "size-default",
      icon: "size-icon",
    },
  },
  defaultVariants: {
    tone: "plain",
    size: "default",
  },
})

function Widget({
  className,
  tone = "plain",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof widgetVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"
  return <Comp className={cn(widgetVariants({ tone, size, className }))} {...props} />
}

export { Widget, widgetVariants }
`

test('react extractor reads cva variants and inline props from a shadcn-style source', () => {
  const entry = extractReactEntry(REACT_FIXTURE, 'catalog/stock/shadcn/ui/widget.tsx', 'widget')
  assert.ok(entry)
  assert.equal(entry?.tag, 'Widget')
  assert.equal(entry?.runtime, 'react')
  assert.equal(entry?.origin, 'shadcn-stock')
  assert.deepEqual(entry?.exports, ['Widget'])
  const tone = entry?.props.find(p => p.name === 'tone')
  assert.equal(tone?.type, "'plain' | 'danger'")
  assert.equal(tone?.description, "Default 'plain'.")
  const size = entry?.props.find(p => p.name === 'size')
  assert.ok(size?.type?.includes("'icon'"))
  assert.equal(entry?.props.find(p => p.name === 'asChild')?.type, 'boolean')
  assert.equal(entry?.props.find(p => p.name === 'className')?.type, 'string')
  assert.deepEqual(entry?.dependencies, ['class-variance-authority', 'cn', 'radix-ui'])
  assert.ok(entry?.description.includes('native <button>'))
})
