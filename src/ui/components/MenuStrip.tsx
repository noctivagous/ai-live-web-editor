import React, { useEffect, useRef, useState } from 'react'
import {
  actionAvailability, actionById, type ActionContext, type AgentAction,
} from '../lib/agentActions'
import { runAction } from '../lib/actionDispatch'
import { wizardById, wizardRowState, type WizardDef } from '../lib/wizards'
import { FACET_IDS, FACET_TITLES, formatRoute, type AppLayout, type FacetId } from '../lib/layoutRoute'
import { SETTING_SECTIONS } from '../lib/settingsSchema'
import { UI_THEMES, type UiThemeId } from '../lib/themes'
import { facetEnabled } from '../lib/facetPrefs'
import { loadUiPrefs, type HeaderBarPref, type MenuLayoutPref } from '../lib/uiPrefs'
import { AgentActionsMenu } from './AgentActionsMenu'
import { WizardsMenu } from './WizardsMenu'
import {
  AgentActionsIcon, CaretIcon, HelpIcon, InsertIcon, ProjectIcon,
  SettingsIcon, VerifyIcon, ViewIcon, WizardsIcon,
} from './menuIcons'

/**
 * The classic menu strip (Settings → Header Bar): Project ·
 * Agent Actions · Insert · Verify · Wizards · View · Settings ·
 * Help, under (or instead of) the top button bar.
 *
 * It is one more surface over the same sources as everything else —
 * the Agent Actions and Wizards pops ARE the top-bar menus (same
 * components, same registry), Insert/Verify rows dispatch registry
 * actions through runAction, View reads the layout route, and
 * Settings lists the settings schema's sections. The Header Bar
 * setting (Settings → Header Bar) picks buttons, classic, or both;
 * in classic-only mode the AI selects render in `trailing`.
 */
export interface MenuStripProps {
  ctx: ActionContext
  route: AppLayout
  leftView: 'files' | 'library' | 'actions'
  uiTheme: UiThemeId
  menuLayout: MenuLayoutPref
  headerBar: HeaderBarPref
  /** Right-end slot: in classic-only mode the App renders the AI
   * connection/model selects here, so they live in the classic bar. */
  trailing?: React.ReactNode
  onNewProject: () => void
  onImport: () => void
  onOpenSync: () => void
  onSave: () => void
  hasManifest: boolean
  onOpenManifest: () => void
  onOpenLibrary: () => void
  onOpenSettings: (section: string) => void
  onOpenWizard: (id: string) => void
  onNavigate: (route: AppLayout) => void
  onLeftView: (v: 'files' | 'library' | 'actions') => void
  onOpenCmdk: () => void
  onSetTheme: (id: UiThemeId) => void
  onSetHeaderBar: (h: HeaderBarPref) => void
  onAbout: () => void
}

const LABELS = ['Project', 'Agent Actions', 'Insert', 'Verify', 'Wizards', 'View', 'Settings', 'Help'] as const
type MenuLabel = (typeof LABELS)[number]

const MENU_ICONS = {
  Project: ProjectIcon,
  'Agent Actions': AgentActionsIcon,
  Insert: InsertIcon,
  Verify: VerifyIcon,
  Wizards: WizardsIcon,
  View: ViewIcon,
  Settings: SettingsIcon,
  Help: HelpIcon,
} as const

