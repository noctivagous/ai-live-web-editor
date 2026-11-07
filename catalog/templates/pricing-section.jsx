import React from 'react'

// Customise the heading and the plans (str-replace), keep the structure.
const HEADING = 'Pricing that scales with you'
const SUBHEADING = 'Start free, upgrade when the team grows. Every plan includes the basics.'

const PLANS = [
  { name: 'Starter', price: '$0', period: 'forever', features: ['3 projects', 'Community support', 'Basic analytics'], featured: false, action: 'Start free' },
  { name: 'Team', price: '$12', period: 'per seat / month', features: ['Unlimited projects', 'Shared workspaces', 'Priority support', 'Advanced analytics'], featured: true, action: 'Start trial' },
  { name: 'Enterprise', price: 'Custom', period: 'annual billing', features: ['SSO and audit log', 'Dedicated support', 'Custom retention'], featured: false, action: 'Talk to sales' },
]

const wrap = { maxWidth: 1020, margin: '0 auto', padding: '56px 24px', textAlign: 'center' }
const h2 = { fontSize: 32, margin: '0 0 10px' }
const sub = { fontSize: 16, opacity: 0.75, margin: '0 0 36px' }
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20, textAlign: 'left' }
const card = { border: '1px solid rgba(127,127,127,0.3)', borderRadius: 12, padding: '24px 22px', display: 'flex', flexDirection: 'column', gap: 10 }
const featuredCard = { ...card, border: '2px solid #316ac5' }
const price = { fontSize: 30, fontWeight: 700 }
const list = { listStyle: 'none', padding: 0, margin: '6px 0 16px', display: 'grid', gap: 7, fontSize: 14.5 }
const button = { marginTop: 'auto', padding: '9px 16px', borderRadius: 8, border: '1px solid currentColor', background: 'transparent', fontSize: 14.5, cursor: 'pointer' }

export default function PricingSection() {
  return (
    <section style={wrap}>
      <h2 style={h2}>{HEADING}</h2>
      <p style={sub}>{SUBHEADING}</p>
      <div style={grid}>
        {PLANS.map(plan => (
          <article key={plan.name} style={plan.featured ? featuredCard : card}>
            <strong>{plan.name}</strong>
            <div><span style={price}>{plan.price}</span> <span style={{ opacity: 0.65 }}>{plan.period}</span></div>
            <ul style={list}>
              {plan.features.map(f => <li key={f}>✓ {f}</li>)}
            </ul>
            <button type="button" style={button}>{plan.action}</button>
          </article>
        ))}
      </div>
    </section>
  )
}
