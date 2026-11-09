import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  activeSkills, estimateTokens, getSkill, loadSkills, matchSkills, parseSkillFile,
  projectDependencies, skillIndexLine, skillIndexText, skillIndexTokens,
  skillInjectionDetail, skillInjectionText,
  SKILL_BODY_TOKEN_BUDGET, SKILL_INDEX_TOKEN_BUDGET,
} from './skills.js'

describe('SKILL.md parsing', () => {
  it('parses frontmatter + body and computes the token estimate', () => {
    const skill = parseSkillFile(`---\nname: demo\ndescription: Teaches demo work.\ntriggers: demo, two words\ndependsOn: paper\n---\n\n# Demo\n\nBody text.`, 'demo')
    assert.ok(skill)
    assert.equal(skill!.name, 'demo')
    assert.deepEqual(skill!.triggers, ['demo', 'two words'])
    assert.deepEqual(skill!.dependsOn, ['paper'])
    assert.equal(skill!.bodyTokens, estimateTokens(skill!.body))
    assert.equal(skill!.overBudget, false)
  })

  it('rejects files without frontmatter or without name/description', () => {
    assert.equal(parseSkillFile('# Just a body', 'x'), null)
    assert.equal(parseSkillFile('---\nname: only-name\n---\nbody', 'x'), null)
    assert.equal(parseSkillFile('---\ndescription: only desc\n---\nbody', 'x'), null)
  })
})

describe('the shipped skills (§4)', () => {
  const skills = loadSkills()

  it('loads making-layouts plus the three knowledge packs', () => {
    assert.deepEqual(skills.map(s => s.name), ['making-layouts', 'noct-grids', 'paper-js', 'state-machines'])
  })

  it('every body honours the <5k-token contract and cites names, not file bodies', () => {
    for (const s of skills) {
      assert.ok(s.bodyTokens < SKILL_BODY_TOKEN_BUDGET, `${s.name} body is ${s.bodyTokens} tokens`)
      assert.ok(s.description.length > 20, `${s.name} has a real description`)
    }
    const layouts = getSkill('making-layouts', skills)!
    assert.ok(layouts.body.includes('place-template'))
    assert.ok(layouts.body.includes('pricing-section'))
    assert.ok(layouts.body.includes('find-component'))
  })

  it('the always-visible index stays near ~100 tokens per skill', () => {
    const index = skillIndexText(skills)
    assert.ok(index.includes('read-skill'))
    for (const s of skills) {
      const line = index.split('\n').find(l => l.startsWith(`- ${s.name}:`))!
      assert.ok(line, `${s.name} is indexed`)
      assert.ok(estimateTokens(line) <= 130, `${s.name} index line is ~${estimateTokens(line)} tokens`)
    }
  })
})

describe('trigger matching: a plain copy fix pays nothing', () => {
  const skills = loadSkills()

  it('matches nothing for an unrelated ask in a plain project', () => {
    // The spec's own example: a plain copy fix must not pay body
    // tokens — not even in a web-app, so making-layouts is
    // trigger-only (no types) and only the grids pack keys off type.
    const matches = matchSkills({ text: 'fix the typo in the about copy, it says teh', projectType: 'web-app', deps: ['react', 'react-dom'] }, skills)
    assert.deepEqual(matches, [])
    assert.equal(skillInjectionText({ text: 'fix the typo in the about copy', projectType: 'web-app', deps: ['react'] }, skills), null)
  })

  it('an explicit ask trigger outranks everything', () => {
    const matches = matchSkills({ text: 'add a pricing section to the landing page', deps: [] }, skills)
    assert.equal(matches[0].skill.name, 'making-layouts')
    assert.equal(matches[0].via, 'trigger')
    const injected = skillInjectionText({ text: 'add a pricing section to the landing page', deps: [] }, skills)!
    assert.ok(injected.includes('Skill loaded: making-layouts (via trigger)'))
    assert.ok(injected.includes('pricing-section'))
  })

  it('dependency evidence loads a pack without any keyword', () => {
    const matches = matchSkills({ text: 'draw the export artwork', deps: ['paper', 'react'] }, skills)
    assert.deepEqual(matches.map(m => [m.skill.name, m.via]), [['paper-js', 'dependency']])
    const x = matchSkills({ text: 'the panel gets stuck sometimes', deps: ['xstate'] }, skills)
    assert.equal(x[0].skill.name, 'state-machines')
  })

  it('project type loads the grids pack for canvas tools', () => {
    const matches = matchSkills({ text: 'add a clear button', projectType: 'canvas-tool', deps: [] }, skills)
    assert.deepEqual(matches.map(m => m.skill.name), ['noct-grids'])
  })

  it('the injection budget keeps whole bodies only', () => {
    const tiny = skillInjectionText({ text: 'layout with paper.js and a state machine', deps: ['paper', 'xstate'] }, loadSkills(), 50)
    assert.equal(tiny, null, 'nothing fits a 50-token budget, so nothing partial is injected')
    const full = skillInjectionText({ text: 'layout with paper.js and a state machine', deps: ['paper', 'xstate'] }, loadSkills(), 5000)!
    assert.ok(full.includes('paper-js') && full.includes('state-machines'))
  })

  it('reads real project dependencies as evidence', () => {
    const deps = projectDependencies(process.cwd())
    assert.ok(deps.includes('react') || deps.includes('@mastra/core'), `editor deps seen: ${deps.slice(0, 5).join(', ')}`)
  })
})

