const styles = {
  page: {
    minHeight: '100vh',
    background:
      'radial-gradient(1200px 600px at 80% -10%, rgba(88, 101, 242, 0.22), transparent 60%), radial-gradient(900px 500px at -10% 20%, rgba(14, 165, 233, 0.16), transparent 55%), #07090f',
    color: '#e8ecf4',
  },
  container: {
    width: 'min(1120px, calc(100% - 48px))',
    margin: '0 auto',
  },
  nav: {
    position: 'sticky',
    top: 0,
    zIndex: 50,
    backdropFilter: 'blur(14px)',
    background: 'rgba(7, 9, 15, 0.72)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  navInner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 72,
    gap: 24,
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontWeight: 800,
    letterSpacing: '-0.03em',
    fontSize: 20,
  },
  logoMark: {
    width: 28,
    height: 28,
    borderRadius: 8,
    background: 'linear-gradient(135deg, #5865f2, #0ea5e9)',
    boxShadow: '0 0 24px rgba(88,101,242,0.45)',
  },
  navLinks: {
    display: 'flex',
    alignItems: 'center',
    gap: 28,
    fontSize: 14,
    color: 'rgba(232,236,244,0.72)',
    fontWeight: 500,
  },
  navCta: {
    padding: '10px 16px',
    borderRadius: 999,
    background: 'linear-gradient(135deg, #5865f2, #0ea5e9)',
    color: '#fff',
    fontWeight: 600,
    fontSize: 14,
    boxShadow: '0 8px 24px rgba(88,101,242,0.35)',
  },
  hero: {
    padding: '96px 0 72px',
    display: 'grid',
    gridTemplateColumns: '1.15fr 0.85fr',
    gap: 48,
    alignItems: 'center',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(232,236,244,0.8)',
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 22,
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#22c55e',
    boxShadow: '0 0 10px rgba(34,197,94,0.8)',
  },
  h1: {
    fontSize: 'clamp(2.4rem, 5vw, 3.75rem)',
    lineHeight: 1.05,
    letterSpacing: '-0.04em',
    fontWeight: 800,
    marginBottom: 18,
  },
  gradientText: {
    background: 'linear-gradient(90deg, #8b9bff, #38bdf8, #a78bfa)',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
  },
  lead: {
    fontSize: 18,
    color: 'rgba(232,236,244,0.7)',
    maxWidth: 520,
    marginBottom: 28,
  },
  ctaRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 36,
  },
  primaryBtn: {
    padding: '14px 22px',
    borderRadius: 12,
    background: 'linear-gradient(135deg, #5865f2, #0ea5e9)',
    color: '#fff',
    fontWeight: 700,
    fontSize: 15,
    boxShadow: '0 12px 32px rgba(88,101,242,0.35)',
  },
  secondaryBtn: {
    padding: '14px 22px',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.04)',
    color: '#e8ecf4',
    fontWeight: 600,
    fontSize: 15,
  },
  trust: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 18,
    alignItems: 'center',
    color: 'rgba(232,236,244,0.45)',
    fontSize: 13,
    fontWeight: 500,
  },
  trustItem: {
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.06)',
    background: 'rgba(255,255,255,0.03)',
  },
  heroCard: {
    position: 'relative',
    borderRadius: 24,
    padding: 4,
    background: 'linear-gradient(145deg, rgba(88,101,242,0.55), rgba(14,165,233,0.25), rgba(255,255,255,0.05))',
    boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
  },
  heroCardInner: {
    borderRadius: 20,
    background: 'linear-gradient(180deg, #0e1320 0%, #0a0d16 100%)',
    border: '1px solid rgba(255,255,255,0.06)',
    padding: 22,
    overflow: 'hidden',
  },
  windowBar: {
    display: 'flex',
    gap: 6,
    marginBottom: 18,
  },
  windowDot: (c) => ({
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: c,
    opacity: 0.85,
  }),
  codeBlock: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.7,
    color: 'rgba(232,236,244,0.85)',
    whiteSpace: 'pre-wrap',
  },
  metricGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12,
    marginTop: 18,
  },
  metric: {
    padding: 14,
    borderRadius: 14,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
  },
  metricValue: {
    fontSize: 22,
    fontWeight: 800,
    letterSpacing: '-0.03em',
    marginBottom: 2,
  },
  metricLabel: {
    fontSize: 12,
    color: 'rgba(232,236,244,0.5)',
  },
  section: {
    padding: '72px 0',
  },
  sectionHead: {
    maxWidth: 640,
    marginBottom: 40,
  },
  sectionEyebrow: {
    color: '#7dd3fc',
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  h2: {
    fontSize: 'clamp(1.75rem, 3vw, 2.4rem)',
    letterSpacing: '-0.03em',
    fontWeight: 800,
    lineHeight: 1.15,
    marginBottom: 12,
  },
  sectionLead: {
    color: 'rgba(232,236,244,0.65)',
    fontSize: 16,
  },
  featureGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 18,
  },
  featureCard: {
    padding: 24,
    borderRadius: 18,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    transition: 'transform 160ms ease, border-color 160ms ease, background 160ms ease',
  },
  featureIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    display: 'grid',
    placeItems: 'center',
    marginBottom: 16,
    background: 'linear-gradient(135deg, rgba(88,101,242,0.25), rgba(14,165,233,0.18))',
    border: '1px solid rgba(255,255,255,0.08)',
    fontSize: 18,
  },
  featureTitle: {
    fontSize: 17,
    fontWeight: 700,
    marginBottom: 8,
    letterSpacing: '-0.02em',
  },
  featureBody: {
    fontSize: 14,
    color: 'rgba(232,236,244,0.62)',
    lineHeight: 1.6,
  },
  statsBar: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 16,
    padding: 28,
    borderRadius: 20,
    background:
      'linear-gradient(120deg, rgba(88,101,242,0.14), rgba(14,165,233,0.08) 45%, rgba(167,139,250,0.1))',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  stat: {
    textAlign: 'center',
  },
  statValue: {
    fontSize: 28,
    fontWeight: 800,
    letterSpacing: '-0.03em',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 13,
    color: 'rgba(232,236,244,0.55)',
  },
  productRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 18,
  },
  productCard: {
    padding: 28,
    borderRadius: 20,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    minHeight: 220,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  productTag: {
    display: 'inline-flex',
    alignSelf: 'flex-start',
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    color: '#a5b4fc',
    background: 'rgba(88,101,242,0.15)',
    border: '1px solid rgba(88,101,242,0.25)',
    marginBottom: 14,
  },
  productTitle: {
    fontSize: 22,
    fontWeight: 800,
    letterSpacing: '-0.03em',
    marginBottom: 10,
  },
  productBody: {
    color: 'rgba(232,236,244,0.62)',
    fontSize: 15,
    marginBottom: 18,
  },
  link: {
    color: '#7dd3fc',
    fontWeight: 600,
    fontSize: 14,
  },
  ctaBand: {
    margin: '24px 0 0',
    padding: '48px 40px',
    borderRadius: 24,
    background:
      'radial-gradient(700px 220px at 20% 0%, rgba(88,101,242,0.35), transparent 60%), linear-gradient(135deg, #10182b, #0b1020)',
    border: '1px solid rgba(255,255,255,0.08)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 24,
    flexWrap: 'wrap',
  },
  ctaTitle: {
    fontSize: 28,
    fontWeight: 800,
    letterSpacing: '-0.03em',
    marginBottom: 8,
  },
  ctaLead: {
    color: 'rgba(232,236,244,0.65)',
    maxWidth: 460,
  },
  footer: {
    borderTop: '1px solid rgba(255,255,255,0.06)',
    padding: '36px 0 48px',
    marginTop: 48,
    color: 'rgba(232,236,244,0.5)',
    fontSize: 14,
  },
  footerInner: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 24,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  footerLinks: {
    display: 'flex',
    gap: 20,
    flexWrap: 'wrap',
  },
}

