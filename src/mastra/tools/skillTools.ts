import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { activeSkills, getSkill } from '../../skills/skills.js'

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
