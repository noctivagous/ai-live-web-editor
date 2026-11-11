import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { setAgentSettingsPath } from '../agentSettings.js'
import { aleToolByName } from './registry.js'
import { installAleSkills, listAleSkills, type SkillInstallRunner } from './skills.js'

describe('ALE graph + brief tools (slice 6)', () => {
  it('the graph family is registered with the shared vocabulary', () => {
    for (const n of ['ale_graph_read', 'ale_graph_apply', 'ale_graph_reconcile', 'ale_graph_install_pack', 'ale_brief_read']) {
      assert.ok(aleToolByName(n), n)
    }
    assert.match(aleToolByName('ale_graph_reconcile')!.description, /missing \/ present \/ conflicting \/ extra/)
  })

  it('ale_graph_apply refuses the derived design graph honestly', async () => {
    const r = await aleToolByName('ale_graph_apply')!.run({ graph: 'design', changes: [{ op: 'add-node', name: 'X' }] }) as any
    assert.equal(r.ok, false)
    assert.match(r.error, /derived/)
  })

  it('ale_graph_read rejects an unknown graph name', async () => {
    const r = await aleToolByName('ale_graph_read')!.run({ graph: 'nope' }) as any
    assert.equal(r.ok, false)
  })
})

describe('ALE skills delivery (slice 6)', () => {
  it('the bundled skills are listable with hashes and descriptions', () => {
    const skills = listAleSkills()
    const names = skills.map((s) => s.name)
    assert.ok(names.includes('build-a-feature-graph'), names.join(','))
    assert.ok(names.includes('working-in-ale'))
    assert.ok(names.includes('use-a-wizard'))
    for (const s of skills) {
      assert.match(s.hash, /^[0-9a-f]{16}$/)
      assert.ok(s.description.length > 20, `${s.name} carries a frontmatter description`)
    }
  })

  describe('install idempotency', () => {
    let dir: string
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-skills-test-'))
      setAgentSettingsPath(path.join(dir, 'agent-settings.json'))
    })
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

    const okRunner: SkillInstallRunner = async () => ({ stdout: JSON.stringify({ installed: { id: 'x' } }), stderr: '' })

    it('installs once, then reports unchanged (the hash manifest rules)', async () => {
      let calls = 0
      const counting: SkillInstallRunner = async (bin, args) => { calls += 1; assert.ok(args.includes('install')); return okRunner(bin, args) }
      const first = await installAleSkills(counting)
      assert.ok(first.every((r) => r.action === 'installed'))
      assert.equal(calls, first.length)
      const second = await installAleSkills(counting)
      assert.ok(second.every((r) => r.action === 'unchanged'))
      assert.equal(calls, first.length, 'no second install pass for unchanged content')
    })

    it('adopts a skill Muse already has instead of failing', async () => {
      const already: SkillInstallRunner = async () => ({
        stdout: JSON.stringify({ error: { code: 'skill-already-installed', message: 'skill already installed: x' } }),
        stderr: '',
      })
      const records = await installAleSkills(already)
      assert.ok(records.every((r) => r.action === 'adopted'))
    })
  })
})
