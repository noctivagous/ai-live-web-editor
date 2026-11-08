import React, { useEffect, useState } from 'react'
import {
  getCatalog, getFeatures, getProjectConfig,
  type FeatureGraphItem, type FeatureRollup, type PackSummaryItem, type ProjectConfig,
} from '../lib/api'
import {
  actionAvailability, actionsForFacet, AGENT_ACTIONS,
  type ActionContext, type AgentAction,
} from '../lib/agentActions'
import { runAction } from '../lib/actionDispatch'
import { recordRecent } from '../lib/actionHistory'
import { STUB_REASON, wizardsForFacet, type WizardDef } from '../lib/wizards'
import { FACET_BLURBS, FACET_IDS, FACET_TITLES, type FacetId } from '../lib/layoutRoute'

/**
 * The Facets layout (slice 5): one screen per facet, each showing
 * the same four things the prototype settled — the facet's current
 * state on real data, its actions, its wizards, and a suggested
 * next step. The Workbench stays the default layout; this is the
 * alternative, reached by the layout switcher or a #/facets/… link.
 * Chat stays mounted beside it (App hoists the chat column), so
 * actions dispatched from here report in the same conversation.
 */

interface FacetData {
  graph: FeatureGraphItem | null
  rollup: { overall: FeatureRollup, regions: { node: { id: string, name: string }, rollup: FeatureRollup }[] } | null
  packs: PackSummaryItem[]
  config: ProjectConfig | null
}

