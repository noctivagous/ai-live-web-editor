import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { activeSkills, getSkill } from '../../skills/skills.js'
import { loadSkillCriteria } from '../../skills/criteria.js'
import { runCriteriaForSkill } from '../../skills/criteriaGather.js'

export const readSkillTool = createTool({
  id: 'read-skill',
  description:
    'Load one skill\'s full body by name (skills are listed by one-liners in your instructions; bodies load only on trigger). Call this when the task in front of you matches a skill\'s description but its body was not auto-loaded — e.g. mid-turn you realise the work is a layout task, or the project uses a library a knowledge pack covers. Do not guess a skill body you have not loaded.',
  inputSchema: z.object({
    name: z.string().describe('Skill name from the index, e.g. "making-layouts"'),
  }),
  execute: async ({ name }) => {
    const skill = getSkill(name, activeSkills())
    if (!skill) {
      return { ok: false, error: `No skill named ${name}`, available: activeSkills().map(s => s.name) }
    }
    return {
      ok: true,
      name: skill.name,
      body: skill.body,
      bodyTokens: skill.bodyTokens,
      ...(skill.overBudget ? { warning: `This body is ${skill.bodyTokens} tokens, over the 5,000-token contract budget — treat it as due for a trim.` } : {}),
    }
  },
})

export const runSkillChecksTool = createTool({
  id: 'run-skill-checks',
  description:
    'Run a skill\'s declared result-verify criteria (its verify.json) against the live project and report a verdict per criterion: pass, fail, or couldn\'t-check, each with its evidence. Call this after work a skill guided, before claiming done — when the skill carries checks, its claims are only proven by running them. The same run doubles as an investigation: when a problem is reported (a layout broken somewhere, errors appearing), run the relevant skill\'s checks first — the verdicts name the viewport and the element at fault, which localises the fault before you change anything. Fix what fails, or report the failure honestly; never present a failed or unrun criterion as passed.',
  inputSchema: z.object({
    skill: z.string().describe('Skill name whose criteria to run, e.g. "making-layouts"'),
  }),
  execute: async ({ skill }) => {
    const found = getSkill(skill, activeSkills())
    if (!found) {
      return { ok: false, error: `No skill named ${skill}`, available: activeSkills().map(s => s.name) }
    }
    const { criteria } = loadSkillCriteria(skill)
    if (!criteria.length) {
      return { ok: false, error: `${skill} carries no checks — it declares no verify.json criteria, so there is nothing to run.` }
    }
    const outcome = await runCriteriaForSkill(skill)
    if (!outcome) return { ok: false, error: `${skill} carries no checks.` }
    const counts = { pass: 0, fail: 0, couldntCheck: 0 }
    for (const r of outcome.results) {
      if (r.verdict === 'pass') counts.pass++
      else if (r.verdict === 'fail') counts.fail++
      else counts.couldntCheck++
    }
    return {
      ok: true,
      skill,
      summary: `${counts.pass} pass, ${counts.fail} fail, ${counts.couldntCheck} couldn't-check of ${outcome.results.length} criteria`,
      results: outcome.results,
    }
  },
})
