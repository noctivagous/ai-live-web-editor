import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  connectionKeyEnvName, opencodeMappingFor, opencodeProviderId, OPENCODE_VERSION,
  type OpencodeConnectionInput,
} from './config.js'

const META: OpencodeConnectionInput = {
  id: 'meta', name: 'Meta', model: 'muse-spark-1.3',
  baseUrl: 'https://api.meta.ai/v1', presetProviderId: 'openai-compatible',
}
const OPTS = { pluginDir: '/editor/src/opencode/ale-plugin', hostUrl: 'http://127.0.0.1:4112' }

describe('opencode config generation', () => {
  it('pins the verified v2 line', () => {
    assert.equal(OPENCODE_VERSION, '2.2.6')
  })

  it('maps an OpenAI-compatible (Meta) connection to a v2 provider config', () => {
    const r = opencodeMappingFor(META, OPTS)
    if (r.ok === false) assert.fail(`expected a mapping, got: ${r.error}`)
    const { mapping } = r
    assert.equal(mapping.providerID, 'ale-meta')
    assert.equal(mapping.modelID, 'muse-spark-1.3')
    assert.equal(mapping.keyEnvName, 'CONN_KEY_META')
    assert.equal(mapping.config.model, 'ale-meta/muse-spark-1.3')
    const providers = mapping.config.providers as Record<string, Record<string, unknown>>
    const provider = providers['ale-meta']
    assert.equal(provider.name, 'Meta')
    assert.equal(provider.package, '@opencode/ai/providers/openai-compatible')
    assert.deepEqual(provider.env, ['CONN_KEY_META'])
    assert.deepEqual(provider.settings, { baseURL: 'https://api.meta.ai/v1' })
    assert.deepEqual(provider.models, { 'muse-spark-1.3': { name: 'muse-spark-1.3' } })
    const plugins = mapping.config.plugins as Array<{ package: string; options: { hostUrl: string } }>
    assert.equal(plugins[0].package, '/editor/src/opencode/ale-plugin')
    assert.equal(plugins[0].options.hostUrl, 'http://127.0.0.1:4112')
  })

  it('references the key by env NAME only — no key value anywhere in the config', () => {
    const r = opencodeMappingFor(META, OPTS)
    if (r.ok === false) assert.fail(`expected a mapping, got: ${r.error}`)
    const serialized = JSON.stringify(r.mapping.config)
    // The only credential-shaped content allowed is the env var name.
    assert.ok(serialized.includes('CONN_KEY_META'))
    assert.ok(!/apiKey|api_key|Authorization/i.test(serialized))
  })

  it('refuses a non-OpenAI-compatible preset with a named, actionable error', () => {
    const r = opencodeMappingFor({ ...META, presetProviderId: 'anthropic' }, OPTS)
    if (r.ok === true) assert.fail('expected a refusal for a non-OpenAI-compatible preset')
    assert.match(r.error, /anthropic/)
    assert.match(r.error, /OpenAI-compatible/)
    assert.match(r.error, /Mastra/)
  })

  it('refuses a connection with no model or no base URL', () => {
    assert.equal(opencodeMappingFor({ ...META, model: '' }, OPTS).ok, false)
    assert.equal(opencodeMappingFor({ ...META, baseUrl: '' }, OPTS).ok, false)
  })

  it('derives env names and provider ids with the repo transforms', () => {
    assert.equal(connectionKeyEnvName('meta'), 'CONN_KEY_META')
    assert.equal(connectionKeyEnvName('my conn.2'), 'CONN_KEY_MY_CONN_2')
    assert.equal(opencodeProviderId('Meta'), 'ale-meta')
    assert.equal(opencodeProviderId('my conn.2'), 'ale-my-conn-2')
  })
})
