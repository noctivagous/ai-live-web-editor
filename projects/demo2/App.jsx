import { useEffect, useState } from 'react'

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (e) => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

const NAV_TREE = [
  {
    id: 'home',
    label: 'Home',
    icon: '🏠',
  },
  {
    id: 'explore',
    label: 'Explore',
    icon: '🧭',
    children: [
      { id: 'trending', label: 'Trending', icon: '🔥' },
      { id: 'music', label: 'Music', icon: '🎵' },
      { id: 'gaming', label: 'Gaming', icon: '🎮' },
      { id: 'news', label: 'News', icon: '📰' },
    ],
  },
  {
    id: 'library',
    label: 'Library',
    icon: '📚',
    children: [
      { id: 'history', label: 'History', icon: '🕒' },
      { id: 'your-videos', label: 'Your videos', icon: '▶' },
      { id: 'watch-later', label: 'Watch later', icon: '⏱' },
      {
        id: 'playlists',
        label: 'Playlists',
        icon: '☰',
        children: [
          { id: 'favorites', label: 'Favorites', icon: '⭐' },
          { id: 'watch-mix', label: 'Watch mix', icon: '✦' },
          { id: 'learning', label: 'Learning path', icon: '📖' },
        ],
      },
      { id: 'liked', label: 'Liked videos', icon: '👍' },
    ],
  },
  {
    id: 'subscriptions',
    label: 'Subscriptions',
    icon: '📑',
    children: [
      { id: 'dev-craft', label: 'Dev Craft', icon: '●' },
      { id: 'layout-lab', label: 'Layout Lab', icon: '●' },
      { id: 'pixel-type', label: 'Pixel & Type', icon: '●' },
      { id: 'code-trail', label: 'Code Trail', icon: '●' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: '⚙',
    children: [
      { id: 'account', label: 'Account', icon: '👤' },
      { id: 'appearance', label: 'Appearance', icon: '🎨' },
      { id: 'privacy', label: 'Privacy', icon: '🔒' },
    ],
  },
]

const VIDEOS = [
  {
    id: 1,
    title: 'Building Modern UIs with Vite and React',
    channel: 'Dev Craft',
    views: '1.2M',
    age: '2 weeks ago',
    duration: '14:32',
    thumb: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  },
  {
    id: 2,
    title: 'CSS Grid Layouts You Should Know in 2026',
    channel: 'Layout Lab',
    views: '842K',
    age: '5 days ago',
    duration: '9:18',
    thumb: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  },
  {
    id: 3,
    title: 'Design Systems from Scratch',
    channel: 'Pixel & Type',
    views: '456K',
    age: '1 month ago',
    duration: '22:05',
    thumb: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  },
  {
    id: 4,
    title: 'Async JavaScript Deep Dive',
    channel: 'Code Trail',
    views: '2.1M',
    age: '3 months ago',
    duration: '31:44',
    thumb: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  },
  {
    id: 5,
    title: 'Productive Terminal Workflows',
    channel: 'Shell Notes',
    views: '318K',
    age: '1 week ago',
    duration: '11:07',
    thumb: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  },
  {
    id: 6,
    title: 'Accessible Components in Practice',
    channel: 'Inclusive UI',
    views: '97K',
    age: '4 days ago',
    duration: '16:51',
    thumb: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  },
  {
    id: 7,
    title: 'State Management Without the Pain',
    channel: 'React Room',
    views: '1.5M',
    age: '2 months ago',
    duration: '19:23',
    thumb: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
  },
  {
    id: 8,
    title: 'Motion Design for Interfaces',
    channel: 'Motion Desk',
    views: '624K',
    age: '6 days ago',
    duration: '12:40',
    thumb: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
  },
]

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0f0f0f',
    color: '#f1f1f1',
    fontFamily:
      'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
  },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 20,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 16px',
    background: 'rgba(15,15,15,0.92)',
    backdropFilter: 'blur(10px)',
    borderBottom: '1px solid #272727',
  },
  menuBtn: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    border: 'none',
    background: 'transparent',
    color: '#f1f1f1',
    cursor: 'pointer',
    fontSize: 20,
    flexShrink: 0,
    display: 'grid',
    placeItems: 'center',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontWeight: 700,
    fontSize: 18,
    letterSpacing: '-0.02em',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  logoMark: {
    width: 28,
    height: 20,
    borderRadius: 6,
    background: 'linear-gradient(135deg, #ff0033, #ff5a36)',
    display: 'grid',
    placeItems: 'center',
    fontSize: 11,
    color: '#fff',
  },
  searchWrap: {
    flex: 1,
    maxWidth: 640,
    margin: '0 auto',
    display: 'flex',
    minWidth: 0,
  },
  search: {
    flex: 1,
    height: 40,
    minWidth: 0,
    borderRadius: '20px 0 0 20px',
    border: '1px solid #303030',
    background: '#121212',
    color: '#f1f1f1',
    padding: '0 16px',
    outline: 'none',
    fontSize: 15,
  },
  searchBtn: {
    height: 40,
    width: 56,
    flexShrink: 0,
    borderRadius: '0 20px 20px 0',
    border: '1px solid #303030',
    borderLeft: 'none',
    background: '#222',
    color: '#f1f1f1',
    cursor: 'pointer',
    fontSize: 16,
  },
  headerActions: {
    display: 'flex',
    gap: 6,
    flexShrink: 0,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    border: 'none',
    background: '#272727',
    color: '#f1f1f1',
    cursor: 'pointer',
    fontSize: 16,
  },
  body: {
    display: 'flex',
    alignItems: 'flex-start',
    minHeight: 'calc(100dvh - 61px)',
    position: 'relative',
  },
  sidebar: {
    position: 'sticky',
    top: 61,
    width: 260,
    flexShrink: 0,
    height: 'calc(100dvh - 61px)',
    overflowY: 'auto',
    padding: '12px 8px 24px',
    borderRight: '1px solid #272727',
    background: '#0f0f0f',
    WebkitOverflowScrolling: 'touch',
  },
  sidebarMobile: {
    position: 'fixed',
    top: 0,
    left: 0,
    bottom: 0,
    width: 'min(280px, 85vw)',
    height: '100dvh',
    zIndex: 40,
    transform: 'translateX(-105%)',
    transition: 'transform 0.22s ease',
    borderRight: '1px solid #272727',
    background: '#0f0f0f',
    overflowY: 'auto',
    padding: '12px 8px 24px',
    WebkitOverflowScrolling: 'touch',
    boxShadow: '8px 0 32px rgba(0,0,0,0.45)',
    pointerEvents: 'none',
    visibility: 'hidden',
  },
  sidebarMobileOpen: {
    transform: 'translateX(0)',
    pointerEvents: 'auto',
    visibility: 'visible',
  },
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    zIndex: 35,
    border: 'none',
    padding: 0,
    cursor: 'pointer',
  },
  treeList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  treeItem: {
    margin: 0,
    padding: 0,
  },
  treeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    border: 'none',
    background: 'transparent',
    color: '#f1f1f1',
    borderRadius: 10,
    paddingTop: 10,
    paddingRight: 10,
    paddingBottom: 10,
    paddingLeft: 10,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
    textAlign: 'left',
    fontFamily: 'inherit',
    minHeight: 44,
  },
  treeRowActive: {
    background: '#272727',
  },
  treeRowHover: {
    background: '#1a1a1a',
  },
  treeToggle: {
    width: 18,
    height: 18,
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    fontSize: 10,
    color: '#aaa',
    transition: 'transform 0.15s ease',
  },
  treeToggleOpen: {
    transform: 'rotate(90deg)',
  },
  treeToggleSpacer: {
    width: 18,
    flexShrink: 0,
  },
  treeIcon: {
    width: 20,
    textAlign: 'center',
    flexShrink: 0,
    fontSize: 14,
  },
  treeLabel: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  treeChildren: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    borderLeft: '1px solid #2a2a2a',
    marginLeft: 18,
  },
  main: {
    flex: 1,
    minWidth: 0,
    padding: '16px',
    maxWidth: 1400,
    width: '100%',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 650,
    margin: '0 0 16px',
    letterSpacing: '-0.02em',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))',
    gap: 16,
  },
  card: {
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    minWidth: 0,
  },
  thumb: {
    position: 'relative',
    aspectRatio: '16 / 9',
    borderRadius: 12,
    overflow: 'hidden',
    background: '#222',
    width: '100%',
  },
  duration: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    background: 'rgba(0,0,0,0.85)',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    padding: '2px 6px',
    borderRadius: 4,
  },
  metaRow: {
    display: 'flex',
    gap: 12,
    minWidth: 0,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    flexShrink: 0,
    background: '#333',
  },
  meta: {
    minWidth: 0,
  },
  title: {
    margin: 0,
    fontSize: 15,
    fontWeight: 600,
    lineHeight: 1.35,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  channel: {
    margin: '4px 0 0',
    fontSize: 13,
    color: '#aaa',
  },
  stats: {
    margin: '2px 0 0',
    fontSize: 13,
    color: '#aaa',
  },
  chips: {
    display: 'flex',
    gap: 8,
    flexWrap: 'nowrap',
    marginBottom: 16,
    overflowX: 'auto',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
    paddingBottom: 4,
    marginLeft: -4,
    marginRight: -4,
    paddingLeft: 4,
    paddingRight: 4,
  },
  chip: {
    border: 'none',
    background: '#272727',
    color: '#f1f1f1',
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: 13,
    cursor: 'pointer',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    flexShrink: 0,
    minHeight: 36,
  },
  chipActive: {
    background: '#f1f1f1',
    color: '#0f0f0f',
  },
}

