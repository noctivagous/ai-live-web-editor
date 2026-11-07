/**
 * Provider preset registry — the single source of truth for the BYOK
 * provider catalog, shared by the launcher server and the UI.
 *
 * Every preset is an OpenAI-compatible service: the difference between
 * providers is the service (base URL, key format, models), not the API.
 * Field shape follows the cinegen registry (slotId, providerId, envKey,
 * defaultBaseUrl, authHeader) extended with what the setup UI needs
 * (section, blurb, key prefixes for paste detection, get-a-key link,
 * suggested models, declared modalities).
 */

export type Modality = 'text' | 'image' | 'video' | 'audio'

export const MODALITIES: Modality[] = ['text', 'image', 'video', 'audio']

export const MODALITY_LABELS: Record<Modality, string> = {
  text: 'Text',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
}

export type ProviderSection = 'frontier' | 'open-weight' | 'aggregators' | 'media' | 'local'

export const PROVIDER_SECTIONS: { id: ProviderSection, label: string }[] = [
  { id: 'frontier', label: 'Frontier / Closed' },
  { id: 'open-weight', label: 'Open-Weight Inference' },
  { id: 'aggregators', label: 'Aggregators & Routers' },
  { id: 'media', label: 'Specialized / Media' },
  { id: 'local', label: 'Direct / Local / Custom' },
]

export type AuthStyle = 'bearer' | 'x-api-key' | 'key' | 'xi-api-key' | 'none'

