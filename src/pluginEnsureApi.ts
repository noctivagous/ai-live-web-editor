/**
 * Plugin-ensure API (bridge guarantee, slice 1): the Preview pane
 * reads the active project's ensure state here and drives the two
 * user actions — Remove (strip the marked addition, record the
 * opt-out) and Re-enable (clear the opt-out, ensure again). Both
 * actions restart the project's dev server through the launcher's
 * own startVite, i.e. the project's unmodified `npm run dev`.
 *
 * Mounted on the :4112 server only: project selection lives there.
 * (In plugin-hosted mode the plugin is registered by definition.)
 */
import type { Express } from 'express'
import { getFsRoot } from './launcher.js'
import {
  enableProjectPlugin,
  ensureDisplayState,
  getEnsureState,
  removeProjectPlugin,
} from './pluginEnsure.js'

export function mountPluginEnsureApi(app: Express, opts: { restart: () => void }) {
  app.get('/api/plugin-ensure', (_req, res) => {
    const root = getFsRoot()
    res.json({ ok: true, ensure: getEnsureState(root) ?? ensureDisplayState(root) })
  })

  app.post('/api/plugin-ensure/remove', (_req, res) => {
    const root = getFsRoot()
    const result = removeProjectPlugin(root)
    if (result.changed) opts.restart()
    res.json({
      ok: result.ok,
      ensure: result.state,
      ...(result.detail ? { detail: result.detail } : {}),
    })
  })

  app.post('/api/plugin-ensure/enable', (_req, res) => {
    const root = getFsRoot()
    const state = enableProjectPlugin(root)
    if (state.state === 'added') opts.restart()
    res.json({ ok: true, ensure: state })
  })
}
