import type { ModelConfig, ProviderModelRef, ProviderType, ReasoningConfig, ReasoningEffort } from '@/types/provider'

export const defaultProviderNames: Record<ProviderType, string> = {
  openai: 'OpenAI',
  'openai-responses': 'OpenAI Responses',
  anthropic: 'Anthropic',
  google: 'Google GenAI',
}

export const defaultBaseUrls: Record<ProviderType, string> = {
  openai: 'https://api.openai.com/v1',
  'openai-responses': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com',
}

export const builtinModels: Record<ProviderType, ModelConfig[]> = {
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', tier: 'expert', maxTokens: 16384, supportsStreaming: true, supportsEmbeddings: false, source: 'builtin', reasoning: defaultReasoningConfig() },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', tier: 'standard', maxTokens: 16384, supportsStreaming: true, supportsEmbeddings: false, source: 'builtin', reasoning: defaultReasoningConfig() },
    { id: 'text-embedding-3-small', name: 'Text Embedding 3 Small', tier: 'standard', maxTokens: 8192, supportsStreaming: false, supportsEmbeddings: true, embeddingDimensions: 1536, source: 'builtin', reasoning: defaultReasoningConfig() },
    { id: 'text-embedding-3-large', name: 'Text Embedding 3 Large', tier: 'expert', maxTokens: 8192, supportsStreaming: false, supportsEmbeddings: true, embeddingDimensions: 3072, source: 'builtin', reasoning: defaultReasoningConfig() },
  ],
  'openai-responses': [
    { id: 'gpt-4o', name: 'GPT-4o', tier: 'expert', maxTokens: 16384, supportsStreaming: true, supportsEmbeddings: false, source: 'builtin', reasoning: defaultReasoningConfig() },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', tier: 'standard', maxTokens: 16384, supportsStreaming: true, supportsEmbeddings: false, source: 'builtin', reasoning: defaultReasoningConfig() },
    { id: 'text-embedding-3-small', name: 'Text Embedding 3 Small', tier: 'standard', maxTokens: 8192, supportsStreaming: false, supportsEmbeddings: true, embeddingDimensions: 1536, source: 'builtin', reasoning: defaultReasoningConfig() },
    { id: 'text-embedding-3-large', name: 'Text Embedding 3 Large', tier: 'expert', maxTokens: 8192, supportsStreaming: false, supportsEmbeddings: true, embeddingDimensions: 3072, source: 'builtin', reasoning: defaultReasoningConfig() },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', tier: 'expert', maxTokens: 8192, supportsStreaming: true, supportsEmbeddings: false, source: 'builtin', reasoning: defaultReasoningConfig() },
    { id: 'claude-haiku-4-20250414', name: 'Claude Haiku 4', tier: 'standard', maxTokens: 8192, supportsStreaming: true, supportsEmbeddings: false, source: 'builtin', reasoning: defaultReasoningConfig() },
  ],
  google: [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', tier: 'expert', maxTokens: 65536, supportsStreaming: true, supportsEmbeddings: false, source: 'builtin', reasoning: defaultReasoningConfig() },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', tier: 'standard', maxTokens: 65536, supportsStreaming: true, supportsEmbeddings: false, source: 'builtin', reasoning: defaultReasoningConfig() },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', tier: 'standard', maxTokens: 8192, supportsStreaming: true, supportsEmbeddings: false, source: 'builtin', reasoning: defaultReasoningConfig() },
    { id: 'text-embedding-004', name: 'Text Embedding 004', tier: 'standard', maxTokens: 2048, supportsStreaming: false, supportsEmbeddings: true, embeddingDimensions: 768, source: 'builtin', reasoning: defaultReasoningConfig() },
  ],
}

export function formatModelLabel(providerName: string, modelName: string) {
  return `${providerName}/${modelName}`
}

export function normalizeProviderId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function createProviderIdFromName(name: string) {
  const normalized = normalizeProviderId(name)
  return normalized || 'provider'
}

export function encodeProviderModelRef(ref: ProviderModelRef) {
  return `${ref.providerId}::${ref.modelId}`
}

export function decodeProviderModelRef(value: string): ProviderModelRef | null {
  const [providerId, ...rest] = value.split('::')
  const modelId = rest.join('::')
  if (!providerId || !modelId) return null
  return { providerId, modelId }
}

