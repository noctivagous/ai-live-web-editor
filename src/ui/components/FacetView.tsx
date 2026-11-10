import React, { useEffect, useState } from 'react'
import {
  addCrossLink as apiAddCrossLink, applyDesignPack, askAi, deriveDesignGraph, followArchPack, getArchPacks, getArchitecture, getCatalog, getConfigInventory, getCrossLinks, getDesignGraph, getDesignGuide, getDesignPacks, getFacetCriteria, getFeatures, getProjectConfig, getTechStack, mapDesignImport, planArchPack, previewArchPack, previewDesignPack, removeCrossLink as apiRemoveCrossLink, saveDesignGuide, setDesignTokenValue,
  type ArchitectureDeclarationItem, type ArchitectureReportItem, type ArchPackItem, type ConfigInventoryItem, type CrossLinkItem, type DesignImportMappingItem, type DesignPackItem, type FacetCriteriaRunItem, type TechStackItem,
  type DesignGraphItem, type DesignGuideItem, type DesignReportItem, type FeatureGraphItem, type FeatureRollup, type PackSummaryItem, type ProjectConfig,
} from '../lib/api'
import {
  actionAvailability, actionsForFacet, AGENT_ACTIONS,
  type ActionContext, type AgentAction,
} from '../lib/agentActions'
import { runAction } from '../lib/actionDispatch'
import { recordRecent } from '../lib/actionHistory'
import { STUB_REASON, wizardsForFacet, type WizardDef } from '../lib/wizards'
import { FACET_BLURBS, FACET_IDS, FACET_TITLES, type FacetId } from '../lib/layoutRoute'
import { sectionsForFacet, type ProjectFacetId } from '../lib/facets'
import { facetEnabled, facetTogglePatch, sectionEnabled } from '../lib/facetPrefs'
import { loadUiPrefs, saveUiPrefs } from '../lib/uiPrefs'

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
  guide: DesignGuideItem | null
  designGraph: DesignGraphItem | null
  designReport: DesignReportItem | null
  arch: ArchitectureDeclarationItem | null
  archGuide: string
  archReport: ArchitectureReportItem | null
  stack: TechStackItem | null
  inventory: ConfigInventoryItem | null
  links: CrossLinkItem[]
}

