import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deriveTechStack, installedFromLockfile } from './techStack.js'

function tmpProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-stack-'))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'demo',
    dependencies: { react: '^18.2.0', 'left-pad': '1.3.0' },
    devDependencies: { vite: '^5.0.0' },
    engines: { node: '>=18' },
  }))
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { name: 'demo' },
      'node_modules/react': { version: '18.3.1' },
      'node_modules/vite': { version: '4.5.0' },
      'node_modules/stray': { version: '1.0.0' },
    },
  }))
  fs.writeFileSync(path.join(root, 'src/main.tsx'), "import React from 'react'\nexport const x = React\n")
  fs.writeFileSync(path.join(root, 'src/util.ts'), 'export const y = 1\n')
  fs.writeFileSync(path.join(root, 'vite.config.ts'), 'export default {}\n')
  return root
}

describe('tech stack derivation (§6)', () => {
  it('reads languages, packages with declared vs installed, and facts', () => {
    const stack = deriveTechStack(tmpProject())
    assert.ok(stack.languages.some(l => l.name === 'TypeScript'))
    const react = stack.packages.find(p => p.name === 'react')
    assert.equal(react?.declared, '^18.2.0')
    assert.equal(react?.installed, '18.3.1')
    assert.ok(react?.usedBy.includes('src/main.tsx'))
    assert.ok(stack.facts.some(f => /React/.test(f)))
    assert.ok(stack.facts.some(f => /Node >=18/.test(f)))
    assert.ok(stack.filesOfNote.some(f => f.path === 'package.json'))
  })

  it('the report separates not-installed, not-declared, mismatches, and candidate-unused', () => {
    const stack = deriveTechStack(tmpProject())
    assert.ok(stack.report.declaredNotInstalled.includes('left-pad'))
    assert.ok(stack.report.installedNotDeclared.includes('stray'))
    // vite: declared ^5.0.0, installed 4.5.0 — a real mismatch.
    assert.ok(stack.report.versionMismatches.some(m => m.name === 'vite'))
    // react ^18.2.0 with 18.3.1 installed is NOT a mismatch.
    assert.ok(!stack.report.versionMismatches.some(m => m.name === 'react'))
    assert.ok(stack.report.candidateUnused.includes('left-pad'))
    assert.ok(!stack.report.candidateUnused.includes('react'))
  })

  it('installedFromLockfile reads the v1 dependencies shape too', () => {
    const map = installedFromLockfile({ dependencies: { foo: { version: '2.0.0' } } })
    assert.equal(map.get('foo'), '2.0.0')
  })

  it('an empty project derives an empty stack, not an error', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-stack-empty-'))
    const stack = deriveTechStack(root)
    assert.deepEqual(stack.packages, [])
    assert.deepEqual(stack.languages, [])
  })
})
