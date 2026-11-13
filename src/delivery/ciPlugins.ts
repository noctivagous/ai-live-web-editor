/**
 * The CI plugin registry's composition point — the deploy
 * registry's twin (deployPlugins.ts): every CI provider
 * plugin the facet ships is listed here, and the Delivery
 * API serves exactly this list. Adding a provider later is
 * one import and one array entry (§13.8).
 */
import type { CiPlugin } from './ci.js'
import { githubActionsPlugin } from './ciGithub.js'

export const ALL_CI_PLUGINS: CiPlugin[] = [githubActionsPlugin]