const features = [
  {
    icon: '⚡',
    title: 'Edge-native runtime',
    body: 'Deploy globally in seconds. Sub-50ms responses with automatic regional failover and zero-config scaling.',
  },
  {
    icon: '🧠',
    title: 'AI infrastructure',
    body: 'Ship production model pipelines with built-in observability, evals, and secure multi-tenant isolation.',
  },
  {
    icon: '🔒',
    title: 'Enterprise security',
    body: 'SOC 2 Type II, SSO/SAML, audit trails, and fine-grained access controls from day one.',
  },
  {
    icon: '📊',
    title: 'Realtime insights',
    body: 'Live metrics, traces, and anomaly detection so your team catches issues before customers do.',
  },
  {
    icon: '🧩',
    title: 'Composable APIs',
    body: 'Clean REST and GraphQL surfaces, SDKs for every major language, and webhooks that just work.',
  },
  {
    icon: '🚀',
    title: 'Ship faster',
    body: 'CI-ready templates, preview environments, and one-click rollbacks keep velocity high without the risk.',
  },
]

const products = [
  {
    tag: 'Platform',
    title: 'Nexus Cloud',
    body: 'The control plane for modern apps — compute, storage, queues, and edge delivery in one place.',
  },
  {
    tag: 'AI',
    title: 'Nexus Models',
    body: 'Host, fine-tune, and route LLMs with cost controls, latency SLAs, and private networking.',
  },
]

