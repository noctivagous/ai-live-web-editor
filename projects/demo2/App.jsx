import { useState } from 'react'

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
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '12px 24px',
    background: 'rgba(15,15,15,0.92)',
    backdropFilter: 'blur(10px)',
    borderBottom: '1px solid #272727',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontWeight: 700,
    fontSize: 20,
    letterSpacing: '-0.02em',
    whiteSpace: 'nowrap',
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
  },
  search: {
    flex: 1,
    height: 40,
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
    width: 64,
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
    gap: 8,
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
  main: {
    padding: '24px',
    maxWidth: 1400,
    margin: '0 auto',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 650,
    margin: '0 0 16px',
    letterSpacing: '-0.02em',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 24,
  },
  card: {
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  thumb: {
    position: 'relative',
    aspectRatio: '16 / 9',
    borderRadius: 12,
    overflow: 'hidden',
    background: '#222',
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
    flexWrap: 'wrap',
    marginBottom: 20,
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
  },
  chipActive: {
    background: '#f1f1f1',
    color: '#0f0f0f',
  },
}

export default function App() {
  const [query, setQuery] = useState('')
  const [activeChip, setActiveChip] = useState('All')

  const chips = ['All', 'React', 'Design', 'CSS', 'JavaScript', 'Accessibility', 'Motion']

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

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.logo}>
          <span style={styles.logoMark}>▶</span>
          StreamList
        </div>
        <div style={styles.searchWrap}>
          <input
            style={styles.search}
            type="search"
            placeholder="Search videos"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search videos"
          />
          <button style={styles.searchBtn} type="button" aria-label="Search">
            ⌕
          </button>
        </div>
        <div style={styles.headerActions}>
          <button style={styles.iconBtn} type="button" aria-label="Create">
            ＋
          </button>
          <button style={styles.iconBtn} type="button" aria-label="Notifications">
            🔔
          </button>
          <button
            style={{ ...styles.iconBtn, background: '#3ea6ff', color: '#0f0f0f' }}
            type="button"
            aria-label="Account"
          >
            U
          </button>
        </div>
      </header>

      <main style={styles.main}>
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

        <div style={styles.grid}>
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
  )
}