describe('categories and the panel numbers (skills UI slice 1)', () => {
  it('parses category, defaulting to General', () => {
    const withCat = parseSkillFile(`---\nname: demo\ndescription: Teaches demo work.\ncategory: Design & layout\n---\n\nBody.`, 'demo')
    assert.equal(withCat!.category, 'Design & layout')
    const without = parseSkillFile(`---\nname: demo\ndescription: Teaches demo work.\n---\n\nBody.`, 'demo')
    assert.equal(without!.category, 'General')
  })

  it('every shipped skill carries a real category', () => {
    const byName = new Map(loadSkills().map(s => [s.name, s.category]))
    assert.equal(byName.get('making-layouts'), 'Design & layout')
    assert.equal(byName.get('paper-js'), 'Libraries & code')
    assert.equal(byName.get('state-machines'), 'Libraries & code')
    assert.equal(byName.get('noct-grids'), 'Libraries & code')
  })

  it('the per-skill index cost is the cost of its index line', () => {
    for (const s of loadSkills()) {
      assert.equal(skillIndexTokens(s), estimateTokens(skillIndexLine(s)))
      assert.ok(skillIndexTokens(s) > 0 && skillIndexTokens(s) <= 130, `${s.name} index line stays ~100 tokens`)
      assert.ok(skillIndexText().includes(skillIndexLine(s)), 'the agent index carries the same line the panel prices')
    }
    assert.ok(SKILL_INDEX_TOKEN_BUDGET > 0)
  })

  it('the injection detail reports exactly what was included', () => {
    const detail = skillInjectionDetail({ text: 'add a pricing section to the landing page', deps: [] }, loadSkills())
    assert.deepEqual(detail.included, [{ name: 'making-layouts', via: 'trigger' }])
    assert.ok(detail.text?.includes('Skill loaded: making-layouts'))
    const none = skillInjectionDetail({ text: 'fix the button label', deps: [] }, loadSkills())
    assert.deepEqual(none, { text: null, included: [] })
    const starved = skillInjectionDetail({ text: 'add a state machine', deps: [] }, loadSkills(), 50)
    assert.deepEqual(starved, { text: null, included: [] }, 'budget-skipped skills are not reported as used')
  })
})

describe('on/off state (skills UI slice 2)', () => {
  it('a disabled skill leaves the index, matching and read-skill — and returns when re-enabled', async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const { setSkillEnabled } = await import('./skillSettings.js')
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skills-off-')), 'skills.json')
    const saved = process.env.AI_LIVE_SKILLS_PATH
    process.env.AI_LIVE_SKILLS_PATH = file
    try {
      setSkillEnabled('paper-js', false, file)
      assert.deepEqual(activeSkills().map(s => s.name), ['making-layouts', 'noct-grids', 'state-machines'])
      assert.ok(!skillIndexText().includes('paper-js'), 'no index line for an off skill')
      assert.deepEqual(
        skillInjectionDetail({ text: 'draw with paper.js', deps: ['paper'] }).included, [],
        'an off skill never triggers',
      )
      assert.equal(getSkill('paper-js', activeSkills()), undefined, 'read-skill cannot reach an off skill')
      assert.ok(getSkill('paper-js', loadSkills()), 'the panel still sees it via loadSkills')
      setSkillEnabled('paper-js', true, file)
      assert.ok(skillIndexText().includes('paper-js'), 're-enabled: back in the index')
      assert.deepEqual(skillInjectionDetail({ text: 'draw with paper.js', deps: ['paper'] }).included, [{ name: 'paper-js', via: 'trigger' }])
    } finally {
      if (saved === undefined) delete process.env.AI_LIVE_SKILLS_PATH
      else process.env.AI_LIVE_SKILLS_PATH = saved
      fs.rmSync(path.dirname(file), { recursive: true, force: true })
    }
  })
})
