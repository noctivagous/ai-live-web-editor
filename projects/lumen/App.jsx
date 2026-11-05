import { useEffect, useState } from 'react'

const THEMES = [
  { id: 'lumen', name: 'Lumen', swatch: '#c45c26' },
  { id: 'aurora', name: 'Aurora', swatch: '#3ee0c6' },
  { id: 'field', name: 'Field', swatch: '#3f7d4e' },
]

const NAV = [
  { id: 'Overview', icon: '◈', hint: 'Workspace pulse' },
  { id: 'Inbox', icon: '✉', hint: '12 unread' },
  { id: 'Projects', icon: '▦', hint: '4 active' },
  { id: 'Calendar', icon: '◷', hint: 'Today' },
  { id: 'Files', icon: '▤', hint: 'Shared drive' },
  { id: 'Settings', icon: '⚙', hint: 'Workspace' },
]

const CARDS = {
  Overview: [
    { k: 'Open tasks', v: '18', d: '3 due today' },
    { k: 'In review', v: '6', d: '2 waiting on you' },
    { k: 'Shipped', v: '11', d: 'this week' },
  ],
  Inbox: [
    { k: 'Unread', v: '12', d: '4 mentions' },
    { k: 'Assigned', v: '7', d: 'needs a reply' },
    { k: 'Snoozed', v: '3', d: 'back tomorrow' },
  ],
  Projects: [
    { k: 'Active', v: '4', d: 'on track' },
    { k: 'At risk', v: '1', d: 'needs a decision' },
    { k: 'Archived', v: '9', d: 'last quarter' },
  ],
  Calendar: [
    { k: 'Today', v: '3', d: 'meetings' },
    { k: 'Focus', v: '2h', d: 'blocked' },
    { k: 'This week', v: '14', d: 'events' },
  ],
  Files: [
    { k: 'Recent', v: '28', d: 'updated today' },
    { k: 'Shared', v: '64', d: 'with the team' },
    { k: 'Storage', v: '41%', d: 'of 100 GB' },
  ],
  Settings: [
    { k: 'Members', v: '16', d: '2 pending' },
    { k: 'Roles', v: '4', d: 'custom' },
    { k: 'Plan', v: 'Pro', d: 'renews May 12' },
  ],
}

export default function App() {
  const [section, setSection] = useState('Overview')
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [theme, setTheme] = useState('aurora')
  const cards = CARDS[section]
  const themeName = THEMES.find((item) => item.id === theme)?.name ?? 'Aurora'

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return (
    <div style={shell}>
      <aside style={{ ...sidebar, width: collapsed ? 72 : 232 }}>
        <div style={brandRow}>
          <div style={mark}>L</div>
          {!collapsed && (
            <div>
              <div style={brandName}>Lumen</div>
              <div style={brandSub}>Workspace</div>
            </div>
          )}
        </div>
        <nav style={nav}>
          {NAV.map((item) => {
            const on = item.id === section
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                style={{
                  ...navBtn,
                  background: on ? 'var(--sidebar-active)' : 'transparent',
                  color: on ? 'var(--sidebar-active-ink)' : 'var(--sidebar-idle)',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  borderLeft: on ? '3px solid var(--accent)' : '3px solid transparent',
                }}
                title={item.id}
              >
                <span style={navIcon}>{item.icon}</span>
                {!collapsed && (
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
                    <span>{item.id}</span>
                    <span style={navHint}>{item.hint}</span>
                  </span>
                )}
              </button>
            )
          })}
        </nav>
        <button type="button" onClick={() => setCollapsed((v) => !v)} style={collapseBtn}>
          {collapsed ? '›' : '‹ Collapse'}
        </button>
      </aside>

      <div style={mainCol}>
        <header style={topbar}>
          <div>
            <div style={crumb}>Lumen / {section}</div>
            <h1 style={title}>{section}</h1>
          </div>
          <div style={topActions}>
            <div style={switcher} role="radiogroup" aria-label="Color theme">
              {THEMES.map((item) => {
                const on = item.id === theme
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setTheme(item.id)}
                    style={{
                      ...themeBtn,
                      background: on ? 'var(--accent)' : 'transparent',
                      color: on ? 'var(--on-accent)' : 'var(--ink)',
                      fontWeight: on ? 700 : 550,
                    }}
                    title={`${item.name} theme`}
                  >
                    <span
                      style={{
                        ...swatch,
                        background: item.swatch,
                        boxShadow: on ? '0 0 0 2px var(--on-accent)' : 'none',
                      }}
                    />
                    {item.name}
                  </button>
                )
              })}
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the workspace"
              style={search}
              aria-label="Search"
            />
            <button type="button" style={primaryBtn}>New</button>
            <div style={avatar} title="Avery Chen">AC</div>
          </div>
        </header>

        <main style={content}>
          <section style={statRow}>
            {cards.map((card) => (
              <article key={card.k} style={statCard}>
                <div style={statLabel}>{card.k}</div>
                <div style={statValue}>{card.v}</div>
                <div style={statDetail}>{card.d}</div>
              </article>
            ))}
          </section>

          <section style={panel}>
            <div style={panelHead}>
              <h2 style={panelTitle}>{section} canvas</h2>
              <div style={pillRow}>
                <span style={pill}>Theme · {themeName}</span>
                <span style={pill}>{query ? `Filter: ${query}` : 'All items'}</span>
              </div>
            </div>
            <p style={panelCopy}>
              This is the app shell: a persistent sidebar, top bar, and content canvas.
              Switch sections to see the frame stay put while the page inside changes.
            </p>
            <div style={placeholder}>
              <div style={placeholderBar} />
              <div style={{ ...placeholderBar, width: '72%' }} />
              <div style={{ ...placeholderBar, width: '54%' }} />
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