function TreeNode({
  node,
  depth,
  expanded,
  activeId,
  onToggle,
  onSelect,
}) {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0
  const isOpen = !!expanded[node.id]
  const isActive = activeId === node.id
  const padLeft = 10 + depth * 12

  return (
    <li style={styles.treeItem}>
      <button
        type="button"
        style={{
          ...styles.treeRow,
          paddingLeft: padLeft,
          ...(isActive ? styles.treeRowActive : null),
        }}
        aria-expanded={hasChildren ? isOpen : undefined}
        aria-current={isActive ? 'page' : undefined}
        onClick={() => {
          if (hasChildren) onToggle(node.id)
          onSelect(node.id)
        }}
      >
        {hasChildren ? (
          <span
            style={{
              ...styles.treeToggle,
              ...(isOpen ? styles.treeToggleOpen : null),
            }}
            aria-hidden
          >
            ▸
          </span>
        ) : (
          <span style={styles.treeToggleSpacer} aria-hidden />
        )}
        <span style={styles.treeIcon} aria-hidden>
          {node.icon}
        </span>
        <span style={styles.treeLabel}>{node.label}</span>
      </button>

      {hasChildren && isOpen && (
        <ul style={styles.treeChildren} role="group">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              activeId={activeId}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function SidebarTree({ expanded, activeId, onToggle, onSelect, mobile, open }) {
  const sidebarStyle = mobile
    ? {
        ...styles.sidebarMobile,
        ...(open ? styles.sidebarMobileOpen : null),
      }
    : styles.sidebar

  return (
    <aside style={sidebarStyle} aria-label="Primary" aria-hidden={mobile && !open}>
      <nav aria-label="Browse">
        <ul style={styles.treeList} role="tree">
          {NAV_TREE.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              expanded={expanded}
              activeId={activeId}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      </nav>
    </aside>
  )
}

export default function App() {
  const [query, setQuery] = useState('')
  const [activeChip, setActiveChip] = useState('All')
  const [activeNav, setActiveNav] = useState('home')
  const [navOpen, setNavOpen] = useState(false)
  const isMobile = useMediaQuery('(max-width: 768px)')
  const isCompact = useMediaQuery('(max-width: 520px)')
  const [expanded, setExpanded] = useState({
    explore: true,
    library: true,
    subscriptions: false,
    settings: false,
    playlists: false,
  })

  const chips = ['All', 'React', 'Design', 'CSS', 'JavaScript', 'Accessibility', 'Motion']

  useEffect(() => {
    if (!isMobile) setNavOpen(false)
  }, [isMobile])

  useEffect(() => {
    if (!navOpen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setNavOpen(false)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [navOpen])

  const toggleNode = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const selectNav = (id) => {
    setActiveNav(id)
    if (isMobile) setNavOpen(false)
  }

  const filtered = VIDEOS.filter((v) => {
    const q = query.trim().toLowerCase()
    const matchesQuery =
      !q ||
      v.title.toLowerCase().includes(q) ||
      v.channel.toLowerCase().includes(q)
    const matchesChip =
      activeChip === 'All' ||
      v.title.toLowerCase().includes(activeChip.toLowerCase()) ||
      v.channel.toLowerCase().includes(activeChip.toLowerCase())
    return matchesQuery && matchesChip
  })

  const headerStyle = {
    ...styles.header,
    ...(isCompact ? { padding: '8px 10px', gap: 8 } : null),
  }

  const mainStyle = {
    ...styles.main,
    ...(isMobile ? { padding: '12px' } : { padding: '20px 24px' }),
  }

  const gridStyle = {
    ...styles.grid,
    ...(isCompact
      ? { gridTemplateColumns: '1fr', gap: 18 }
      : isMobile
        ? { gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))', gap: 14 }
        : { gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: 24 }),
  }

  return (
    <div style={styles.page}>
      <header style={headerStyle}>
        {isMobile && (
          <button
            type="button"
            style={styles.menuBtn}
            aria-label={navOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={navOpen}
            aria-controls="primary-nav"
            onClick={() => setNavOpen((o) => !o)}
          >
            {navOpen ? '✕' : '☰'}
          </button>
        )}
        <div style={styles.logo}>
          <span style={styles.logoMark}>▶</span>
          {!isCompact && 'StreamList'}
        </div>
        <div style={styles.searchWrap}>
          <input
            style={styles.search}
            type="search"
            placeholder={isCompact ? 'Search' : 'Search videos'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search videos"
          />
          <button style={styles.searchBtn} type="button" aria-label="Search">
            ⌕
          </button>
        </div>
        <div style={styles.headerActions}>
          {!isCompact && (
            <button style={styles.iconBtn} type="button" aria-label="Create">
              ＋
            </button>
          )}
          {!isCompact && (
            <button style={styles.iconBtn} type="button" aria-label="Notifications">
              🔔
            </button>
          )}
          <button
            style={{ ...styles.iconBtn, background: '#3ea6ff', color: '#0f0f0f' }}
            type="button"
            aria-label="Account"
          >
            U
          </button>
        </div>
      </header>

      <div style={styles.body}>
        {isMobile && navOpen && (
          <button
            type="button"
            style={styles.backdrop}
            aria-label="Close menu"
            onClick={() => setNavOpen(false)}
          />
        )}

        <div id="primary-nav">
          <SidebarTree
            expanded={expanded}
            activeId={activeNav}
            onToggle={toggleNode}
            onSelect={selectNav}
            mobile={isMobile}
            open={navOpen}
          />
        </div>

        <main style={mainStyle}>
          <div style={styles.chips}>
            {chips.map((chip) => (
              <button
                key={chip}
                type="button"
                style={{
                  ...styles.chip,
                  ...(activeChip === chip ? styles.chipActive : null),
                }}
                onClick={() => setActiveChip(chip)}
              >
                {chip}
              </button>
            ))}
          </div>

          <h1 style={styles.sectionTitle}>
            {query || activeChip !== 'All' ? 'Results' : 'Recommended'}
          </h1>

          <div style={gridStyle}>
            {filtered.map((video) => (
              <article key={video.id} style={styles.card} tabIndex={0}>
                <div
                  style={{
                    ...styles.thumb,
                    background: video.thumb,
                  }}
                >
                  <span style={styles.duration}>{video.duration}</span>
                </div>
                <div style={styles.metaRow}>
                  <div
                    style={{
                      ...styles.avatar,
                      background: video.thumb,
                    }}
                  />
                  <div style={styles.meta}>
                    <h2 style={styles.title}>{video.title}</h2>
                    <p style={styles.channel}>{video.channel}</p>
                    <p style={styles.stats}>
                      {video.views} views · {video.age}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {filtered.length === 0 && (
            <p style={{ color: '#aaa', marginTop: 32 }}>No videos match your search.</p>
          )}
        </main>
      </div>
    </div>
  )
}