function normalizeDisplayName(modelId: string, displayName?: string | null) {
  const name = displayName?.trim()
  return name || modelId
}

function inferTier(providerType: ProviderType, modelId: string): 'expert' | 'standard' {
  const id = modelId.toLowerCase()

  if (providerType === 'openai' || providerType === 'openai-responses') {
    if (id.includes('mini') || id.includes('nano') || id.includes('light')) return 'standard'
    return 'expert'
  }

  if (providerType === 'google') {
    if (id.includes('pro')) return 'expert'
    return 'standard'
  }

  if (id.includes('haiku') || id.includes('mini') || id.includes('small')) return 'standard'
  return 'expert'
}

function inferSupportsEmbeddings(providerType: ProviderType, modelId: string): boolean {
  const id = modelId.toLowerCase()

  if (providerType === 'anthropic') {
    return false
  }

  if (providerType === 'google') {
    return id.includes('embedding')
  }

  if (
    id.includes('embedding') ||
    id.includes('text-embedding') ||
    id.includes('embed') ||
    id.includes('bge') ||
    id.includes('e5') ||
    id.includes('nomic')
  ) {
    return true
  }

  return false
}

function inferEmbeddingDimensions(modelId: string, apiDimensions?: number | null): number | null {
  if (apiDimensions != null && Number.isFinite(apiDimensions) && apiDimensions > 0) {
    return apiDimensions
  }

  const knownDimensions: Record<string, number> = {
    'text-embedding-3-large': 3072,
    'text-embedding-3-small': 1536,
    'text-embedding-ada-002': 1536,
    'text-embedding-004': 768,
    'embedding-001': 768,
  }

  const id = modelId.toLowerCase()
  if (knownDimensions[id]) return knownDimensions[id]
  if (id.includes('bge-m3')) return 1024
  if (id.includes('bge-large')) return 1024
  if (id.includes('bge-small') || id.includes('bge-base')) return 768
  if (id.includes('nomic-embed-text')) return 768
  if (id.includes('e5-mistral') || id.includes('e5-large')) return 1024
  if (id.includes('e5-base') || id.includes('e5-small')) return 768

  return null
}

function inferSupportsStreaming(providerType: ProviderType, modelId: string): boolean {
  return !inferSupportsEmbeddings(providerType, modelId)
}

function inferMaxTokens(providerType: ProviderType, modelId: string): number {
  const id = modelId.toLowerCase()

  if (providerType === 'openai' || providerType === 'openai-responses') {
    if (id.includes('mini') || id.includes('nano')) return 16384
    if (id.includes('gpt-5') || id.includes('4.1')) return 32768
    return 16384
  }

  if (providerType === 'google') {
    if (id.includes('pro')) return 65536
    return 8192
  }

  if (id.includes('haiku') || id.includes('mini')) return 8192
  if (id.includes('sonnet') || id.includes('opus')) return 8192
  return 8192
}

const openaiContextFallback: Record<string, number> = {
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'gpt-4-32k': 32768,
  'gpt-3.5-turbo': 16385,
  'gpt-3.5-turbo-16k': 16385,
  'o1': 200000,
  'o1-mini': 128000,
  'o1-pro': 200000,
  'o3': 200000,
  'o3-mini': 200000,
  'o4-mini': 200000,
  'gpt-4.1': 1047576,
  'gpt-4.1-mini': 1047576,
  'gpt-4.1-nano': 1047576,
  'gpt-5': 1047576,
  'gpt-5-mini': 1047576,
  'gpt-5-nano': 1047576,
}

const anthropicContextFallback: Record<string, number> = {
  'claude-opus-4-20250514': 200000,
  'claude-sonnet-4-20250514': 200000,
  'claude-haiku-4-20250414': 200000,
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-5-haiku-20241022': 200000,
  'claude-3-opus-20240229': 200000,
  'claude-3-sonnet-20240229': 200000,
  'claude-3-haiku-20240307': 200000,
}

const googleContextFallback: Record<string, number> = {
  'gemini-2.5-pro': 1048576,
  'gemini-2.5-flash': 1048576,
  'gemini-2.0-flash': 1048576,
  'gemini-2.0-flash-lite': 1048576,
  'gemini-1.5-pro': 2097152,
  'gemini-1.5-flash': 1048576,
}

