import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectPreset, inferModalities, presetById, suggestedModel, tagModels } from './providerPresets.js'

test('detectPreset: distinctive prefixes resolve to one preset', () => {
  assert.equal(detectPreset('sk-or-v1-abc')?.preset.slotId, 'openrouter')
  assert.equal(detectPreset('xai-abc')?.preset.slotId, 'xai')
  assert.equal(detectPreset('gsk_abc')?.preset.slotId, 'groq')
  assert.equal(detectPreset('sk-ant-api03-abc')?.preset.slotId, 'anthropic')
  assert.equal(detectPreset('LLM|123|abc')?.preset.slotId, 'meta')
  assert.equal(detectPreset('AIzaSy-abc')?.preset.slotId, 'google')
})

test('detectPreset: bare sk- is ambiguous between OpenAI and DeepSeek', () => {
  const d = detectPreset('sk-plainkey')
  assert.ok(d)
  assert.ok(d.ambiguous && d.ambiguous.length > 1)
  assert.deepEqual(d.ambiguous.map(p => p.slotId).sort(), ['deepseek', 'openai'])
})

test('detectPreset: base URL wins over key shape', () => {
  const d = detectPreset('sk-whatever', 'https://api.meta.ai/v1')
  assert.equal(d?.preset.slotId, 'meta')
  assert.equal(presetById('meta')?.defaultBaseUrl, 'https://api.meta.ai/v1')
  assert.equal(presetById('meta')?.envKey, 'MODEL_API_KEY')
})

test('inferModalities: media ids are not misread as text', () => {
  assert.deepEqual(inferModalities('sora-2'), ['video'])
  assert.deepEqual(inferModalities('grok-imagine-video-1.5'), ['video'])
  assert.deepEqual(inferModalities('grok-imagine-image'), ['image'])
  assert.deepEqual(inferModalities('dall-e-3'), ['image'])
  assert.deepEqual(inferModalities('gpt-image-1'), ['image'])
  assert.deepEqual(inferModalities('imagen-4.0-generate-001'), ['image'])
  assert.deepEqual(inferModalities('tts-1'), ['audio'])
  assert.deepEqual(inferModalities('whisper-1'), ['audio'])
  assert.deepEqual(inferModalities('gpt-4o-mini'), ['text'])
  assert.deepEqual(inferModalities('claude-sonnet-4-5'), ['text'])
  assert.deepEqual(inferModalities('muse-spark-1.3'), ['text'])
  assert.deepEqual(inferModalities('anthropic/claude-sonnet-4.5'), ['text'])
  assert.deepEqual(inferModalities('some-unknown-model'), ['text'])
})

test('suggestedModel picks the preset suggestion the provider returned', () => {
  const meta = presetById('meta')!
  const models = tagModels(['muse-spark-1.2', 'muse-spark-1.3'])
  assert.equal(suggestedModel(meta, models), 'muse-spark-1.3')
  const openai = presetById('openai')!
  assert.equal(suggestedModel(openai, tagModels(['gpt-4o', 'gpt-4o-mini'])), 'gpt-4o-mini')
})