const shell = {
  display: 'flex',
  height: '100%',
  minHeight: '100%',
  background: 'var(--bg)',
  color: 'var(--ink)',
}

const sidebar = {
  flex: '0 0 auto',
  background: 'var(--sidebar)',
  color: 'var(--sidebar-ink)',
  display: 'flex',
  flexDirection: 'column',
  padding: 12,
  transition: 'width 160ms ease',
  overflow: 'hidden',
}

const brandRow = { display: 'flex', gap: 10, alignItems: 'center', padding: '8px 8px 16px' }
const mark = {
  width: 36, height: 36, borderRadius: 10,
  background: 'var(--accent)', color: 'var(--on-accent)',
  display: 'grid', placeItems: 'center', fontWeight: 700, flex: '0 0 auto',
}
const brandName = { fontWeight: 700, letterSpacing: '-0.02em' }
const brandSub = { fontSize: 12, color: 'var(--sidebar-muted)' }
const nav = { display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }
const navBtn = {
  display: 'flex', alignItems: 'center', gap: 10,
  border: 0, borderRadius: 10, padding: '10px 12px',
  cursor: 'pointer', textAlign: 'left',
}
const navIcon = { width: 18, textAlign: 'center', flex: '0 0 auto' }
const navHint = { fontSize: 11, color: 'var(--sidebar-muted)' }
const collapseBtn = {
  marginTop: 8, border: 0, background: 'transparent', color: 'var(--sidebar-muted)',
  cursor: 'pointer', padding: 10, borderRadius: 8, textAlign: 'left',
}
const mainCol = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }
const topbar = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
  padding: '16px 28px', borderBottom: '1px solid var(--line)', background: 'var(--topbar)',
  flexWrap: 'wrap',
}
const crumb = { fontSize: 12, color: 'var(--muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }
const title = { margin: '2px 0 0', fontSize: 22, letterSpacing: '-0.03em' }
const topActions = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }
const switcher = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: 3,
  borderRadius: 999,
  border: '1px solid var(--line)',
  background: 'var(--switcher-bg)',
}
const themeBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: 0,
  borderRadius: 999,
  padding: '6px 10px',
  cursor: 'pointer',
  background: 'transparent',
}
const swatch = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  flex: '0 0 auto',
}
const search = {
  width: 220, border: '1px solid var(--line)', background: 'var(--input-bg)',
  color: 'var(--ink)', borderRadius: 999, padding: '8px 14px', outline: 'none',
}
const primaryBtn = {
  border: 0, background: 'var(--btn-bg)', color: 'var(--btn-ink)',
  borderRadius: 999, padding: '8px 14px', cursor: 'pointer', fontWeight: 650,
}
const avatar = {
  width: 36, height: 36, borderRadius: '50%', background: 'var(--avatar-bg)',
  color: 'var(--avatar-ink)', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700,
}
const content = { flex: 1, overflow: 'auto', padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }
const statRow = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }
const statCard = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: 'var(--shadow)' }
const statLabel = { fontSize: 13, color: 'var(--muted)' }
const statValue = { fontSize: 28, fontWeight: 700, letterSpacing: '-0.04em', marginTop: 4 }
const statDetail = { fontSize: 13, marginTop: 4, color: 'var(--ink)' }
const panel = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: 20, boxShadow: 'var(--shadow)', flex: 1 }
const panelHead = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }
const panelTitle = { margin: 0, fontSize: 16 }
const pillRow = { display: 'flex', gap: 8, flexWrap: 'wrap' }
const pill = { fontSize: 12, background: 'var(--pill-bg)', color: 'var(--pill-ink)', borderRadius: 999, padding: '4px 10px' }
const panelCopy = { color: 'var(--muted)', maxWidth: 620, lineHeight: 1.5 }
const placeholder = { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }
const placeholderBar = { height: 12, width: '88%', borderRadius: 999, background: 'var(--placeholder)' }