export interface ProviderPreset {
  slotId: string
  name: string
  /** API shape; every built-in here is reached the OpenAI-compatible way. */
  providerId: 'openai-compatible' | 'generic-rest'
  section: ProviderSection
  blurb: string
  defaultBaseUrl: string
  /** Env var the key is stored under for a first/only connection. */
  envKey: string
  authHeader: AuthStyle
  /** Distinctive key prefixes used for paste detection. */
  keyPrefixes: string[]
  getKeyUrl?: string
  /** Preferred models, in order, when the provider's list contains them. */
  suggested: string[]
  /** Modalities this provider is known to serve (before any probe). */
  modalities: Modality[]
  noKey?: boolean
  /** Extra path probed before /models (xAI lists chat models here). */
  modelsPath?: string
  /**
   * Provider-native web search (§N): the provider grounds
   * answers in live web results itself, so no separate search
   * key is needed. 'responses' = the Responses API shape
   * (tools: [{type: 'web_search'}], Meta Model API + OpenAI).
   * Only set where that call shape is implemented.
   */
  webSearch?: 'responses'
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    slotId: 'openai', name: 'OpenAI', providerId: 'openai-compatible', section: 'frontier',
    blurb: 'GPT models for text, image, and multimodal tasks.',
    defaultBaseUrl: 'https://api.openai.com/v1', envKey: 'OPENAI_API_KEY', authHeader: 'bearer',
    keyPrefixes: ['sk-proj-', 'sk-'], getKeyUrl: 'https://platform.openai.com/api-keys',
    suggested: ['gpt-4o-mini', 'gpt-4o'], modalities: ['text', 'image', 'audio'],
    webSearch: 'responses',
  },
  {
    slotId: 'anthropic', name: 'Anthropic', providerId: 'openai-compatible', section: 'frontier',
    blurb: 'Claude models, reached through the OpenAI-compatible endpoint.',
    defaultBaseUrl: 'https://api.anthropic.com/v1', envKey: 'ANTHROPIC_API_KEY', authHeader: 'bearer',
    keyPrefixes: ['sk-ant-'], getKeyUrl: 'https://console.anthropic.com/settings/keys',
    suggested: ['claude-sonnet-4-5', 'claude-3-5-sonnet-latest'], modalities: ['text'],
  },
  {
    slotId: 'meta', name: 'Meta', providerId: 'openai-compatible', section: 'frontier',
    blurb: 'Meta Model API — Muse models, OpenAI-compatible.',
    defaultBaseUrl: 'https://api.meta.ai/v1', envKey: 'MODEL_API_KEY', authHeader: 'bearer',
    keyPrefixes: ['LLM|'], getKeyUrl: 'https://dev.meta.ai/docs/',
    suggested: ['muse-spark-1.3'], modalities: ['text', 'image', 'audio'],
    webSearch: 'responses',
  },
  {
    slotId: 'google', name: 'Google', providerId: 'openai-compatible', section: 'frontier',
    blurb: 'Gemini models, reached through the OpenAI-compatible endpoint.',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', envKey: 'GOOGLE_API_KEY', authHeader: 'bearer',
    keyPrefixes: ['AIza'], getKeyUrl: 'https://aistudio.google.com/apikey',
    suggested: ['gemini-2.5-flash', 'gemini-2.5-pro'], modalities: ['text', 'image', 'video', 'audio'],
  },
  {
    slotId: 'xai', name: 'xAI', providerId: 'openai-compatible', section: 'frontier',
    blurb: 'Grok models for reasoning and text generation.',
    defaultBaseUrl: 'https://api.x.ai/v1', envKey: 'XAI_API_KEY', authHeader: 'bearer',
    keyPrefixes: ['xai-'], getKeyUrl: 'https://console.x.ai',
    suggested: ['grok-4.7', 'grok-4.5', 'grok-4.3'], modalities: ['text', 'image', 'video'],
    modelsPath: '/language-models',
  },
  {
    slotId: 'groq', name: 'Groq', providerId: 'openai-compatible', section: 'open-weight',
    blurb: 'Ultra-low latency via custom hardware (LPUs).',
    defaultBaseUrl: 'https://api.groq.com/openai/v1', envKey: 'GROQ_API_KEY', authHeader: 'bearer',
    keyPrefixes: ['gsk_'], getKeyUrl: 'https://console.groq.com/keys',
    suggested: ['llama-3.3-70b-versatile'], modalities: ['text', 'audio'],
  },
  {
    slotId: 'together', name: 'Together AI', providerId: 'openai-compatible', section: 'open-weight',
    blurb: 'Broad catalog, fine-tuning, serverless.',
    defaultBaseUrl: 'https://api.together.xyz/v1', envKey: 'TOGETHER_API_KEY', authHeader: 'bearer',
    keyPrefixes: [], getKeyUrl: 'https://api.together.ai/settings/api-keys',
    suggested: [], modalities: ['text', 'image', 'video'],
  },
  {
    slotId: 'fireworks', name: 'Fireworks AI', providerId: 'openai-compatible', section: 'open-weight',
    blurb: 'High-speed inference optimization.',
    defaultBaseUrl: 'https://api.fireworks.ai/inference/v1', envKey: 'FIREWORKS_API_KEY', authHeader: 'bearer',
    keyPrefixes: ['fw_'], getKeyUrl: 'https://fireworks.ai/account/api-keys',
    suggested: [], modalities: ['text'],
  },
  {
    slotId: 'deepseek', name: 'DeepSeek', providerId: 'openai-compatible', section: 'open-weight',
    blurb: 'DeepSeek chat and reasoning models.',
    defaultBaseUrl: 'https://api.deepseek.com/v1', envKey: 'DEEPSEEK_API_KEY', authHeader: 'bearer',
    keyPrefixes: ['sk-'], getKeyUrl: 'https://platform.deepseek.com/api_keys',
    suggested: ['deepseek-chat', 'deepseek-reasoner'], modalities: ['text'],
  },
  {
    slotId: 'mistral', name: 'Mistral AI', providerId: 'openai-compatible', section: 'open-weight',
    blurb: 'Mistral and Codestral models.',
    defaultBaseUrl: 'https://api.mistral.ai/v1', envKey: 'MISTRAL_API_KEY', authHeader: 'bearer',
    keyPrefixes: [], getKeyUrl: 'https://console.mistral.ai/api-keys',
    suggested: ['mistral-large-latest', 'codestral-latest'], modalities: ['text'],
  },
  {
    slotId: 'openrouter', name: 'OpenRouter', providerId: 'openai-compatible', section: 'aggregators',
    blurb: 'Hundreds of models from many providers behind one key.',
    defaultBaseUrl: 'https://openrouter.ai/api/v1', envKey: 'OPENROUTER_API_KEY', authHeader: 'bearer',
    keyPrefixes: ['sk-or-'], getKeyUrl: 'https://openrouter.ai/keys',
    suggested: ['anthropic/claude-sonnet-4.5', 'openai/gpt-4o-mini'], modalities: ['text', 'image', 'video', 'audio'],
  },
  {
    slotId: 'vercel', name: 'Vercel AI Gateway', providerId: 'openai-compatible', section: 'aggregators',
    blurb: 'One gateway key for models across providers.',
    defaultBaseUrl: 'https://ai-gateway.vercel.sh/v1', envKey: 'AI_GATEWAY_API_KEY', authHeader: 'bearer',
    keyPrefixes: ['vck_'], getKeyUrl: 'https://vercel.com/docs/ai-gateway',
    suggested: [], modalities: ['text', 'image'],
  },
  {
    slotId: 'fal', name: 'fal.ai', providerId: 'openai-compatible', section: 'media',
    blurb: 'Flux, Kling and other image/video models.',
    defaultBaseUrl: 'https://fal.run', envKey: 'FAL_KEY', authHeader: 'key',
    keyPrefixes: [], getKeyUrl: 'https://fal.ai/dashboard/keys',
    suggested: [], modalities: ['image', 'video', 'audio'],
  },
  {
    slotId: 'replicate', name: 'Replicate', providerId: 'openai-compatible', section: 'media',
    blurb: 'Hosted open-source models of every kind.',
    defaultBaseUrl: 'https://api.replicate.com/v1', envKey: 'REPLICATE_API_TOKEN', authHeader: 'bearer',
    keyPrefixes: ['r8_'], getKeyUrl: 'https://replicate.com/account/api-tokens',
    suggested: [], modalities: ['text', 'image', 'video', 'audio'],
  },
  {
    slotId: 'runway', name: 'Runway ML', providerId: 'openai-compatible', section: 'media',
    blurb: 'Gen video models.',
    defaultBaseUrl: 'https://api.dev.runwayml.com', envKey: 'RUNWAY_API_KEY', authHeader: 'bearer',
    keyPrefixes: ['key_'], getKeyUrl: 'https://dev.runwayml.com',
    suggested: [], modalities: ['video', 'image'],
  },
  {
    slotId: 'luma', name: 'Luma AI', providerId: 'openai-compatible', section: 'media',
    blurb: 'Dream Machine video and Photon image models.',
    defaultBaseUrl: 'https://api.lumalabs.ai', envKey: 'LUMA_API_KEY', authHeader: 'bearer',
    keyPrefixes: [], getKeyUrl: 'https://lumalabs.ai/dream-machine/api',
    suggested: [], modalities: ['video', 'image'],
  },
  {
    slotId: 'elevenlabs', name: 'ElevenLabs', providerId: 'openai-compatible', section: 'media',
    blurb: 'Voice, speech and sound generation.',
    defaultBaseUrl: 'https://api.elevenlabs.io', envKey: 'ELEVENLABS_API_KEY', authHeader: 'xi-api-key',
    keyPrefixes: ['sk_'], getKeyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    suggested: [], modalities: ['audio'],
  },
  {
    slotId: 'ollama', name: 'Ollama (local)', providerId: 'openai-compatible', section: 'local',
    blurb: 'Models running on this machine. No key needed.',
    defaultBaseUrl: 'http://localhost:11434/v1', envKey: 'OLLAMA_API_KEY', authHeader: 'none',
    keyPrefixes: [], suggested: ['llama3.1', 'qwen2.5-coder'], modalities: ['text'],
    noKey: true,
  },
  {
    slotId: 'custom', name: 'Custom', providerId: 'generic-rest', section: 'local',
    blurb: 'Any other OpenAI-compatible endpoint.',
    defaultBaseUrl: '', envKey: 'CUSTOM_API_KEY', authHeader: 'bearer',
    keyPrefixes: [], suggested: [], modalities: ['text'],
  },
]

