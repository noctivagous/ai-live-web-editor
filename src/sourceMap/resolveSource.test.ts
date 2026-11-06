import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { enclosingComponent, parseAnchors, resolveSelector, type SourceFile } from './resolveSource.js'

const APP: SourceFile = {
  path: '/App.jsx',
  content: `import { useState } from 'react'
export default function App() {
  const [section, setSection] = useState('Overview')
  return (
    <div>
      <nav>
        <button data-testid="nav-inbox">Inbox</button>
      </nav>
      <main>
        <h1>{section}</h1>
        <p className="stat-value">Open tasks</p>
      </main>
    </div>
  )
}
`,
}

const CARDS: SourceFile = {
  path: '/Card.jsx',
  content: `export function PricingCard({ title, price }) {
  return (
    <article className="card">
      <h2>{title}</h2>
      <span>{price}</span>
    </article>
  )
}
`,
}

describe('parseAnchors', () => {
  it('extracts id from #selector', () => {
    assert.equal(parseAnchors({ selector: '#main' }).id, 'main')
  })

  it('extracts id from stableId', () => {
    assert.equal(parseAnchors({ selector: 'div>span', stableId: 'id:root' }).id, 'root')
  })

  it('extracts data-testid', () => {
    const a = parseAnchors({ selector: '[data-testid="nav-inbox"]' })
    assert.deepEqual(a.testIds, [{ key: 'data-testid', value: 'nav-inbox' }])
  })

  it('collects text words of length >= 3', () => {
    assert.deepEqual(parseAnchors({ selector: 'p', textSnippet: 'Open tasks 18' }).textWords, ['Open', 'tasks'])
  })
})

describe('enclosingComponent', () => {
  it('finds the capitalised owner and destructured props', () => {
    const comp = enclosingComponent(CARDS.content, 4)
    assert.equal(comp?.name, 'PricingCard')
    assert.equal(comp?.defLine, 1)
    assert.deepEqual(comp?.props, ['title', 'price'])
  })

  it('finds default-exported App', () => {
    const comp = enclosingComponent(APP.content, 12)
    assert.equal(comp?.name, 'App')
  })
})

describe('resolveSelector', () => {
  it('resolves a testid selector to the exact file', () => {
    const r = resolveSelector({ selector: '[data-testid="nav-inbox"]' }, [APP, CARDS])
    assert.equal(r.ok, true)
    assert.equal(r.file, '/App.jsx')
    assert.equal(r.component, 'App')
    assert.equal(r.confidence, 'heuristic')
  })

  it('resolves via text snippet words', () => {
    const r = resolveSelector({ selector: 'main>section>article', textSnippet: 'Open tasks' }, [APP, CARDS])
    assert.equal(r.ok, true)
    assert.equal(r.file, '/App.jsx')
  })

  it('resolves via class token', () => {
    const r = resolveSelector({ selector: 'article', classList: ['card'] }, [APP, CARDS])
    assert.equal(r.ok, true)
    assert.equal(r.file, '/Card.jsx')
    assert.equal(r.component, 'PricingCard')
    assert.deepEqual(r.props, ['title', 'price'])
  })

  it('fails closed when nothing matches', () => {
    const r = resolveSelector({ selector: '#nope', textSnippet: 'zzzqqq' }, [APP, CARDS])
    assert.equal(r.ok, false)
    assert.equal(r.confidence, 'unresolved')
  })

  it('reports ambiguous on equal strong scores', () => {
    const dup: SourceFile = { path: '/Dup.jsx', content: APP.content }
    const r = resolveSelector({ selector: '[data-testid="nav-inbox"]' }, [APP, dup])
    assert.equal(r.ok, false)
    assert.equal(r.confidence, 'ambiguous')
    assert.ok((r.candidates || []).length >= 2)
  })

  it('requires a selector', () => {
    assert.equal(resolveSelector({ selector: '' }, [APP]).ok, false)
  })

  it('honours an exact sourceLoc stamp', () => {
    const r = resolveSelector({ selector: 'h2', sourceLoc: { file: '/Card.jsx', line: 4 } }, [APP, CARDS])
    assert.equal(r.ok, true)
    assert.equal(r.confidence, 'exact')
    assert.equal(r.file, '/Card.jsx')
    assert.equal(r.component, 'PricingCard')
  })

  it('structural fallback resolves bare tag chains to the single rendering file', () => {
    const r = resolveSelector({ selector: 'div:nth-of-type(1) > main:nth-of-type(1)' }, [APP, CARDS])
    assert.equal(r.ok, true)
    assert.equal(r.file, '/App.jsx')
  })
})
