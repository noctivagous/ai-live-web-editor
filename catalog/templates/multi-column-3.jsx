import React from 'react'

// Customise these modules (str-replace), keep the structure.
const ITEMS = [
  { icon: '◈', title: 'First module', text: 'What this module does, in one plain sentence.' },
  { icon: '⬡', title: 'Second module', text: 'What this module does, in one plain sentence.' },
  { icon: '⬢', title: 'Third module', text: 'What this module does, in one plain sentence.' },
]

const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, maxWidth: 1020, margin: '0 auto', padding: '40px 24px' }
const card = { border: '1px solid rgba(127,127,127,0.3)', borderRadius: 12, padding: '22px 20px' }
const icon = { fontSize: 22, margin: '0 0 10px' }
const h3 = { fontSize: 17, margin: '0 0 8px' }
const p = { fontSize: 14.5, lineHeight: 1.55, opacity: 0.8, margin: 0 }

export default function MultiColumn() {
  return (
    <section style={grid}>
      {ITEMS.map(item => (
        <article key={item.title} style={card}>
          <p style={icon} aria-hidden="true">{item.icon}</p>
          <h3 style={h3}>{item.title}</h3>
          <p style={p}>{item.text}</p>
        </article>
      ))}
    </section>
  )
}
