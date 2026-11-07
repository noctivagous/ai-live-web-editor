import React from 'react'

// Customise these constants (str-replace), keep the structure.
const EYEBROW = 'New in this release'
const HEADLINE = 'A clear headline that says what this is'
const COPY = 'One or two sentences of supporting copy: who it is for, and what changes for them when they use it.'
const PRIMARY_ACTION = 'Get started'
const SECONDARY_ACTION = 'See how it works'

const wrap = { maxWidth: 880, margin: '0 auto', padding: '72px 24px 56px', textAlign: 'center' }
const eyebrow = { fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.65, margin: '0 0 14px' }
const h1 = { fontSize: 44, lineHeight: 1.1, margin: '0 0 16px' }
const copy = { fontSize: 17, lineHeight: 1.55, opacity: 0.8, maxWidth: 620, margin: '0 auto 28px' }
const row = { display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }
const primary = { padding: '10px 20px', borderRadius: 8, border: '1px solid transparent', background: '#316ac5', color: '#fff', fontSize: 15, cursor: 'pointer' }
const secondary = { padding: '10px 20px', borderRadius: 8, border: '1px solid currentColor', background: 'transparent', fontSize: 15, cursor: 'pointer' }

export default function Hero() {
  return (
    <section style={wrap}>
      <p style={eyebrow}>{EYEBROW}</p>
      <h1 style={h1}>{HEADLINE}</h1>
      <p style={copy}>{COPY}</p>
      <div style={row}>
        <button type="button" style={primary}>{PRIMARY_ACTION}</button>
        <button type="button" style={secondary}>{SECONDARY_ACTION}</button>
      </div>
    </section>
  )
}