function inferContextTokens(providerType: ProviderType, modelId: string): { tokens: number | null; source: 'fallback' | null } {
  const id = modelId.toLowerCase()
  const table = providerType === 'openai' || providerType === 'openai-responses' ? openaiContextFallback : providerType === 'google' ? googleContextFallback : anthropicContextFallback

  // Exact match
  if (table[id]) return { tokens: table[id], source: 'fallback' }

  // Pattern match for OpenAI
  if (providerType === 'openai' || providerType === 'openai-responses') {
    if (id.includes('gpt-4.1') || id.includes('gpt-5')) return { tokens: 1047576, source: 'fallback' }
    if (id.includes('gpt-4o') || id.includes('gpt-4-turbo')) return { tokens: 128000, source: 'fallback' }
    if (id.includes('o1') || id.includes('o3') || id.includes('o4')) return { tokens: 200000, source: 'fallback' }
    if (id.includes('gpt-4')) return { tokens: 8192, source: 'fallback' }
    if (id.includes('gpt-3.5')) return { tokens: 16385, source: 'fallback' }
  }

  // Pattern match for Anthropic
  if (providerType === 'anthropic') {
    if (id.includes('claude')) return { tokens: 200000, source: 'fallback' }
  }

  // Pattern match for Google
  if (providerType === 'google') {
    if (id.includes('gemini-2.5') || id.includes('gemini-2.0')) return { tokens: 1048576, source: 'fallback' }
    if (id.includes('gemini-1.5-pro')) return { tokens: 2097152, source: 'fallback' }
    if (id.includes('gemini-1.5')) return { tokens: 1048576, source: 'fallback' }
    if (id.includes('gemini')) return { tokens: 1048576, source: 'fallback' }
  }

  return { tokens: null, source: null }
}

export function defaultReasoningConfig(): ReasoningConfig {
  return {
    enabled: false,
    effort: 'medium',
  }
}

export function normalizeReasoningConfig(reasoning?: Partial<ReasoningConfig> | null): ReasoningConfig {
  const effortSet: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'max']
  return {
    enabled: reasoning?.enabled ?? false,
    effort: effortSet.includes(reasoning?.effort as ReasoningEffort) ? (reasoning?.effort as ReasoningEffort) : 'medium',
  }
}

export function inferModelConfig(
  providerType: ProviderType,
  modelId: string,
  displayName?: string | null,
  source: ModelConfig['source'] = 'remote',
  apiContextTokens?: number | null,
  apiEmbeddingDimensions?: number | null
): ModelConfig {
  const name = normalizeDisplayName(modelId, displayName)
  const fallback = inferContextTokens(providerType, modelId)
  return {
    id: modelId,
    name,
    tier: inferTier(providerType, modelId),
    maxTokens: inferMaxTokens(providerType, modelId),
    contextTokens: apiContextTokens ?? fallback.tokens ?? null,
    contextTokensSource: apiContextTokens ? 'api' : fallback.source ?? null,
    supportsStreaming: inferSupportsStreaming(providerType, modelId),
    supportsEmbeddings: inferSupportsEmbeddings(providerType, modelId),
    embeddingDimensions: inferEmbeddingDimensions(modelId, apiEmbeddingDimensions),
    source,
    reasoning: defaultReasoningConfig(),
  }
}

export function createCustomModelDraft(
  providerType: ProviderType,
  id: string,
  name?: string,
  source: ModelConfig['source'] = 'custom'
): ModelConfig {
  return inferModelConfig(providerType, id, name, source)
}

export function normalizeFetchedModels(providerType: ProviderType, payload: any): ModelConfig[] {
  const rawModels = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : []

  return rawModels
    .map((model: any) => {
      const id = typeof model === 'string' ? model : model?.id
      if (!id) return null
      const displayName = typeof model === 'object'
        ? model.display_name || model.displayName || model.name
        : undefined
      const apiContextTokens = typeof model === 'object'
        ? model.context_window ?? model.contextWindow ?? model.context_length ?? null
        : null
      const apiEmbeddingDimensions = typeof model === 'object'
        ? (model.dimension ?? model.dimensions ?? model.embedding_dimensions ?? null)
        : null
      return inferModelConfig(providerType, id, displayName, 'remote', apiContextTokens, apiEmbeddingDimensions)
    })
    .filter(Boolean) as ModelConfig[]
}