export default function App() {
  return (
    <div style={styles.page}>
      <header style={styles.nav}>
        <div style={{ ...styles.container, ...styles.navInner }}>
          <a href="#top" style={styles.logo}>
            <span style={styles.logoMark} aria-hidden="true" />
            Nexus
          </a>
          <nav style={styles.navLinks} aria-label="Primary">
            <a href="#product">Product</a>
            <a href="#platform">Platform</a>
            <a href="#solutions">Solutions</a>
            <a href="#docs">Docs</a>
          </nav>
          <a href="#get-started" style={styles.navCta}>
            Start free
          </a>
        </div>
      </header>

      <main id="top">
        <section style={{ ...styles.container, ...styles.hero }}>
          <div>
            <div style={styles.badge}>
              <span style={styles.badgeDot} />
              Now generally available — Nexus 3.0
            </div>
            <h1 style={styles.h1}>
              Infrastructure for teams that
              <span style={styles.gradientText}> ship the future</span>
            </h1>
            <p style={styles.lead}>
              Nexus is the developer platform for AI systems, realtime apps, and global scale —
              so you can build products, not plumbing.
            </p>
            <div style={styles.ctaRow}>
              <a href="#get-started" style={styles.primaryBtn}>
                Get started free
              </a>
              <a href="#product" style={styles.secondaryBtn}>
                View platform →
              </a>
            </div>
            <div style={styles.trust}>
              <span>Trusted by teams at</span>
              <span style={styles.trustItem}>Orbit</span>
              <span style={styles.trustItem}>Helix</span>
              <span style={styles.trustItem}>Northwind</span>
              <span style={styles.trustItem}>Pulse</span>
            </div>
          </div>

          <div style={styles.heroCard} aria-hidden="true">
            <div style={styles.heroCardInner}>
              <div style={styles.windowBar}>
                <span style={styles.windowDot('#ff5f56')} />
                <span style={styles.windowDot('#ffbd2e')} />
                <span style={styles.windowDot('#27c93f')} />
              </div>
              <pre style={styles.codeBlock}>{`$ nexus deploy --region global
✓ Building edge bundle
✓ Provisioning AI runtime
✓ Live in 42 regions

latency p99 …… 38ms
uptime ……… 99.99%
cost ↓ ……… 31%`}</pre>
              <div style={styles.metricGrid}>
                <div style={styles.metric}>
                  <div style={styles.metricValue}>12M+</div>
                  <div style={styles.metricLabel}>API calls / day</div>
                </div>
                <div style={styles.metric}>
                  <div style={styles.metricValue}>42</div>
                  <div style={styles.metricLabel}>Edge regions</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="platform" style={{ ...styles.container, ...styles.section }}>
          <div style={styles.statsBar}>
            <div style={styles.stat}>
              <div style={styles.statValue}>99.99%</div>
              <div style={styles.statLabel}>Uptime SLA</div>
            </div>
            <div style={styles.stat}>
              <div style={styles.statValue}>&lt;50ms</div>
              <div style={styles.statLabel}>Global p99 latency</div>
            </div>
            <div style={styles.stat}>
              <div style={styles.statValue}>3,200+</div>
              <div style={styles.statLabel}>Engineering teams</div>
            </div>
            <div style={styles.stat}>
              <div style={styles.statValue}>$0</div>
              <div style={styles.statLabel}>To start building</div>
            </div>
          </div>
        </section>

        <section id="product" style={{ ...styles.container, ...styles.section, paddingTop: 24 }}>
          <div style={styles.sectionHead}>
            <div style={styles.sectionEyebrow}>Platform</div>
            <h2 style={styles.h2}>Everything you need to run modern software</h2>
            <p style={styles.sectionLead}>
              From edge compute to AI runtimes, Nexus replaces a patchwork of vendors with one
              coherent platform your team will actually love.
            </p>
          </div>
          <div style={styles.featureGrid}>
            {features.map((f) => (
              <article key={f.title} style={styles.featureCard}>
                <div style={styles.featureIcon}>{f.icon}</div>
                <h3 style={styles.featureTitle}>{f.title}</h3>
                <p style={styles.featureBody}>{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="solutions" style={{ ...styles.container, ...styles.section }}>
          <div style={styles.sectionHead}>
            <div style={styles.sectionEyebrow}>Products</div>
            <h2 style={styles.h2}>Built for the next decade of software</h2>
            <p style={styles.sectionLead}>
              Start with one product or the full stack. Scale without re-architecting.
            </p>
          </div>
          <div style={styles.productRow}>
            {products.map((p) => (
              <article key={p.title} style={styles.productCard}>
                <div>
                  <span style={styles.productTag}>{p.tag}</span>
                  <h3 style={styles.productTitle}>{p.title}</h3>
                  <p style={styles.productBody}>{p.body}</p>
                </div>
                <a href="#docs" style={styles.link}>
                  Explore docs →
                </a>
              </article>
            ))}
          </div>
        </section>

        <section id="get-started" style={styles.container}>
          <div style={styles.ctaBand}>
            <div>
              <h2 style={styles.ctaTitle}>Start building in minutes</h2>
              <p style={styles.ctaLead}>
                Free tier included. No credit card. Deploy your first service and see live metrics
                before lunch.
              </p>
            </div>
            <div style={styles.ctaRow}>
              <a href="#docs" style={styles.primaryBtn}>
                Create account
              </a>
              <a href="#docs" style={styles.secondaryBtn}>
                Talk to sales
              </a>
            </div>
          </div>
        </section>

        <footer id="docs" style={styles.footer}>
          <div style={{ ...styles.container, ...styles.footerInner }}>
            <div style={styles.logo}>
              <span style={{ ...styles.logoMark, width: 22, height: 22, borderRadius: 6 }} />
              Nexus
            </div>
            <div style={styles.footerLinks}>
              <a href="#product">Product</a>
              <a href="#platform">Status</a>
              <a href="#solutions">Careers</a>
              <a href="#docs">Docs</a>
              <a href="#get-started">Contact</a>
            </div>
            <div>© {new Date().getFullYear()} Nexus Labs, Inc.</div>
          </div>
        </footer>
      </main>
    </div>
  )
}
