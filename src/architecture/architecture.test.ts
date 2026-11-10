import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  checkArchitecture, getArchitecture, saveArchitecture, saveArchitectureGuide, sanitizeArchitecture,
} from './architecture.js'
import { archPackRefactorPlan, followArchPack, loadArchPacks, previewArchPack } from './archPacks.js'
import { getPlan } from '../plans/plans.js'

function tmpProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-arch-'))
  fs.mkdirSync(path.join(root, 'src/domain'), { recursive: true })
  fs.mkdirSync(path.join(root, 'src/ui'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/domain/logic.ts'), 'export const x = 1\n')
  fs.writeFileSync(path.join(root, 'src/ui/App.tsx'), 'export const App = () => null\n')
  return root
}

const DECL = {
  version: 1,
  name: 'Test layers',
  layers: ['UI', 'Domain'],
  modules: [
    { name: 'UI', path: 'src/ui', responsibility: 'Screens.' },
    { name: 'Domain', path: 'src/domain', responsibility: 'Pure logic.' },
    { name: 'State', path: 'src/state', responsibility: 'Stores.' },
  ],
  allowedDependencies: [{ from: 'UI', to: 'Domain' }],
  rules: [
    { id: 'domain-no-ui', say: 'Domain imports nothing from UI', kind: 'no-import', from: 'Domain', to: 'UI' },
  ],
}

describe('architecture declaration', () => {
  it('sanitizes and round-trips through the store', () => {
    const root = tmpProject()
    const saved = saveArchitecture({ ...DECL, junk: 'drop me' }, root)
    assert.ok(saved)
    assert.equal((saved as unknown as Record<string, unknown>).junk, undefined)
    assert.equal(getArchitecture(root)?.name, 'Test layers')
    assert.equal(sanitizeArchitecture('nope'), null)
  })

  it('an undesignated project is never flagged', () => {
    const root = tmpProject()
    const report = checkArchitecture(root)
    assert.equal(report.designated, false)
    assert.deepEqual(report.drift, { declaredNotFound: [], foundNotDeclared: [] })
  })

  it('checkable rules pass and fail with evidence; drift names missing modules', () => {
    const root = tmpProject()
    saveArchitecture(DECL, root)
    let report = checkArchitecture(root)
    assert.equal(report.rules[0].verdict, 'pass')
    assert.ok(report.drift.declaredNotFound.includes('State'))
    fs.writeFileSync(path.join(root, 'src/domain/logic.ts'), "import { App } from '../ui/App.tsx'\nexport const x = App\n")
    report = checkArchitecture(root)
    assert.equal(report.rules[0].verdict, 'fail')
    assert.match(report.rules[0].evidence, /logic\.ts/)
  })

  it('the guide prose round-trips', () => {
    const root = tmpProject()
    saveArchitectureGuide('# Philosophy\nBe plain.', root)
    assert.match(fs.readFileSync(path.join(root, 'ai-architecture/guide.md'), 'utf-8'), /Be plain/)
  })
})

describe('architecture plan packs', () => {
  it('the stock catalog carries a valid pack', () => {
    const packs = loadArchPacks()
    assert.ok(packs.length >= 1)
    assert.equal(packs[0].kind, 'architecture')
    assert.ok(packs[0].refactorOutline.length >= 3)
  })

  it('preview reconciles, follow writes the declaration, apply forms a refactor plan', () => {
    const root = tmpProject()
    const pack = loadArchPacks()[0]
    const preview = previewArchPack(pack, root)
    assert.ok(preview.some(i => i.state === 'missing'))
    const saved = followArchPack(pack, root)
    assert.equal(saved?.provenance, pack.id)
    const plan = archPackRefactorPlan(pack, root)
    assert.equal(plan.kind, 'refactor')
    assert.ok(plan.tasks.length >= pack.refactorOutline.length)
    assert.equal(getPlan(plan.slug, root)?.slug, plan.slug)
  })
})
