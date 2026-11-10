import type { Express } from 'express'
import { deriveTechStack } from './techStack.js'

/** Tech Stack HTTP API, mounted on both servers. Derivation is
 * read-only: the facet runs no npm commands (§6.3). */
export function mountTechStackApi(app: Express) {
  app.get('/api/tech-stack', (_req, res) => {
    res.json({ ok: true, stack: deriveTechStack() })
  })
}
