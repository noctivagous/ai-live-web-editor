# Feature graph: lumen

19 features · 58% built (11/19)

- ◑ Inbox & Email — region, building (fmw9p1mdi1)
  - ◑ Email triage workspace — screen, building (fmw9p1t8d5)
  - ◑ Smart compose thread — feature, building (fmw9p1t906)
  - ◔ Thread summarization hook — feature, planned (fmw9p1t9m7)
    _Stub only: useState(null), never populated by UI — summarization engine not implemented_
  - ● Email data store — data, done (fmw9p1ta78)
  - ● Inbox zero stat + sparkline — component, done (fmw9p1tas9)
- ◑ Today & Scheduling — region, building (fmw9p1okj2)
  - ◑ Today schedule view — screen, building (fmw9p1vi7a)
  - ◑ Calendar add + RSVP flow — feature, building (fmw9p1viyb)
  - ● Events data store — data, done (fmw9p1vjlc)
  - ● Calendar density stats — component, done (fmw9p1vk6d)
- ◑ People & Relationships — region, building (fmw9p1ol73)
  - ◑ People relationship view — screen, building (fmw9p1xlse)
  - ◑ Meeting notes composer — feature, building (fmw9p1xmnf)
  - ● People data store — data, done (fmw9p1xnfg)
  - ● Network strength stat + sparkline — component, done (fmw9p1xo5h)
- ◑ App Shell & Design System — region, building (fmw9p1olu4)
  - ◑ Overview dashboard shell — screen, building (fmw9p1xoyi)
  - ● View switcher setting — setting, done (fmw9p20lhj)
    _activeView state: overview | inbox | today | people, pill navigation_
  - ● Theme setting — setting, done (fmw9p20m3k)
    _dark/light toggle + system, CSS custom props in App.jsx ICONS block only — no theme file_
  - ● shadcn Button component — component, done (fmw9p20mpl) [component: Button]
  - ● Inline SVG icon set — component, done (fmw9p20nbm)
    _ICONS map (~30 icons) in App.jsx lines 10–400_
  - ● React SPA entry bootstrap — service, done (fmw9p20nwn)
    _main.jsx createRoot renders App; index.html three-section document shell_

## Edges

- Email data store —data-flows→ Email triage workspace
- Events data store —data-flows→ Today schedule view
- People data store —data-flows→ People relationship view
- Smart compose thread —depends-on→ Email data store
- Calendar add + RSVP flow —depends-on→ Events data store
- Meeting notes composer —depends-on→ People data store
- Email data store —data-flows→ Overview dashboard shell
- Events data store —data-flows→ Overview dashboard shell
- People data store —data-flows→ Overview dashboard shell
- View switcher setting —configures→ Overview dashboard shell
- Theme setting —configures→ Overview dashboard shell
- Email triage workspace —renders→ Overview dashboard shell
- Today schedule view —renders→ Overview dashboard shell
- People relationship view —renders→ Overview dashboard shell
- shadcn Button component —derived-from→ Overview dashboard shell

## Progress by region

- Inbox & Email: 40% (2/5)
- Today & Scheduling: 50% (2/4)
- People & Relationships: 50% (2/4)
- App Shell & Design System: 83% (5/6)