export function FacetView({ facet, projectName, filesCount, startPage, ctx, onNavigateFacet, onOpenWizard, onOpenSettings, onOpenLibrary }: {
  facet: FacetId
  projectName: string
  filesCount: number
  startPage: string | null
  ctx: ActionContext
  onNavigateFacet: (f: FacetId) => void
  onOpenWizard: (id: string) => void
  onOpenSettings: (section: string) => void
  onOpenLibrary: () => void
}) {
  const [data, setData] = useState<FacetData | null>(null)
  // Facet on/off state (design §10): a device-scope pref. App
  // re-renders this view when the prefs change (it listens for
  // UI_PREFS_CHANGED_EVENT), so reading the prefs in the render
  // body is always current.
  const prefs = loadUiPrefs()
  const secOn = (id: string) => sectionEnabled(prefs, facet, id)

  useEffect(() => {
    let live = true
    void (async () => {
      const [feats, cat, cfg, gd, dg, ar, ts, ci, xl] = await Promise.all([
        getFeatures().catch(() => null),
        getCatalog().catch(() => null),
        getProjectConfig().catch(() => null),
        getDesignGuide().catch(() => null),
        getDesignGraph().catch(() => null),
        getArchitecture().catch(() => null),
        getTechStack().catch(() => null),
        getConfigInventory().catch(() => null),
        getCrossLinks().catch(() => null),
      ])
      if (!live) return
      setData({
        graph: feats?.graph ?? null,
        rollup: feats?.rollup ?? null,
        packs: cat?.packs ?? [],
        config: cfg?.config ?? null,
        guide: gd?.guide ?? null,
        designGraph: dg?.graph ?? null,
        designReport: dg?.report ?? null,
        arch: ar?.declaration ?? null,
        archGuide: ar?.guide ?? '',
        archReport: ar?.report ?? null,
        stack: ts?.stack ?? null,
        inventory: ci?.inventory ?? null,
        links: xl?.links ?? [],
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
          {secOn('graph') && (
            <>
              {data.graph && r ? (
                <>
                  {row('Feature graph', `${r.pct}% built — ${r.built} of ${r.total} nodes done${r.blocked ? `, ${r.blocked} blocked` : ''}`)}
                  {data.rollup!.regions.map(({ node, rollup }) => row(node.name, `${rollup.pct}% · ${rollup.built}/${rollup.total}`))}
                </>
              ) : row('Feature graph', 'None yet — install a feature pack and the graph starts')}
              <div style={{ display: 'flex', gap: 7, marginTop: 10, flexWrap: 'wrap' }}>
                <button type="button" className="wiz-btn" onClick={() => window.dispatchEvent(new CustomEvent('ai-live:graph-open', {}))}>Open the feature graph</button>
              </div>
            </>
          )}
          {secOn('packs') && (
            <>
              <div className="aa-group">Feature packs</div>
              {row('Packs installed', installedPacks.size > 0 ? [...installedPacks].join(', ') : 'None')}
              <div style={{ display: 'flex', gap: 7, marginTop: 10, flexWrap: 'wrap' }}>
                <button type="button" className="wiz-btn primary" onClick={() => onOpenWizard('add-feature')}>Add a Feature…</button>
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
          )}
          <CrossLinksSection
            links={data.links}
            onChanged={links => setData(d => (d ? { ...d, links } : d))}
          />
        </>
      )
    }
    if (facet === 'architecture') {
      // Re-scoped (§4.1): project type and the declaration stay;
      // format and device targets are setup, so their rows live
      // in Configuration now; the style set is Graphic Design's.
      const c = data.config
      const decl = data.arch
      const rep = data.archReport
      return (
        <>
          {secOn('state') && (
            <>
              <div className="aa-group">Current state</div>
              {row('Project type', c?.type ?? 'Not designated yet')}
              {row('Architecture', decl ? (decl.name ?? 'Declared') : 'Not designated — the plan packs below are a starting point')}
              {decl?.provenance ? row('From', `the ${decl.provenance} architecture plan pack`) : null}
              {row('Format & device targets', 'Set up in the Configuration facet')}
              <div style={{ marginTop: 10 }}>
                <button type="button" className="wiz-btn" onClick={() => onOpenSettings('project')}>Project settings…</button>
              </div>
            </>
          )}
          {secOn('plan') && decl && (
            <>
              <div className="aa-group">Architecture plan</div>
              {decl.layers.length ? row('Layers', decl.layers.join(' → ')) : null}
              {decl.modules.map(m => row(`Module — ${m.name}`, `${m.path}${m.responsibility ? ` — ${m.responsibility}` : ''}`))}
              {decl.allowedDependencies.map(d => row('May depend', `${d.from} → ${d.to}`))}
              {!decl.modules.length && row('Modules', 'None declared yet')}
            </>
          )}
          {secOn('guide') && (
            <>
              <div className="aa-group">Philosophy & guide</div>
              {data.archGuide.trim()
                ? <div className="field-hint" style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto' }}>{data.archGuide.slice(0, 4000)}</div>
                : row('Guide', 'No philosophy or briefed rules written yet — a plan pack writes its own, or ask the agent to draft one')}
            </>
          )}
          {secOn('report') && rep && (
            <>
              <div className="aa-group">Report</div>
              {rep.rules.length
                ? rep.rules.map(r => row(`${r.verdict} — ${r.id}`, `${r.say} · ${r.evidence}`))
                : row('Checkable rules', rep.designated ? 'None declared' : 'Nothing to check until an architecture is designated')}
              {rep.drift.declaredNotFound.length ? row('Declared, not on disk', rep.drift.declaredNotFound.join(', ')) : null}
              {rep.drift.foundNotDeclared.length ? row('On disk, not declared', rep.drift.foundNotDeclared.join(', ')) : null}
              <FacetCriteriaSection facet="architecture" />
            </>
          )}
          {secOn('packs') && (
            <>
              <div className="aa-group">Architecture plan packs</div>
              <ArchPacksSection
                onFollowed={(declaration, report) => setData(d => (d ? { ...d, arch: declaration, archReport: report } : d))}
              />
            </>
          )}
        </>
      )
    }
    if (facet === 'tech-stack') {
      // Derived, never declared (§6): everything here is read
      // from the project's manifests, lockfiles, and files.
      const s = data.stack
      if (!s) return <div className="ap-empty">The stack could not be derived for this project.</div>
      return (
        <>
          {secOn('state') && (
            <>
              <div className="aa-group">Stack summary</div>
              {s.languages.map(l => row(`Language — ${l.name}`, `${l.files} files · ${l.locations.slice(0, 3).join(', ')}`))}
              {s.facts.map(f => row('Stack fact', f))}
              {row('Ecosystems', s.ecosystems.length ? s.ecosystems.join(', ') : 'None recognised')}
              {!s.languages.length && row('Languages', 'No source files found yet')}
            </>
          )}
          {secOn('packages') && (
            <>
              <div className="aa-group">Packages</div>
              {s.packages.slice(0, 40).map(p => row(
                p.name,
                `${p.kind === 'dev' ? 'dev · ' : ''}declared ${p.declared ?? '—'} · installed ${p.installed ?? 'not installed'}${p.usedBy.length ? ` · used in ${p.usedBy.length} file${p.usedBy.length === 1 ? '' : 's'}` : ''}`,
              ))}
              {s.packages.length > 40 ? row('…', `and ${s.packages.length - 40} more`) : null}
              {!s.packages.length && row('Packages', 'No manifest found — nothing declared yet')}
              <PackageTurns packages={s.packages} />
            </>
          )}
          {secOn('files') && (
            <>
              <div className="aa-group">Files of note</div>
              {s.filesOfNote.map(f => row(f.path, f.what))}
              {!s.filesOfNote.length && row('Files of note', 'None — no manifests or config files found')}
              <div className="field-hint">These files are edited in the Configuration facet; Tech Stack only refers to them.</div>
            </>
          )}
          {secOn('report') && (
            <>
              <div className="aa-group">Report</div>
              {row('Declared, not installed', s.report.declaredNotInstalled.length ? s.report.declaredNotInstalled.join(', ') : 'None')}
              {row('Installed, not declared', s.report.installedNotDeclared.length ? s.report.installedNotDeclared.slice(0, 12).join(', ') : 'None')}
              {row('Version mismatches', s.report.versionMismatches.length ? s.report.versionMismatches.map(m => `${m.name} (declared ${m.declared}, installed ${m.installed})`).join(' · ') : 'None')}
              {row('Candidate unused', s.report.candidateUnused.length ? `${s.report.candidateUnused.join(', ')} — candidates only: nothing here is asserted unused, dynamic references lie` : 'None')}
              <FacetCriteriaSection facet="tech-stack" />
            </>
          )}
        </>
      )
    }
    if (facet === 'configuration') {
      // Every config aspect of the project directory, gathered
      // (§7): recognizer groups, the project record's rehomed
      // rows, and a report that never hides a file.
      const inv = data.inventory
      if (!inv) return <div className="ap-empty">The configuration inventory could not be read for this project.</div>
      const total = inv.groups.reduce((n, g) => n + g.entries.length, 0)
      return (
        <>
          {secOn('state') && (
            <>
              <div className="aa-group">Current state</div>
              {row('Recognised as', inv.groups.length ? inv.groups.map(g => g.label).join(' + ') : 'Nothing recognised yet')}
              {row('Config files', `${total}`)}
            </>
          )}
          {secOn('entries') && inv.groups.map(g => (
            <div key={g.id}>
              <div className="aa-group">{g.label}</div>
              {g.entries.map(e => row(
                `${e.aspect} — ${e.file}`,
                e.envKeys ? `${e.summary} (${e.envKeys.join(', ')})` : e.summary,
              ))}
            </div>
          ))}
          {secOn('project') && (
            <>
              <div className="aa-group">Project record</div>
              {row('Project type', inv.projectRecord?.type ?? data.config?.type ?? 'Not designated yet')}
              {row('Format', inv.projectRecord?.format ?? data.config?.format ?? 'App (viewport-fit)')}
              {row('Device targets', inv.projectRecord?.deviceTargets?.length ? inv.projectRecord.deviceTargets.join(', ') : (data.config?.deviceTargets?.length ? data.config.deviceTargets.join(', ') : 'Not set'))}
              {row('Start page', inv.projectRecord?.entry ?? data.config?.entry ?? startPage ?? 'Not set')}
              <div className="field-hint">These rows live here now — format and device targets are setup, not architecture (§4.1). The record itself is still project.ai.json.</div>
              <div style={{ marginTop: 8 }}>
                <button type="button" className="wiz-btn" onClick={() => onOpenSettings('project')}>Project settings…</button>
              </div>
            </>
          )}
          {secOn('report') && (
            <>
              <div className="aa-group">Report</div>
              {row('Unrecognised config files', inv.unrecognised.length ? inv.unrecognised.join(', ') : 'None — every config-looking file is recognised')}
              {row('Aspects with no file', inv.groups.flatMap(g => g.missingAspects).length ? inv.groups.flatMap(g => g.missingAspects).join(' · ') : 'None')}
              <div className="field-hint">Environment files are listed with variable names only — their values never appear here (§7.3). Open the file itself to see or change a value.</div>
              <FacetCriteriaSection facet="configuration" />
            </>
          )}
        </>
      )
    }
    if (facet === 'graphic-design') {
      // The design system manager (design §3.1): one block per
      // registry section, so Settings → Facets and this screen can
      // never disagree about which sections exist (§10.1). The
      // editor's own theme is NOT here — that is ALE's appearance,
      // and it lives in Settings. Sections fill with real data as
      // their machinery lands (guide record, token derivation,
      // GUI guide); until then each says so plainly.
      const c = data.config
      const g = data.guide
      const sectionBody = (id: string): React.ReactNode => {
        switch (id) {
          case 'guide':
            return (
              <>
                {g
                  ? <>
                      {row('Name', g.name ?? 'Unnamed')}
                      {g.description ? row('Description', g.description) : null}
                      {g.provenance ? row('Arrived with', `the ${g.provenance} design pack`) : null}
                    </>
                  : row('Design guide', c?.styleSet ? `${c.styleSet} — named in the project record; the guide record itself is not filled in yet` : 'Not designated yet — import a design or choose a design pack')}
                <DesignGuideForm
                  initial={g}
                  onSaved={saved => setData(d => (d ? { ...d, guide: saved } : d))}
                />
              </>
            )
          case 'tokens': {
            const graphTokens = (data.designGraph?.nodes ?? []).filter(n => n.kind === 'token')
            if (graphTokens.length) {
              const groups = new Map<string, number>()
              for (const t of graphTokens) groups.set(t.group ?? 'other', (groups.get(t.group ?? 'other') ?? 0) + 1)
              return (
                <>
                  {row('Token source', data.designGraph?.source ? `${data.designGraph.source.file} (${data.designGraph.source.kind})` : 'Derived')}
                  {[...groups.entries()].map(([grp, n]) => row(`Group — ${grp}`, `${n} token${n === 1 ? '' : 's'}`))}
                  {graphTokens.slice(0, 12).map(t => row(`--${t.name}`, t.value ?? ''))}
                  {graphTokens.length > 12 ? row('…', `and ${graphTokens.length - 12} more`) : null}
                  <TokenEditor
                    tokens={graphTokens}
                    onUpdated={(graph, report) => setData(d => (d ? { ...d, designGraph: graph, designReport: report } : d))}
                  />
                </>
              )
            }
            return g?.tokens?.file || g?.tokens?.source
              ? <>
                  {g.tokens.file ? row('Token source file', g.tokens.file) : null}
                  {g.tokens.source ? row('Token source kind', g.tokens.source) : null}
                  {g.tokens.groups?.length ? row('Groups', g.tokens.groups.join(', ')) : null}
                </>
              : row('Token source', 'Not designated yet — derive the design graph and tokens appear here')
          }
          case 'typography':
            return g?.typography
              ? <>
                  {g.typography.families.map(f => row(`Family — ${f.name}`, [f.role, f.source].filter(Boolean).join(' · ') || '—'))}
                  {g.typography.scale.map(t => row(`Step — ${t.step}`, `${t.size}${t.weight ? ` · ${t.weight}` : ''}${t.lineHeight ? ` · line ${t.lineHeight}` : ''}`))}
                </>
              : row('Type families', 'Not designated yet')
          case 'layout':
            return g?.layout
              ? <>
                  {g.layout.grid ? row('Grid', `${g.layout.grid.columns ?? '—'} columns${g.layout.grid.gutter ? ` · gutter ${g.layout.grid.gutter}` : ''}${g.layout.grid.margin ? ` · margin ${g.layout.grid.margin}` : ''}`) : null}
                  {g.layout.spacingBase !== undefined ? row('Spacing base', `${g.layout.spacingBase}px`) : null}
                  {g.layout.breakpoints.map(b => row(`Breakpoint — ${b.name}`, `${b.minWidth}px and up`))}
                </>
              : row('Breakpoints', c?.deviceTargets?.length ? c.deviceTargets.join(', ') : 'Not set')
          case 'icons': {
            const iconCount = (data.designGraph?.nodes ?? []).filter(n => n.kind === 'icon').length
            return g?.icons
              ? <>
                  {g.icons.sets.map(set => row(`Set — ${set.name}`, [set.format, set.source].filter(Boolean).join(' · ') || '—'))}
                  {iconCount ? row('Icons derived', `${iconCount}`) : null}
                  {g.icons.usage ? row('Usage', g.icons.usage) : null}
                </>
              : row('Icon sets', 'Not designated yet')
          }
          case 'gui-guide': {
            return (
              <GuiGuideSection
                graph={data.designGraph}
                onUpdated={(graph, report) => setData(d => (d ? { ...d, designGraph: graph, designReport: report } : d))}
              />
            )
          }
          case 'graph': {
            const dg = data.designGraph
            const rep = data.designReport
            const count = (kind: string) => (dg?.nodes ?? []).filter(n => n.kind === kind).length
            return (
              <>
                {dg
                  ? <>
                      {row('Derived', `${new Date(dg.derivedAt).toLocaleString()} — ${dg.nodes.length} nodes, ${dg.edges.length} edges`)}
                      {row('Nodes', `${count('token')} tokens · ${count('component')} components · ${count('icon')} icons · ${count('type-step')} type steps`)}
                    </>
                  : row('Design graph', 'Not derived yet — derive it and the tokens, components, and icons on this page fill in')}
                {rep && (
                  <>
                    {row('Unused tokens', rep.unusedTokens.length ? `${rep.unusedTokens.length}: ${rep.unusedTokens.slice(0, 6).join(', ')}${rep.unusedTokens.length > 6 ? '…' : ''}` : 'None')}
                    {row('Hard-coded values', rep.hardcoded.length ? rep.hardcoded.slice(0, 5).map(h => `${h.value} ×${h.count}`).join(' · ') : 'None found')}
                    {row('Contrast flags', rep.contrastFlags.length ? rep.contrastFlags.map(f => `${f.text} on ${f.background} (${f.ratio})`).join(' · ') : 'None')}
                    {row('Type steps not seen in use', rep.unseenTypeSteps.length ? rep.unseenTypeSteps.join(', ') : 'None')}
                  </>
                )}
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button" className="wiz-btn"
                    onClick={() => { void deriveDesignGraph().then(r => setData(d => (d ? { ...d, designGraph: r.graph, designReport: r.report } : d))).catch(() => {}) }}
                  >
                    {dg ? 'Re-derive the design graph' : 'Derive the design graph'}
                  </button>
                </div>
                <FacetCriteriaSection facet="graphic-design" />
              </>
            )
          }
          case 'packs':
            return (
              <DesignPacksSection
                installedProvenance={g?.provenance}
                onApplied={(guide, graph, report) => setData(d => (d ? { ...d, guide, designGraph: graph, designReport: report } : d))}
              />
            )
          default:
            return null
        }
      }
      return (
        <>
          {sectionsForFacet('graphic-design')
            .filter(sec => sec.id !== 'actions' && sec.id !== 'wizards' && secOn(sec.id))
            .map(sec => (
              <div key={sec.id}>
                <div className="aa-group">{sec.title}</div>
                {sectionBody(sec.id)}
              </div>
            ))}
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
        {sectionEnabled(prefs, 'overview', 'facets') && (
          <>
            <div className="aa-group">Facets</div>
            {FACET_IDS.filter(f => f !== 'overview').map(f => {
              const on = facetEnabled(prefs, f)
              // One state line per facet (§9): what stands there,
              // from the facet's own data — Overview owns none.
              const stateLine = !on
                ? 'Turned off in Settings → Facets'
                : f === 'features'
                  ? (r ? `${r.pct}% built (${r.built}/${r.total})` : 'No feature graph yet')
                  : f === 'architecture'
                    ? (data.arch ? `Designated${data.arch.name ? `: ${data.arch.name}` : ''} · ${data.archReport?.rules.filter(x => x.verdict === 'fail').length ?? 0} failing rule(s)` : 'Not designated yet')
                    : f === 'graphic-design'
                      ? (data.guide ? `Guide designated${data.guide.name ? `: ${data.guide.name}` : ''} · ${data.designReport ? `${data.designReport.unusedTokens.length} unused token(s), ${data.designReport.hardcoded.length} hard-coded value(s)` : 'graph not derived'}` : 'No design guide yet')
                      : f === 'tech-stack'
                        ? (data.stack ? `${data.stack.facts.slice(0, 2).join(' · ') || 'Derived'} · ${data.stack.packages.length} package(s) · ${data.stack.report.versionMismatches.length} version mismatch(es)` : 'Not derived yet')
                        : f === 'configuration'
                          ? (data.inventory ? `${data.inventory.groups.map(g => g.label).join(' + ') || 'Nothing recognised'} · ${data.inventory.unrecognised.length} unrecognised file(s)` : 'Not read yet')
                          : FACET_BLURBS[f]
              return (
                <div className="fs-pack" key={f}>
                  <span><b>{FACET_TITLES[f]}</b> — {stateLine}</span>
                  {on
                    ? <button type="button" className="wiz-btn" onClick={() => onNavigateFacet(f)}>Open</button>
                    : <button type="button" className="wiz-btn" onClick={() => saveUiPrefs(facetTogglePatch(prefs, f, true))}>Turn on</button>}
                </div>
              )
            })}
            <div className="aa-group">Across facets</div>
            {row('Cross-facet links', data.links.length ? `${data.links.length} — ${data.links.filter(l => !l.resolved).length} broken` : 'None yet')}
            {data.links.filter(l => !l.resolved).map(l => row(`Broken — ${l.kind} (${l.id})`, `${l.from} → ${l.to} (${l.targetLabel} not found)`))}
            {row('Design drift', data.designReport ? `${data.designReport.hardcoded.length} hard-coded value(s), ${data.designReport.unusedTokens.length} unused token(s)` : 'Not derived yet')}
            {row('Architecture drift', data.archReport ? (data.archReport.designated ? `${data.archReport.drift.declaredNotFound.length} declared module(s) missing` : 'Not designated') : 'Not read yet')}
          </>
        )}
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
    if (facet === 'graphic-design') return 'Suggested next step: designate the design guide — import your design system or choose a design pack to start from.'
    if (facet === 'overview') return 'Suggested next step: open the facet that needs work — Features is where most building happens.'
    return ''
  }

  const facetActions = facet === 'overview'
    ? AGENT_ACTIONS.filter(a => a.facet === 'any')
    : actionsForFacet(facet)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div className="facet-bar" role="tablist" aria-label="Facets">
        {FACET_IDS.filter(f => facetEnabled(prefs, f)).map(f => (
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

        {secOn('actions') && (
          <>
            <div className="aa-group">{FACET_TITLES[facet]} actions</div>
            <div className="facet-grid">{facetActions.map(actionCard)}</div>
          </>
        )}

        {facet !== 'overview' && secOn('wizards') && (
          <>
            <div className="aa-group">{FACET_TITLES[facet]} wizards</div>
            <div className="facet-grid">{wizardsForFacet(facet as ProjectFacetId).map(wizardCard)}</div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Design packs (§3.7) + the import wizard's facet surface
 * (§3.8): preview a pack with the §2.2 states before applying;
 * import a folder or zip and see the mapped / unmapped /
 * missing screen before anything is written. The Wizards-menu
 * entries stay stubs — this section is where the work happens.
 */
function DesignPacksSection({ installedProvenance, onApplied }: {
  installedProvenance?: string
  onApplied: (guide: DesignGuideItem, graph: DesignGraphItem, report: DesignReportItem) => void
}) {
  const [packs, setPacks] = useState<DesignPackItem[]>([])
  const [preview, setPreview] = useState<{ pack: string, items: { item: string, state: string, detail: string }[] } | null>(null)
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<{ path: string, content: string }[]>([])
  const [mapping, setMapping] = useState<DesignImportMappingItem | null>(null)
  const row = (label: string, value: React.ReactNode, key?: number) => (
    <div className="fs-row" key={key ?? label}><span>{label}</span><b>{value}</b></div>
  )

  useEffect(() => {
    let live = true
    void getDesignPacks().then(r => { if (live && r.ok) setPacks(r.packs) }).catch(() => {})
    return () => { live = false }
  }, [])

  async function pickFolderFiles() {
    setNote('')
    try {
      const { pickFolder } = await import('../lib/folderImport')
      const picked = await pickFolder()
      const read: { path: string, content: string }[] = []
      for (const f of picked.files.slice(0, 200)) {
        try { read.push({ path: f.path, content: await f.file.text() }) } catch { /* unreadable files stay out, and the mapping says what is missing */ }
      }
      setFiles(read)
      const r = await mapDesignImport(read, false)
      setMapping(r.mapping)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not read that folder')
    }
  }

  async function pickZipFiles(file: File) {
    setNote('')
    try {
      const { unzipTextFiles } = await import('../lib/zipRead')
      const { files: read, skipped } = await unzipTextFiles(await file.arrayBuffer())
      setFiles(read)
      const r = await mapDesignImport(read, false)
      setMapping(r.mapping)
      if (skipped.length) setNote(`In the zip but not readable as design files: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '…' : ''}`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not read that zip')
    }
  }

  async function confirmImport() {
    const r = await mapDesignImport(files, true)
    if (r.graph && r.report) onApplied(r.mapping.guide ?? ({} as DesignGuideItem), r.graph, r.report)
    setNote(r.mapping.isPack
      ? 'That folder is a design pack — apply it from the pack list above.'
      : 'Imported: the guide is written, the files are kept under ai-design/resources/, and the token source is set.')
  }

  return (
    <div>
      {row('Design packs installed', installedProvenance ?? 'None')}
      {packs.map(p => (
        <div key={p.id} style={{ marginTop: 6 }}>
          {row(p.name, `${p.description} (v${p.version})`)}
          <div style={{ display: 'flex', gap: 7, marginTop: 4 }}>
            <button type="button" className="wiz-btn" onClick={() => { void previewDesignPack(p.id).then(r => setPreview(r.preview)).catch(() => {}) }}>
              Preview against your project
            </button>
            <button
              type="button" className="wiz-btn" disabled={preview?.pack !== p.id}
              title={preview?.pack === p.id ? 'Apply this pack' : 'Preview it first — applying follows the preview'}
              onClick={() => { void applyDesignPack(p.id).then(r => { onApplied(r.guide, r.graph, r.report); setNote(`${p.name} applied — the guide, tokens, and previews now describe it.`) }).catch(e => setNote(e instanceof Error ? e.message : 'Could not apply the pack')) }}
            >
              Apply this pack
            </button>
          </div>
          {preview?.pack === p.id && (
            <div style={{ marginTop: 6 }}>
              {preview.items.map((it, i) => row(`${it.state} — ${it.item}`, it.detail, i))}
            </div>
          )}
        </div>
      ))}
      {!packs.length && row('Stock packs', 'None in the catalog yet — import one below')}
      <div className="aa-group" style={{ marginTop: 10 }}>Import graphic design</div>
      <div className="field-hint">Bring a design system in from a folder or a zip. You see what maps to the guide, what does not, and what is missing before anything is written.</div>
      <div style={{ display: 'flex', gap: 7, marginTop: 6, alignItems: 'center' }}>
        <button type="button" className="wiz-btn" onClick={() => void pickFolderFiles()}>Pick a folder…</button>
        <label className="wiz-btn" style={{ cursor: 'pointer' }}>
          Pick a zip…
          <input type="file" accept=".zip" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) void pickZipFiles(f) }} />
        </label>
      </div>
      {mapping && (
        <div style={{ marginTop: 8 }}>
          {mapping.isPack && row('This is a design pack', 'Apply it from the pack list — a pack is applied as one set, not mapped field by field.')}
          {mapping.mapped.map((m, i) => row(`mapped — ${m.field}`, `${m.detail} (from ${m.source})`, i))}
          {mapping.unmapped.map((m, i) => row(`unmapped — ${m.source}`, `Kept at ${m.keptAs}`, i))}
          {mapping.missing.length ? row('missing', `Nothing filled: ${mapping.missing.join(', ')}`) : null}
          {!mapping.isPack && (
            <button type="button" className="wiz-btn primary" style={{ marginTop: 6 }} onClick={() => void confirmImport()}>
              Write the guide and keep the files
            </button>
          )}
        </div>
      )}
      {note && <div className="field-hint" style={{ marginTop: 6 }}>{note}</div>}
    </div>
  )
}

/**
 * Architecture plan packs (§4.3): preview a pack against the
 * codebase, follow it (writes the declaration), or apply it to
 * this codebase as a refactor plan in the plan system.
 */
function ArchPacksSection({ onFollowed }: {
  onFollowed: (declaration: ArchitectureDeclarationItem, report: ArchitectureReportItem) => void
}) {
  const [packs, setPacks] = useState<ArchPackItem[]>([])
  const [preview, setPreview] = useState<{ pack: string, items: { item: string, state: string, detail: string }[] } | null>(null)
  const [note, setNote] = useState('')
  const row = (label: string, value: React.ReactNode, key?: number) => (
    <div className="fs-row" key={key ?? label}><span>{label}</span><b>{value}</b></div>
  )
  useEffect(() => {
    let live = true
    void getArchPacks().then(r => { if (live && r.ok) setPacks(r.packs) }).catch(() => {})
    return () => { live = false }
  }, [])
  if (!packs.length) return row('Plan packs', 'None in the catalog yet')
  return (
    <div>
      {packs.map(p => (
        <div key={p.id} style={{ marginTop: 6 }}>
          {row(p.name, `${p.description} (v${p.version})`)}
          <div style={{ display: 'flex', gap: 7, marginTop: 4, flexWrap: 'wrap' }}>
            <button type="button" className="wiz-btn" onClick={() => { void previewArchPack(p.id).then(r => setPreview({ pack: p.id, items: r.preview })).catch(() => {}) }}>
              Preview against this codebase
            </button>
            <button
              type="button" className="wiz-btn" disabled={preview?.pack !== p.id}
              title={preview?.pack === p.id ? 'Write this pack\u2019s declaration' : 'Preview it first'}
              onClick={() => { void followArchPack(p.id).then(r => { onFollowed(r.declaration, r.report); setNote(`Following ${p.name} — its declaration and guide are written, and the agent brief now carries them.`) }).catch(e => setNote(e instanceof Error ? e.message : 'Could not follow the pack')) }}
            >
              Follow this pack
            </button>
            <button
              type="button" className="wiz-btn" disabled={preview?.pack !== p.id}
              title={preview?.pack === p.id ? 'Form a refactor plan in the plan system' : 'Preview it first'}
              onClick={() => { void planArchPack(p.id).then(r => setNote(`Plan formed: "${r.plan.title}" (${r.plan.tasks} tasks) — open it with /plan in chat.`)).catch(e => setNote(e instanceof Error ? e.message : 'Could not form the plan')) }}
            >
              Apply as a refactor plan
            </button>
          </div>
          {preview?.pack === p.id && (
            <div style={{ marginTop: 6 }}>
              {preview.items.map((it, i) => row(`${it.state} — ${it.item}`, it.detail, i))}
            </div>
          )}
        </div>
      ))}
      {note && <div className="field-hint" style={{ marginTop: 6 }}>{note}</div>}
    </div>
  )
}

/**
 * Package wizards as agent turns (§6.3): the facet itself runs
 * no npm commands. You name the package here; the turn sent to
 * the agent carries its declared and installed versions, and
 * the usual tools + gate do and check the work.
 */
function PackageTurns({ packages }: { packages: TechStackItem['packages'] }) {
  const [name, setName] = useState('')
  const pkg = packages.find(p => p.name === name.trim())
  const versions = pkg ? ` (declared ${pkg.declared ?? '—'}, installed ${pkg.installed ?? 'not installed'})` : ''
  const send = (verb: string, brief: string) => {
    if (!name.trim()) return
    askAi(`${verb} the package "${name.trim()}"${versions} in this project. ${brief} Use the project's package manager, update the manifest and lockfile together, and run the build so the gate checks the result. Report what changed and anything that broke.`)
  }
  return (
    <div style={{ marginTop: 10, display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
      <input className="deck-input" value={name} onChange={e => setName(e.target.value)} placeholder="Package name" style={{ width: 180 }} />
      <button type="button" className="wiz-btn" disabled={!name.trim()} onClick={() => send('Add', 'Add it as a runtime dependency unless it is clearly a build tool.')}>Add a package…</button>
      <button type="button" className="wiz-btn" disabled={!pkg} title={pkg ? 'Send an upgrade turn' : 'Name a package from the list above'} onClick={() => send('Upgrade', 'Upgrade it to the newest version its declared range allows, or widen the range if I would need that — say which you did.')}>Upgrade…</button>
      <button type="button" className="wiz-btn" disabled={!pkg} title={pkg ? 'Send a removal turn' : 'Name a package from the list above'} onClick={() => send('Remove', 'Remove it and fix every import of it, or stop and tell me where it is still used.')}>Remove…</button>
    </div>
  )
}

/**
 * Cross-facet links (§8.1) on the Features facet, which owns
 * most of them: each link shows whether its target still
 * resolves; a broken one says so instead of vanishing. Adding
 * is a small form — kind, this feature, target.
 */
function CrossLinksSection({ links, onChanged }: {
  links: CrossLinkItem[]
  onChanged: (links: CrossLinkItem[]) => void
}) {
  const [kind, setKind] = useState<CrossLinkItem['kind']>('uses-component')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  const row = (label: string, value: React.ReactNode, key?: string) => (
    <div className="fs-row" key={key ?? label}><span>{label}</span><b>{value}</b></div>
  )
  async function add() {
    if (!from.trim() || !to.trim()) return
    try {
      const r = await apiAddCrossLink({ kind, from: from.trim(), to: to.trim() })
      onChanged(r.links)
      setFrom('')
      setTo('')
      setNote('')
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not add the link')
    }
  }
  return (
    <div>
      <div className="aa-group">Cross-facet links</div>
      {links.map(l => row(
        `${l.kind} — ${l.from} → ${l.to}`,
        l.resolved ? `resolves to ${l.targetLabel}` : `BROKEN — ${l.targetLabel} was not found`,
        l.id,
      ))}
      {!links.length && row('Links', 'None yet — link a feature to the components, packages, and config it depends on')}
      <div style={{ display: 'flex', gap: 7, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select className="deck-input" value={kind} onChange={e => setKind(e.target.value as CrossLinkItem['kind'])}>
          <option value="uses-component">uses-component</option>
          <option value="requires-package">requires-package</option>
          <option value="needs-config">needs-config</option>
          <option value="follows-rule">follows-rule</option>
          <option value="styled-by">styled-by</option>
        </select>
        <input className="deck-input" value={from} onChange={e => setFrom(e.target.value)} placeholder="From (feature name)" style={{ width: 150 }} />
        <input className="deck-input" value={to} onChange={e => setTo(e.target.value)} placeholder="To (component / package / file)" style={{ width: 200 }} />
        <button type="button" className="wiz-btn" disabled={!from.trim() || !to.trim()} onClick={() => void add()}>Add link</button>
        {links.filter(l => !l.resolved).map(l => (
          <button key={l.id} type="button" className="wiz-btn" onClick={() => { void apiRemoveCrossLink(l.id).then(r => onChanged(r.links)).catch(() => {}) }}>
            Remove broken {l.kind} link
          </button>
        ))}
      </div>
      {note && <div className="field-hint" style={{ marginTop: 6 }}>{note}</div>}
    </div>
  )
}

/**
 * The per-facet criteria runner (§8.3): one button per facet
 * runs its criteria set against the facet's own reports and
 * shows pass / fail / couldn't-check with evidence.
 */
function FacetCriteriaSection({ facet }: { facet: 'architecture' | 'graphic-design' | 'configuration' | 'tech-stack' }) {
  const [run, setRun] = useState<FacetCriteriaRunItem | null>(null)
  const [note, setNote] = useState('')
  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button" className="wiz-btn"
        onClick={() => { void getFacetCriteria(facet).then(r => setRun(r.run)).catch(e => setNote(e instanceof Error ? e.message : 'Could not run the criteria')) }}
      >
        Run this facet's criteria
      </button>
      {note && <span className="field-hint" style={{ marginLeft: 7 }}>{note}</span>}
      {run && run.results.map(r => (
        <div className="fs-row" key={r.id}><span>{`${r.verdict} — ${r.id}`}</span><b>{`${r.say} · ${r.evidence}`}</b></div>
      ))}
    </div>
  )
}

/**
 * Token write-back editor (§3.4/§3.6): pick a token, change its
 * value, and the change lands in the token source file itself —
 * the facet then re-derives, so every preview using the token
 * shows the new value.
 */
function TokenEditor({ tokens, onUpdated }: {
  tokens: DesignGraphItem['nodes']
  onUpdated: (graph: DesignGraphItem, report: DesignReportItem) => void
}) {
  const [name, setName] = useState(tokens[0]?.name ?? '')
  const [value, setValue] = useState(tokens[0]?.value ?? '')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  if (!tokens.length) return null
  async function save() {
    setSaving(true)
    setNote('')
    try {
      const r = await setDesignTokenValue(name, value)
      onUpdated(r.graph, r.report)
      setNote(`Saved to the token source — previews now use ${value}.`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not save the token')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div style={{ marginTop: 8, display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
      <select
        className="deck-input" value={name}
        onChange={e => { setName(e.target.value); setValue(tokens.find(t => t.name === e.target.value)?.value ?? '') }}
      >
        {tokens.map(t => <option key={t.id} value={t.name}>--{t.name}</option>)}
      </select>
      <input className="deck-input" value={value} onChange={e => setValue(e.target.value)} style={{ width: 140 }} />
      <button type="button" className="wiz-btn" disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save token to its source file'}
      </button>
      {note && <span className="field-hint">{note}</span>}
    </div>
  )
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The standalone GUI guide document (§3.6, §12 decision 3): a
 * self-contained page for the sandboxed frame — colour swatches
 * and the type ramp rendered with the project's real token
 * values, spacing steps as bars, and one card per component in
 * use (name + file; a component's live rendering stays with the
 * app preview, which is the place it actually runs). */
export function guiGuideHtml(graph: DesignGraphItem | null): string {
  const nodes = graph?.nodes ?? []
  const tokens = nodes.filter(n => n.kind === 'token')
  const colours = tokens.filter(t => t.group === 'colour')
  const spacing = tokens.filter(t => t.group === 'spacing')
  const steps = nodes.filter(n => n.kind === 'type-step')
  const comps = nodes.filter(n => n.kind === 'component')
  const icons = nodes.filter(n => n.kind === 'icon')
  const sw = colours.map(t => `<div style="display:inline-block;width:130px;margin:4px;vertical-align:top"><div style="height:44px;border:1px solid #999;background:${escHtml(t.value ?? '')}"></div><div style="font:12px sans-serif">${escHtml(t.name)}<br>${escHtml(t.value ?? '')}</div></div>`).join('')
  const ramp = steps.map(t => `<div style="font-size:${escHtml(t.value ?? '16px')};font-family:sans-serif;margin:4px 0">${escHtml(t.name)} — ${escHtml(t.value ?? '')}</div>`).join('')
  const bars = spacing.map(t => `<div style="margin:3px 0;font:12px sans-serif"><span style="display:inline-block;height:10px;background:#4676c8;width:${escHtml(t.value ?? '0')}"></span> ${escHtml(t.name)}: ${escHtml(t.value ?? '')}</div>`).join('')
  const cards = comps.map(c => `<div style="display:inline-block;width:180px;border:1px solid #999;padding:8px;margin:4px;font:13px sans-serif;vertical-align:top"><strong>${escHtml(c.name)}</strong><br><span style="color:#555">${escHtml(c.file ?? '')}</span>${c.note ? `<br>${escHtml(c.note)}` : ''}</div>`).join('')
  return `<!doctype html><html><body style="margin:10px;font-family:sans-serif"><h2 style="font-size:17px">Colours</h2>${sw || '<p>No colour tokens derived yet.</p>'}<h2 style="font-size:17px">Type ramp</h2>${ramp || '<p>No type steps in the guide yet.</p>'}<h2 style="font-size:17px">Spacing</h2>${bars || '<p>No spacing tokens derived yet.</p>'}<h2 style="font-size:17px">Components in use (${comps.length})</h2>${cards || '<p>No components derived yet.</p>'}<h2 style="font-size:17px">Icons (${icons.length})</h2><p style="font:13px sans-serif">${icons.slice(0, 40).map(i => escHtml(i.name)).join(' · ') || 'No icons derived yet.'}</p></body></html>`
}

function GuiGuideSection({ graph, onUpdated }: {
  graph: DesignGraphItem | null
  onUpdated: (graph: DesignGraphItem, report: DesignReportItem) => void
}) {
  const tokens = (graph?.nodes ?? []).filter(n => n.kind === 'token')
  return (
    <>
      <div className="field-hint" style={{ marginBottom: 6 }}>
        Rendered in its own frame from the project's real tokens, so it works whether or not a page is running.
        Changing a token below writes it back to its source file and this guide re-renders.
      </div>
      <iframe
        title="GUI guide"
        sandbox=""
        srcDoc={guiGuideHtml(graph)}
        style={{ width: '100%', height: 340, border: '1px solid var(--line, #bbb)', background: '#fff' }}
      />
      <TokenEditor tokens={tokens} onUpdated={onUpdated} />
    </>
  )
}

/**
 * The design guide form (design §3.3): the facet's editing surface
 * over the guide record's prose and token-pointer fields. The
 * structured areas (typography scale, layout, icons, components)
 * are filled by derivation, the import wizard, and the agent's
 * design-guide-set tool — this form is for the parts a person
 * writes: what the system is called, what it stands for, and
 * where its tokens live. Saving writes the whole record through
 * the API, which sanitizes it like every other store.
 */
function DesignGuideForm({ initial, onSaved }: {
  initial: DesignGuideItem | null
  onSaved: (g: DesignGuideItem) => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [principles, setPrinciples] = useState(initial?.principles ?? '')
  const [tokenSource, setTokenSource] = useState(initial?.tokens?.source ?? '')
  const [tokenFile, setTokenFile] = useState(initial?.tokens?.file ?? '')
  const [voice, setVoice] = useState(initial?.voice ?? '')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const field = (label: string, el: React.ReactNode) => (
    <div className="fs-row" key={label}><span>{label}</span><span style={{ flex: 1 }}>{el}</span></div>
  )

  async function save() {
    setSaving(true)
    setNote('')
    try {
      const guide: DesignGuideItem = {
        ...(initial ?? { version: 1 as const }),
        version: 1,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(principles.trim() ? { principles: principles.trim() } : {}),
        ...(voice.trim() ? { voice: voice.trim() } : {}),
        ...(tokenFile.trim() || tokenSource
          ? { tokens: { ...(initial?.tokens ?? {}), ...(tokenSource ? { source: tokenSource as DesignGuideItem['tokens'] extends { source?: infer S } ? S : never } : {}), ...(tokenFile.trim() ? { file: tokenFile.trim() } : {}) } }
          : {}),
      }
      const r = await saveDesignGuide(guide)
      onSaved(r.guide)
      setNote('Saved — the agent brief now carries this guide.')
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not save the guide')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      {field('Name', <input className="deck-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Lumen design system" />)}
      {field('Description', <input className="deck-input" value={description} onChange={e => setDescription(e.target.value)} placeholder="One line: what this system is" />)}
      {field('Principles', <textarea className="deck-input" rows={4} value={principles} onChange={e => setPrinciples(e.target.value)} placeholder="The principles and usage guidance the agent should follow" />)}
      {field('Token source', (
        <select className="deck-input" value={tokenSource} onChange={e => setTokenSource(e.target.value)}>
          <option value="">Not designated</option>
          <option value="css-variables">CSS variables</option>
          <option value="tokens-json">Design tokens JSON</option>
          <option value="tailwind">Tailwind config</option>
        </select>
      ))}
      {field('Token file', <input className="deck-input" value={tokenFile} onChange={e => setTokenFile(e.target.value)} placeholder="e.g. src/theme.css" />)}
      {field('Voice', <input className="deck-input" value={voice} onChange={e => setVoice(e.target.value)} placeholder="Tone of UI text, if the guide states one" />)}
      <div style={{ display: 'flex', gap: 7, marginTop: 8, alignItems: 'center' }}>
        <button type="button" className="wiz-btn primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save the guide'}
        </button>
        {note && <span className="field-hint">{note}</span>}
      </div>
    </div>
  )
}