export function MenuStrip(props: MenuStripProps) {
  const [open, setOpen] = useState<MenuLabel | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const close = () => setOpen(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open ])

  function runAndClose(fn: () => void) {
    close()
    fn()
  }

  function actionRow(a: AgentAction) {
    const v = actionAvailability(a, props.ctx)
    return (
      <button
        key={a.id}
        type="button"
        role="menuitem"
        className="ms-row"
        disabled={!v.available}
        title={v.available ? a.title : `${a.title} — ${v.reason ?? ''}`}
        onClick={() => runAndClose(() => runAction(a, props.ctx, { openLibrary: props.onOpenLibrary, openSettings: props.onOpenSettings }))}
      >
        <span className="ms-row-main">
          <span className="ms-row-title">{a.title.replace(/…$/, '')}</span>
          <span className="ms-row-sub">{v.available ? a.blurb : (v.reason ?? a.blurb)}</span>
        </span>
        {a.writes && <span className="ms-tag">writes files</span>}
      </button>
    )
  }

  function actionRowById(id: string) {
    const a = actionById(id)
    return a ? actionRow(a) : null
  }

  function wizardRow(w: WizardDef) {
    const s = wizardRowState(w)
    return (
      <button
        key={w.id}
        type="button"
        role="menuitem"
        className="ms-row"
        disabled={s.disabled}
        title={s.title}
        onClick={() => runAndClose(() => props.onOpenWizard(w.id))}
      >
        <span className="ms-row-main">
          <span className="ms-row-title">{w.title}</span>
          <span className="ms-row-sub">{s.sub}</span>
        </span>
        <span className="ms-tag">wizard</span>
      </button>
    )
  }

  function wizardRowById(id: string) {
    const w = wizardById(id)
    return w ? wizardRow(w) : null
  }

  function itemRow(o: {
    key?: string,
    title: string, sub?: string, tag?: string, checked?: boolean,
    disabled?: boolean, reason?: string, run: () => void,
  }) {
    return (
      <button
        key={o.key}
        type="button"
        role="menuitem"
        className={`ms-row${o.checked ? ' on' : ''}`}
        disabled={o.disabled}
        title={o.disabled && o.reason ? `${o.title} — ${o.reason}` : o.title}
        onClick={() => runAndClose(o.run)}
      >
        <span className="ms-check" aria-hidden="true">{o.checked ? '✓' : ''}</span>
        <span className="ms-row-main">
          <span className="ms-row-title">{o.title}</span>
          {(o.sub || (o.disabled && o.reason)) && (
            <span className="ms-row-sub">{o.disabled && o.reason ? o.reason : o.sub}</span>
          )}
        </span>
        {o.tag && <span className="ms-tag">{o.tag}</span>}
      </button>
    )
  }

  function pop(label: MenuLabel) {
    const grid = props.menuLayout !== 'list'
    const cls = grid ? 'ms-pop grid' : 'ms-pop'
    switch (label) {
      case 'Project':
        return (
          <div className={cls} role="menu" aria-label="Project">
            <div className="aa-group">Project</div>
            {itemRow({ title: 'New project', sub: 'Create a new app under projects/', run: props.onNewProject })}
            {itemRow({ title: 'Open…', sub: 'Pick a folder and keep it in live two-way sync', run: props.onOpenSync })}
            {itemRow({ title: 'Import…', sub: 'Import a copy of a folder as a new project', run: props.onImport })}
            <div className="ms-sep" />
            {wizardRowById('new-project')}
            {itemRow({
              title: 'Edit project.ai.json…', sub: 'The project manifest — type, format, targets, style set',
              disabled: !props.hasManifest,
              reason: props.ctx.hasProject ? 'This project has no project.ai.json' : 'Open a project first',
              run: props.onOpenManifest,
            })}
            <div className="ms-sep" />
            {itemRow({ title: 'Save', sub: 'The editor autosaves as you type, too', run: props.onSave })}
          </div>
        )
      case 'Agent Actions':
        return (
          <AgentActionsMenu
            ctx={props.ctx}
            onOpenLibrary={props.onOpenLibrary}
            onOpenSettings={props.onOpenSettings}
            onClose={close}
          />
        )
      case 'Insert':
        return (
          <div className={cls} role="menu" aria-label="Insert">
            <div className="aa-group">The catalog ladder — component → template → pack</div>
            {actionRowById('add-component')}
            {actionRowById('install-pack')}
            <div className="ms-sep" />
            {wizardRowById('add-feature')}
            {itemRow({ title: 'Open the Library', sub: 'All three tiers of the catalog', run: () => { props.onNavigate({ kind: 'workbench' }); props.onOpenLibrary() } })}
          </div>
        )
      case 'Verify':
        return (
          <div className={cls} role="menu" aria-label="Verify">
            <div className="aa-group">Verify</div>
            {actionRowById('run-checks')}
            {actionRowById('check-file')}
            {actionRowById('check-graph')}
            <div className="ms-sep" />
            {actionRowById('console-errors')}
            {actionRowById('network-failures')}
            {actionRowById('layout-snapshot')}
          </div>
        )
      case 'Wizards':
        return <WizardsMenu onOpenWizard={props.onOpenWizard} onClose={close} />
      case 'View':
        return (
          <div className={cls} role="menu" aria-label="View">
            <div className="aa-group">Layout — two peers, each with a route</div>
            {itemRow({
              title: 'Workbench', sub: 'Files · editor/preview · full chat pane', tag: '/workbench',
              checked: props.route.kind === 'workbench',
              run: () => props.onNavigate({ kind: 'workbench' }),
            })}
            {itemRow({
              title: 'Facets', sub: 'Facet state · actions · wizards', tag: '/facets/…',
              checked: props.route.kind === 'facets',
              run: () => props.onNavigate({ kind: 'facets', facet: props.route.kind === 'facets' ? props.route.facet : 'features' }),
            })}
            <div className="ms-sep" />
            <div className="aa-group">Facets — routes</div>
            {FACET_IDS.filter((f: FacetId) => facetEnabled(loadUiPrefs(), f)).map((f: FacetId) => itemRow({
              key: f,
              title: FACET_TITLES[f], tag: `/facets/${f}`,
              checked: props.route.kind === 'facets' && props.route.facet === f,
              run: () => props.onNavigate({ kind: 'facets', facet: f }),
            }))}
            <div className="ms-sep" />
            <div className="aa-group">Left pane — Workbench</div>
            {([
              ['files', 'Files'], ['library', 'Library'], ['actions', 'Actions'],
            ] as const).map(([v, t]) => itemRow({
              key: v,
              title: t, checked: props.leftView === v,
              run: () => { props.onNavigate({ kind: 'workbench' }); props.onLeftView(v) },
            }))}
            <div className="ms-sep" />
            <div className="aa-group">Header bar — also in Settings → Header Bar</div>
            {itemRow({
              title: 'Buttons', sub: 'The top button bar only', checked: props.headerBar === 'buttons',
              run: () => props.onSetHeaderBar('buttons'),
            })}
            {itemRow({
              title: 'Classic', sub: 'This menu strip only — AI selects move here', checked: props.headerBar === 'classic',
              run: () => props.onSetHeaderBar('classic'),
            })}
            {itemRow({
              title: 'Both', sub: 'This strip under the button bar', checked: props.headerBar === 'both',
              run: () => props.onSetHeaderBar('both'),
            })}
          </div>
        )
      case 'Settings':
        return (
          <div className={cls} role="menu" aria-label="Settings">
            <div className="aa-group">Settings — a top-level item, sections in a rail</div>
            {SETTING_SECTIONS.map(s => itemRow({
              key: s.id,
              title: s.title, tag: 'section',
              run: () => props.onOpenSettings(s.id),
            }))}
            <div className="ms-sep" />
            <div className="aa-group">Theme</div>
            {UI_THEMES.map(t => itemRow({
              key: t.id,
              title: t.label, checked: props.uiTheme === t.id,
              run: () => props.onSetTheme(t.id),
            }))}
          </div>
        )
      case 'Help':
        return (
          <div className={cls} role="menu" aria-label="Help">
            {itemRow({ title: 'Search all actions…', sub: 'Every Agent Action, by name', tag: '⌘K', run: props.onOpenCmdk })}
            {itemRow({ title: 'Keyboard shortcuts', sub: 'The shortcut registry, in Settings', run: () => props.onOpenSettings('shortcuts') })}
            <div className="ms-sep" />
            {itemRow({ title: 'About AI Live Editor', run: props.onAbout })}
          </div>
        )
    }
  }

  return (
    <div className="menu-strip" ref={rootRef} role="menubar" aria-label="Application menu bar" onPointerDown={e => e.stopPropagation()}>
      {LABELS.map(label => {
        const Icon = MENU_ICONS[label]
        return (
          <div className="ms-anchor" key={label}>
            <button
              type="button"
              className={`ms-btn${open === label ? ' open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={open === label}
              onClick={() => setOpen(open === label ? null : label)}
              onMouseEnter={() => { if (open && open !== label) setOpen(label) }}
            >
              <Icon size={13} aria-hidden />
              {label === 'Agent Actions' || label === 'Wizards' ? <strong>{label}</strong> : label}
              <CaretIcon size={11} aria-hidden className="ms-caret" />
            </button>
            {open === label && pop(label)}
          </div>
        )
      })}
      <span className="ms-route mono" title="The current layout's route — layouts are deep-linkable">
        {formatRoute(props.route).replace(/^#/, '')}
      </span>
      {props.trailing}
    </div>
  )
}
