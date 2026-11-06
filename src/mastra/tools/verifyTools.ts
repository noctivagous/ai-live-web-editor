import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { liveConsole, liveNetworkFailures } from '../../liveTarget.js'

const levelsEnum = z.enum(['log', 'info', 'warn', 'error', 'debug', 'pageerror'])

export const getConsoleTool = createTool({
  id: 'get-console',
  description:
    'Read recent console output and page errors from the live page (ring buffer, newest last). Filter by level, last-N, or since a sequence number. Pass url for the Playwright pool.',
  inputSchema: z.object({
    levels: z.array(levelsEnum).optional().describe('Only these levels (default all)'),
    maxEntries: z.number().int().positive().max(200).optional().describe('Max entries (default 100)'),
    sinceSeq: z.number().int().nonnegative().optional().describe('Only entries after this sequence number'),
    url: z.string().optional(),
  }),
  execute: async ({ url, ...rest }) => liveConsole(rest as Record<string, unknown>, url),
})

export const getNetworkFailuresTool = createTool({
  id: 'get-network-failures',
  description:
    'List failed network requests from the live page. Pool returns request-level failures; the Vite bridge only has timing-level data (labelled). Pass url for the Playwright pool.',
  inputSchema: z.object({
    maxEntries: z.number().int().positive().max(200).optional().describe('Max entries (default 100)'),
    sinceSeq: z.number().int().nonnegative().optional().describe('Only entries after this sequence number'),
    url: z.string().optional(),
  }),
  execute: async ({ url, ...rest }) => liveNetworkFailures(rest as Record<string, unknown>, url),
})