export function FacetView({ facet, projectName, filesCount, startPage, themeLabel, ctx, onNavigateFacet, onOpenWizard, onOpenSettings, onOpenLibrary }: {
  facet: FacetId
  projectName: string
  filesCount: number
  startPage: string | null
  themeLabel: string
  ctx: ActionContext
  onNavigateFacet: (f: FacetId) => void
  onOpenWizard: (id: string) => void
  onOpenSettings: (section: string) => void
  onOpenLibrary: () => void
}) {
  const [data, setData] = useState<FacetData | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const [feats, cat, cfg] = await Promise.all([
        getFeatures().catch(() => null),
        getCatalog().catch(() => null),
        getProjectConfig().catch(() => null),
      ])
      if (!live) return
      setData({
        graph: feats?.graph ?? null,
        rollup: feats?.rollup ?? null,
        packs: cat?.packs ?? [],
        config: cfg?.config ?? null,
      })
    })()
    return () => { live = false }
  }, [])

  function run(a: AgentAction) {
    recordRecent(a.id)
    runAction(a, ctx, { openLibrary: onOpenLibrary, openSettings: onOpenSettings })
  }

  function actionCard(a: AgentAction) {
    const v = actionAvailability(a, ctx)
    return (
      <button
        key={a.id}
        type="button"
        className="aa-card"
        disabled={!v.available}
        title={v.available ? a.title : `${a.title} — ${v.reason ?? ''}`}
        onClick={() => run(a)}
      >
        <b>{a.title}</b>
        <span>{a.blurb}</span>
        {a.writes && <span className="aa-tag">writes files</span>}
        {!v.available && v.reason && <span className="aa-reason">{v.reason}</span>}
      </button>
    )
  }

  function wizardCard(w: WizardDef) {
    const stub = w.status === 'stub'
    return (
      <button
        key={w.id}
        type="button"
        className="aa-card"
        disabled={stub}
        title={stub ? `${w.title} — ${STUB_REASON}` : w.title}
        onClick={() => onOpenWizard(w.id)}
      >
        <b>{w.title}</b>
        <span>{w.blurb}</span>
        {stub && <span className="aa-reason">{STUB_REASON}</span>}
      </button>
    )
  }

  const row = (label: string, value: React.ReactNode) => (
    <div className="fs-row" key={label}><span>{label}</span><b>{value}</b></div>
  )

  const installedPacks = new Set<string>()
  for (const n of data?.graph?.nodes ?? []) if (n.pack) installedPacks.add(n.pack)

  function stateBlock() {
    if (!data) return <div className="ap-empty">Loading…</div>
    if (facet === 'features') {
      const r = data.rollup?.overall
      return (
        <>
          {data.graph && r ? (
            <>
              {row('Feature graph', `${r.pct}% built — ${r.built} of ${r.total} nodes done${r.blocked ? `, ${r.blocked} blocked` : ''}`)}
              {data.rollup!.regions.map(({ node, rollup }) => row(node.name, `${rollup.pct}% · ${rollup.built}/${rollup.total}`))}
            </>
          ) : row('Feature graph', 'None yet — install a feature pack and the graph starts')}
          {row('Packs installed', installedPacks.size > 0 ? [...installedPacks].join(', ') : 'None')}
          <div style={{ display: 'flex', gap: 7, marginTop: 10, flexWrap: 'wrap' }}>
            <button type="button" className="wiz-btn primary" onClick={() => onOpenWizard('add-feature')}>Add a Feature…</button>
            <button type="button" className="wiz-btn" onClick={() => window.dispatchEvent(new CustomEvent('ai-live:graph-open', {}))}>Open the feature graph</button>
          </div>
          {data.packs.filter(p => !installedPacks.has(p.id)).length > 0 && (
            <>
              <div className="aa-group">Available to add</div>
              {data.packs.filter(p => !installedPacks.has(p.id)).map(p => (
                <div className="fs-pack" key={p.id}>
                  <span><b>{p.name}</b> — {p.nodes} nodes · {p.settings} settings</span>
                  <button type="button" className="wiz-btn" onClick={() => onOpenWizard('add-feature')}>Add…</button>
                </div>
              ))}
            </>
          )}
        </>
      )
    }
    if (facet === 'architecture') {
      const c = data.config
      return (
        <>
          {row('Project type', c?.type ?? 'Not designated yet')}
          {row('Format', c?.format ?? 'App (viewport-fit)')}
          {row('Device targets', c?.deviceTargets?.length ? c.deviceTargets.join(', ') : 'Not set')}
          {row('Start page', c?.entry ?? startPage ?? 'Not set')}
          {row('Style set', c?.styleSet ?? 'Default')}
          <div style={{ marginTop: 10 }}>
            <button type="button" className="wiz-btn" onClick={() => onOpenSettings('project')}>Project settings…</button>
          </div>
        </>
      )
    }
    if (facet === 'styles') {
      return (
        <>
          {row('UI theme', themeLabel)}
          {row('Project style set', data.config?.styleSet ?? 'Default')}
          <div style={{ marginTop: 10, display: 'flex', gap: 7 }}>
            <button type="button" className="wiz-btn" onClick={() => onOpenSettings('themes')}>Themes…</button>
            <button type="button" className="wiz-btn" onClick={() => onOpenSettings('appearance')}>Appearance…</button>
          </div>
        </>
      )
    }
    // overview
    const r = data.rollup?.overall
    return (
      <>
        {row('Project', projectName)}
        {row('Files', `${filesCount}`)}
        {row('Project type', data.config?.type ?? 'Not designated yet')}
        {row('Start page', data.config?.entry ?? startPage ?? 'Not set')}
        {row('Feature graph', r ? `${r.pct}% built (${r.built}/${r.total})` : 'None yet')}
        <div className="aa-group">Facets</div>
        {FACET_IDS.filter(f => f !== 'overview').map(f => (
          <div className="fs-pack" key={f}>
            <span><b>{FACET_TITLES[f]}</b> — {FACET_BLURBS[f]}</span>
            <button type="button" className="wiz-btn" onClick={() => onNavigateFacet(f)}>Open</button>
          </div>
        ))}
      </>
    )
  }

  function nextStep(): string {
    if (!data) return ''
    if (facet === 'features') {
      if (!data.graph) return 'Suggested next step: add your first feature — the Settings pack is a good start.'
      const blocked = data.rollup?.overall.blocked ?? 0
      if (blocked > 0) return `Suggested next step: ${blocked} node${blocked === 1 ? ' is' : 's are'} blocked — open the feature graph to see what each one waits on.`
      return 'Suggested next step: plan the next region from the feature graph, or add another pack.'
    }
    if (facet === 'architecture' && !data.config?.type) return 'Suggested next step: designate the project type in Project settings — the catalog and defaults key off it.'
    if (facet === 'styles') return 'Suggested next step: check the layout of the marked page, then make it responsive.'
    if (facet === 'overview') return 'Suggested next step: open the facet that needs work — Features is where most building happens.'
    return ''
  }

  const facetActions = facet === 'overview'
    ? AGENT_ACTIONS.filter(a => a.facet === 'any')
    : actionsForFacet(facet)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div className="facet-bar pane-bar" role="tablist" aria-label="Facets">
        {FACET_IDS.map(f => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={facet === f}
            className={`facet-tab${facet === f ? ' on' : ''}`}
            onClick={() => onNavigateFacet(f)}
          >
            {FACET_TITLES[f]}
          </button>
        ))}
        <span className="facet-route mono">#/facets/{facet}</span>
      </div>
      <div className="facet-body">
        <div className="facet-head">
          <b>{FACET_TITLES[facet]}</b>
          <span>{FACET_BLURBS[facet]}</span>
        </div>

        <div className="aa-group">Current state</div>
        <div className="facet-state">{stateBlock()}</div>
        {nextStep() && <div className="facet-next">{nextStep()}</div>}

        <div className="aa-group">{FACET_TITLES[facet]} actions</div>
        <div className="facet-grid">{facetActions.map(actionCard)}</div>

        {facet !== 'overview' && (
          <>
            <div className="aa-group">{FACET_TITLES[facet]} wizards</div>
            <div className="facet-grid">{wizardsForFacet(facet).map(wizardCard)}</div>
          </>
        )}
      </div>
    </div>
  )
}
