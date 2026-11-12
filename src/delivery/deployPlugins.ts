/**
 * The deployment plugin registry's composition point: every
 * provider plugin the facet ships is listed here, and the
 * Delivery API serves exactly this list. Adding a provider
 * later is one import and one array entry (§13.5).
 */
import type { DeployPlugin } from './deploy.js'
import { cloudflarePlugin } from './deployCloudflare.js'
import { vercelPlugin } from './deployVercel.js'

export const ALL_DEPLOY_PLUGINS: DeployPlugin[] = [cloudflarePlugin, vercelPlugin]
