import type { Express } from 'express'
import { bundleJsxComponent } from './jsxBundle.js'

/** Isolated .jsx preview: bundle one component for the Component tab. */
export function mountJsxBundleApi(app: Express): void {
  app.post('/api/jsx/bundle', (req, res) => {
    const p = typeof req.body?.path === 'string' ? req.body.path : ''
    res.json(bundleJsxComponent(p))
  })
}
