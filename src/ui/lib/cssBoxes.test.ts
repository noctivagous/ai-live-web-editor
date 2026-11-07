import assert from 'node:assert/strict'
import test from 'node:test'
import { controlFor, parseStylesheet, replaceDeclValue } from './cssBoxes'

const SHEET = `/* theme */
.card {
  color: #1c1c1e;
  border: 1px solid #999;
  border-style: dashed;
  padding: 12px;
  background: url("data:image/png;base64,AAAA;BBBB") no-repeat;
}
@media (max-width: 600px) {
  .card { padding: 4px; }
}
h1, h2 { margin-top: 0; font-weight: 700 }
`

test('parse: rules and declarations found, offsets point at the exact values', () => {
  const { rules, atBlocks } = parseStylesheet(SHEET)
  assert.equal(atBlocks, 1)
  assert.deepEqual(rules.map((r) => r.selector), ['.card', 'h1, h2'])
  const card = rules[0]
  assert.deepEqual(card.declarations.map((d) => d.property), ['color', 'border', 'border-style', 'padding', 'background'])
  for (const d of card.declarations) {
    assert.equal(SHEET.slice(d.valueStart, d.valueEnd), d.value, `offsets for ${d.property}`)
  }
  assert.equal(card.declarations[0].value, '#1c1c1e')
  // The @media block's inner declarations are not top-level rules.
  assert.ok(!rules.some((r) => r.declarations.some((d) => d.value === '4px')))
})

test('replace: only the value bytes change — comments, @media and other rules untouched', () => {
  const { rules } = parseStylesheet(SHEET)
  const padding = rules[0].declarations.find((d) => d.property === 'padding')!
  const next = replaceDeclValue(SHEET, padding, '20px')
  assert.ok(next.includes('padding: 20px;'))
  assert.ok(next.includes('/* theme */'))
  assert.ok(next.includes('@media (max-width: 600px) {\n  .card { padding: 4px; }\n}'))
  assert.equal(next.length, SHEET.length) // 12px -> 20px, same length here
  assert.equal(next.replace('padding: 20px;', 'padding: 12px;'), SHEET)
})

test('parse: !important stays outside the editable value', () => {
  const src = 'a { color: red !important; top: 0 }'
  const { rules } = parseStylesheet(src)
  const color = rules[0].declarations[0]
  assert.equal(color.value, 'red')
  assert.equal(replaceDeclValue(src, color, 'blue'), 'a { color: blue !important; top: 0 }')
})

test('parse: garbage segments inside a block are skipped, not boxed', () => {
  const src = 'a { nonsense; width: 10px }'
  const { rules } = parseStylesheet(src)
  assert.deepEqual(rules[0].declarations.map((d) => d.property), ['width'])
})

test('controlFor: colors — hex, named, rgb get a picker; alpha and var() stay text', () => {
  assert.deepEqual(controlFor({ property: 'color', value: '#abc' }), { kind: 'color', hex: '#aabbcc' })
  assert.equal(controlFor({ property: 'background-color', value: 'teal' }).kind, 'color')
  assert.equal(controlFor({ property: 'color', value: 'rgb(10, 20, 30)' }).kind, 'color')
  assert.equal(controlFor({ property: 'color', value: 'rgba(10, 20, 30, 0.5)' }).kind, 'text')
  assert.equal(controlFor({ property: 'color', value: 'var(--ink)' }).kind, 'text')
})

test('controlFor: single lengths get sliders in range; multi-token values stay text', () => {
  const px = controlFor({ property: 'padding', value: '12px' })
  assert.equal(px.kind, 'length')
  if (px.kind === 'length') { assert.equal(px.unit, 'px'); assert.equal(px.amount, 12); assert.equal(px.min, 0) }
  const neg = controlFor({ property: 'margin-left', value: '-4px' })
  if (neg.kind === 'length') assert.ok(neg.min < 0)
  else assert.fail('margin length should classify as length')
  assert.equal(controlFor({ property: 'padding', value: '12px 20px' }).kind, 'text')
  assert.equal(controlFor({ property: 'width', value: '50%' }).kind, 'length')
  assert.equal(controlFor({ property: 'border', value: '1px solid #999' }).kind, 'text')
})

test('controlFor: keyword sets by property, current value always offered', () => {
  const d = controlFor({ property: 'border-style', value: 'dashed' })
  assert.equal(d.kind, 'keyword')
  if (d.kind === 'keyword') assert.ok(d.options.includes('solid') && d.options.includes('dashed'))
  assert.equal(controlFor({ property: 'display', value: 'banana' }).kind, 'keyword') // unknown value leads the list
  assert.equal(controlFor({ property: 'font-weight', value: '700' }).kind, 'keyword')
  assert.equal(controlFor({ property: 'font-family', value: 'Georgia' }).kind, 'text')
})