export function presetById(slotId: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find(p => p.slotId === slotId)
}

export interface Detection {
  preset: ProviderPreset
  /** More than one preset matches the key (e.g. a bare `sk-`): ask, don't guess. */
  ambiguous?: ProviderPreset[]
}

/** Detect a preset from a pasted key and/or an explicitly given base URL. */
export function detectPreset(key: string, baseUrl = ''): Detection | null {
  const k = key.trim()
  const u = baseUrl.trim().replace(/\/+$/, '').toLowerCase()
  if (u) {
    const byUrl = PROVIDER_PRESETS.find(p => p.defaultBaseUrl && u.startsWith(p.defaultBaseUrl.replace(/\/+$/, '').toLowerCase()))
    if (byUrl) return { preset: byUrl }
  }
  if (!k) return null
  // Longest matching prefix wins (sk-ant- / sk-or- before bare sk-).
  const matchLen = (p: ProviderPreset) => Math.max(0, ...p.keyPrefixes.filter(prefix => k.startsWith(prefix)).map(x => x.length))
  const matches = PROVIDER_PRESETS.filter(p => matchLen(p) > 0)
  if (!matches.length) return null
  const topLen = Math.max(...matches.map(matchLen))
  const tied = matches.filter(p => matchLen(p) === topLen)
  if (tied.length > 1) return { preset: tied[0], ambiguous: tied }
  return { preset: tied[0] }
}

/* ── Modality inference (per model, videogen-style name rules) ─────────── */

const VIDEO_RULE = /sora|kling|ray[-\d]|dream-machine|hailuo|video|veo|gen-[34]\b|pika|runwayml|animate|motion|wan[-\d]|seedance/i
const IMAGE_RULE = /dall-e|gpt-image|flux|sdxl|stable-diffusion|imagen|photon|ideogram|recraft|image|diffusion|midjourney/i
const AUDIO_RULE = /tts|whisper|speech|voice|transcribe|eleven|lyria|music|suno|udio|audio|sound/i
const TEXT_RULE = /gpt-|gpt\b|claude|llama|mistral|mixtral|codestral|gemini|gemma|grok|deepseek|qwen|muse-|sonnet|opus|haiku|o[134]\b|o[134]-|chat|instruct|command|phi-|solar/i

/**
 * Infer which modalities a model serves from its id. Order matters:
 * media-specific ids are claimed before the generic text rule, so
 * `grok-imagine-video` is video (not text) and `gpt-image-1` is image.
 * A model can serve several modalities (e.g. gpt-4o → text + image input
 * is still primarily text here; only generation shapes are tagged).
 */
export function inferModalities(modelId: string): Modality[] {
  const id = modelId.toLowerCase()
  const found = new Set<Modality>()
  if (/imagine-video|text-to-video|image-to-video/.test(id)) found.add('video')
  else if (/imagine-image|text-to-image/.test(id)) found.add('image')
  if (!found.size && VIDEO_RULE.test(id) && !/imagen/.test(id)) found.add('video')
  if (!found.size && IMAGE_RULE.test(id)) found.add('image')
  if (AUDIO_RULE.test(id) && !/gpt-4o/.test(id)) found.add('audio')
  if (!found.size && TEXT_RULE.test(id)) found.add('text')
  if (!found.size) found.add('text')
  return MODALITIES.filter(m => found.has(m))
}

export interface ModelInfo {
  id: string
  modalities: Modality[]
}

export function tagModels(ids: string[]): ModelInfo[] {
  return ids.map(id => ({ id, modalities: inferModalities(id) }))
}

/** First suggested model that the provider actually returned, per modality. */
export function suggestedModel(preset: ProviderPreset, models: ModelInfo[], modality: Modality = 'text'): string {
  const inModality = models.filter(m => m.modalities.includes(modality))
  for (const want of preset.suggested) {
    if (inModality.some(m => m.id === want)) return want
  }
  return inModality[0]?.id || ''
}
