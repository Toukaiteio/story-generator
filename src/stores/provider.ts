import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { AgentType } from '@/types/agent'
import type { ModelConfig, ProviderConfig, ProviderModelRef, ProviderType } from '@/types/provider'
import { readJsonStorage, writeJsonStorage } from '@/lib/storage'
import {
  builtinModels,
  defaultBaseUrls,
  defaultProviderNames,
  createProviderIdFromName,
  decodeProviderModelRef,
  encodeProviderModelRef,
  formatModelLabel,
  defaultReasoningConfig,
  inferModelConfig,
  normalizeReasoningConfig,
  normalizeFetchedModels,
} from '@/services/provider/catalog'

const PROVIDER_STORAGE_KEY = 'story-generator.providers.v2'
const AGENT_MODEL_STORAGE_KEY = 'story-generator.agent-model-bindings.v2'
const EMBEDDING_MODEL_STORAGE_KEY = 'story-generator.embedding-model-binding.v1'
const MODEL_CONTEXT_STORAGE_KEY = 'story-generator.model-context-overrides.v1'
const TOOL_WORKFLOW_SETTINGS_STORAGE_KEY = 'story-generator.tool-workflow-settings.v1'
const DEFAULT_MAX_TOOL_CALL_ROUNDS = 16
export type IssueSeverityThreshold = 'low' | 'medium' | 'high'

const roleDefaults: Record<AgentType, 'expert' | 'standard'> = {
  outline: 'expert',
  detailer: 'expert',
  character: 'expert',
  storyPlanner: 'expert',
  chapterPlanner: 'expert',
  chapterTitlePlanner: 'expert',
  writer: 'expert',
  editingAI: 'expert',
  proofreader: 'standard',
  polisher: 'standard',
  relationshipTracker: 'standard',
  skillAgent: 'expert',
  proposerAgent: 'expert',
}

function cloneModel(model: ModelConfig): ModelConfig {
  return { ...model }
}

function sanitizeModel(model: Partial<ModelConfig> & { id: string }, fallbackSource: ModelConfig['source']): ModelConfig {
  const maxTokens = Number(model.maxTokens)
  const contextTokens = model.contextTokens != null ? Number(model.contextTokens) : null
  return {
    id: model.id,
    name: model.name?.trim() || model.id,
    tier: model.tier === 'standard' ? 'standard' : 'expert',
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 8192,
    contextTokens: contextTokens && Number.isFinite(contextTokens) && contextTokens > 0 ? contextTokens : null,
    contextTokensSource: model.contextTokensSource ?? null,
    supportsStreaming: model.supportsStreaming ?? true,
    supportsEmbeddings: model.supportsEmbeddings ?? false,
    embeddingDimensions: model.supportsEmbeddings
      ? (Number.isFinite(model.embeddingDimensions) && Number(model.embeddingDimensions) > 0
        ? Number(model.embeddingDimensions)
        : null)
      : null,
    source: model.source ?? fallbackSource,
    reasoning: normalizeReasoningConfig(model.reasoning),
  }
}

function normalizeProviderType(type?: string): ProviderType {
  if (type === 'anthropic' || type === 'google' || type === 'openai-responses') return type
  return 'openai'
}

function sanitizeProvider(provider: Partial<ProviderConfig>): ProviderConfig {
  const type = normalizeProviderType(provider.type)
  const builtinIds = new Set(builtinModels[type].map(model => model.id))
  const models = Array.isArray(provider.models) && provider.models.length
    ? provider.models.map(model => sanitizeModel(model, builtinIds.has(model.id) ? 'builtin' : 'custom'))
    : []

  return {
    id: provider.id?.trim() || createProviderIdFromName(provider.name?.trim() || defaultProviderNames[type]),
    type,
    name: provider.name?.trim() || defaultProviderNames[type],
    apiKey: provider.apiKey ?? '',
    baseUrl: provider.baseUrl?.trim() || defaultBaseUrls[type],
    models,
    isActive: provider.isActive ?? true,
    lastSyncedAt: provider.lastSyncedAt ?? null,
  }
}

function uniqueProviderId(baseId: string, usedIds: Set<string>) {
  const normalizedBase = baseId.trim() || 'provider'
  if (!usedIds.has(normalizedBase)) return normalizedBase

  let suffix = 2
  let candidate = `${normalizedBase}_${suffix}`
  while (usedIds.has(candidate)) {
    suffix += 1
    candidate = `${normalizedBase}_${suffix}`
  }
  return candidate
}

function normalizeLoadedProviders(rawProviders: ProviderConfig[]) {
  const usedIds = new Set<string>()
  const warnings: string[] = []

  const providers = rawProviders.map((provider) => {
    const baseId = provider.id?.trim() || createProviderIdFromName(provider.name)
    const id = uniqueProviderId(baseId, usedIds)
    if (id !== baseId) {
      warnings.push(`Duplicate provider ID "${baseId}" detected. It was renamed to "${id}" to keep model labels unique.`)
    }
    usedIds.add(id)
    return { ...provider, id }
  })

  return { providers, warnings }
}

function loadProviders() {
  const raw = readJsonStorage<Partial<ProviderConfig>[]>(PROVIDER_STORAGE_KEY, [])
  const sanitized = raw.map(provider => sanitizeProvider(provider))
  return normalizeLoadedProviders(sanitized)
}

function loadAgentBindings(): Record<AgentType, ProviderModelRef | null> {
  const raw = readJsonStorage<Record<string, ProviderModelRef | string | null>>(AGENT_MODEL_STORAGE_KEY, {
    outline: null,
    detailer: null,
    character: null,
    storyPlanner: null,
    chapterPlanner: null,
    chapterTitlePlanner: null,
    'story-planner': null,
    writer: null,
    editingAI: null,
    proofreader: null,
    polisher: null,
    relationshipTracker: null,
    skillAgent: null,
    proposerAgent: null,
  })

  return {
    outline: typeof raw.outline === 'string' ? decodeProviderModelRef(raw.outline) : raw.outline,
    detailer: typeof raw.detailer === 'string' ? decodeProviderModelRef(raw.detailer) : raw.detailer,
    character: typeof raw.character === 'string' ? decodeProviderModelRef(raw.character) : raw.character,
    storyPlanner: typeof raw.storyPlanner === 'string'
      ? decodeProviderModelRef(raw.storyPlanner)
      : typeof raw['story-planner'] === 'string'
        ? decodeProviderModelRef(raw['story-planner'])
        : raw.storyPlanner ?? raw['story-planner'] ?? null,
    chapterPlanner: typeof raw.chapterPlanner === 'string'
      ? decodeProviderModelRef(raw.chapterPlanner)
      : raw.chapterPlanner ?? null,
    chapterTitlePlanner: typeof raw.chapterTitlePlanner === 'string'
      ? decodeProviderModelRef(raw.chapterTitlePlanner)
      : (raw.chapterTitlePlanner as any) ?? null,
    writer: typeof raw.writer === 'string' ? decodeProviderModelRef(raw.writer) : raw.writer,
    editingAI: typeof raw.editingAI === 'string' ? decodeProviderModelRef(raw.editingAI) : raw.editingAI ?? null,
    proofreader: typeof raw.proofreader === 'string' ? decodeProviderModelRef(raw.proofreader) : raw.proofreader,
    polisher: typeof raw.polisher === 'string' ? decodeProviderModelRef(raw.polisher) : raw.polisher,
    relationshipTracker: typeof raw.relationshipTracker === 'string'
      ? decodeProviderModelRef(raw.relationshipTracker)
      : raw.relationshipTracker ?? null,
    skillAgent: typeof raw.skillAgent === 'string' ? decodeProviderModelRef(raw.skillAgent) : raw.skillAgent ?? null,
    proposerAgent: typeof raw.proposerAgent === 'string' ? decodeProviderModelRef(raw.proposerAgent) : raw.proposerAgent ?? null,
  }
}

function loadEmbeddingModelBinding(): ProviderModelRef | null {
  const raw = readJsonStorage<ProviderModelRef | string | null>(EMBEDDING_MODEL_STORAGE_KEY, null)
  if (typeof raw === 'string') {
    return decodeProviderModelRef(raw)
  }
  return raw
}

function loadModelContextOverrides(): Record<string, number> {
  const raw = readJsonStorage<Record<string, number | string | null>>(MODEL_CONTEXT_STORAGE_KEY, {})
  const overrides: Record<string, number> = {}

  for (const [key, value] of Object.entries(raw)) {
    const tokens = Number(value)
    if (Number.isFinite(tokens) && tokens > 0) {
      overrides[key] = tokens
    }
  }

  return overrides
}

function normalizeMaxToolCallRounds(value: unknown) {
  const rounds = Number(value)
  if (!Number.isFinite(rounds)) return DEFAULT_MAX_TOOL_CALL_ROUNDS
  return Math.max(1, Math.min(Math.trunc(rounds), 64))
}

function normalizeIssueSeverityThreshold(value: unknown): IssueSeverityThreshold {
  return value === 'medium' || value === 'high' ? value : 'low'
}

function loadToolWorkflowSettings() {
  const raw = readJsonStorage<{ maxToolCallRounds?: number | string; minIssueSeverity?: string }>(TOOL_WORKFLOW_SETTINGS_STORAGE_KEY, {})
  return {
    maxToolCallRounds: normalizeMaxToolCallRounds(raw.maxToolCallRounds),
    minIssueSeverity: normalizeIssueSeverityThreshold(raw.minIssueSeverity),
  }
}

function mergeModelSets(remoteModels: ModelConfig[], customModels: ModelConfig[]) {
  const merged = new Map<string, ModelConfig>()

  for (const model of remoteModels) {
    merged.set(model.id, cloneModel(model))
  }

  for (const model of customModels) {
    merged.set(model.id, cloneModel(model))
  }

  return [...merged.values()]
}

function mergeRefreshedModels(existingModels: ModelConfig[], remoteModels: ModelConfig[], customModels: ModelConfig[]) {
  const existingById = new Map(existingModels.map(model => [model.id, model]))

  const mergedRemote = remoteModels.map((model) => {
    const existing = existingById.get(model.id)
    if (!existing) return cloneModel(model)

    // Preserve manual overrides when refreshing remote model metadata.
    return cloneModel({
      ...model,
      contextTokens: existing.contextTokensSource === 'manual' ? existing.contextTokens : model.contextTokens,
      contextTokensSource: existing.contextTokensSource === 'manual'
        ? 'manual'
        : model.contextTokensSource,
    })
  })

  return mergeModelSets(mergedRemote, customModels)
}

function contextOverrideKey(providerId: string, modelId: string) {
  return encodeProviderModelRef({ providerId, modelId })
}

function pruneModelContextOverridesForProvider(
  overrides: Record<string, number>,
  providerId: string,
  validModelIds?: Set<string>
) {
  const prefix = `${providerId}::`
  for (const key of Object.keys(overrides)) {
    if (!key.startsWith(prefix)) continue
    const modelId = key.slice(prefix.length)
    if (validModelIds && !validModelIds.has(modelId)) {
      delete overrides[key]
    }
  }
}

function buildModelListEndpoints(provider: ProviderConfig) {
  const baseUrl = provider.baseUrl.replace(/\/+$/, '')
  let endpoints: string[]

  if (provider.type === 'anthropic') {
    endpoints = [
      baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`,
      baseUrl.endsWith('/v1') ? `${baseUrl.replace(/\/v1$/, '')}/v1/models` : `${baseUrl}/models`,
    ]
  } else if (provider.type === 'google') {
    endpoints = [
      `${baseUrl}/v1beta/models`,
      `${baseUrl}/v1/models`,
    ]
  } else {
    endpoints = [
      `${baseUrl}/models`,
      baseUrl.endsWith('/v1') ? `${baseUrl.replace(/\/v1$/, '')}/v1/models` : `${baseUrl}/v1/models`,
    ]
  }

  return [...new Set(endpoints.filter(Boolean))]
}

function isValidModelRef(providers: ProviderConfig[], ref: ProviderModelRef | null) {
  if (!ref) return false
  const provider = providers.find(item => item.id === ref.providerId && item.isActive)
  return !!provider && !!findModelForRef(provider, ref)
}

function isUsableChatModelRef(providers: ProviderConfig[], ref: ProviderModelRef | null) {
  if (!ref) return false
  const provider = providers.find(item => item.id === ref.providerId && item.isActive)
  const model = provider ? findModelForRef(provider, ref) : null
  return !!model && !model.supportsEmbeddings
}

function findModelForRef(provider: ProviderConfig, ref: ProviderModelRef | null) {
  if (!ref) return null
  return provider.models.find(model =>
    model.id === ref.modelId ||
    model.id === `${ref.providerId}/${ref.modelId}` ||
    (ref.modelId.includes('/') && model.id === ref.modelId.split('/').pop()) ||
    model.id.split('/').pop() === ref.modelId
  ) ?? null
}

function isValidEmbeddingModelRef(providers: ProviderConfig[], ref: ProviderModelRef | null) {
  if (!ref) return false
  const provider = providers.find(item => item.id === ref.providerId && item.isActive)
  return !!provider?.models.some(model => model.id === ref.modelId && model.supportsEmbeddings)
}

function pickModelRefForRole(providers: ProviderConfig[], role: AgentType): ProviderModelRef | null {
  const preferredTier = roleDefaults[role]
  const activeProviders = providers.filter(provider => provider.isActive)

  const preferredProvider = activeProviders.find(provider => provider.models.some(model => model.tier === preferredTier))
    ?? activeProviders.find(provider => provider.models.length > 0)

  if (!preferredProvider) return null

  const preferredModel = preferredProvider.models.find(model => model.tier === preferredTier)
    ?? preferredProvider.models[0]

  if (!preferredModel) return null

  return {
    providerId: preferredProvider.id,
    modelId: preferredModel.id,
  }
}

function pickEmbeddingModelRef(providers: ProviderConfig[]): ProviderModelRef | null {
  const activeProviders = providers.filter(provider => provider.isActive)
  const preferredProvider = activeProviders.find(provider => provider.models.some(model => model.supportsEmbeddings))
  if (!preferredProvider) return null

  const preferredModel = preferredProvider.models.find(model => model.supportsEmbeddings)
  if (!preferredModel) return null

  return {
    providerId: preferredProvider.id,
    modelId: preferredModel.id,
  }
}

async function fetchDirectModelList(provider: ProviderConfig) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if ((provider.type === 'openai' || provider.type === 'openai-responses') && provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`
  } else if (provider.type === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01'
    if (provider.apiKey) {
      headers['x-api-key'] = provider.apiKey
    }
  } else if (provider.type === 'google' && provider.apiKey) {
    headers['x-goog-api-key'] = provider.apiKey
  }

  const endpoints = buildModelListEndpoints(provider)
  let lastError: Error | null = null

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers,
      })

      if (response.ok) {
        return response.json()
      }

      const error = await response.text()
      lastError = new Error(`${provider.name} API error: ${response.status} - ${error}`)
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  const attempted = endpoints.join(' | ')
  throw new Error(
    `${provider.name} model sync failed after trying: ${attempted}${lastError ? `; last error: ${lastError.message}` : ''}`
  )
}

async function fetchProxyModelList(provider: ProviderConfig) {
  const response = await fetch('/api/provider/list-models', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: provider.type,
      apiKey: provider.apiKey || '',
      baseUrl: provider.baseUrl,
    }),
  })

  const payload = await response.json().catch(async () => ({
    error: await response.text(),
  }))

  if (!response.ok) {
    throw new Error(payload?.error || `${provider.name} API error: ${response.status}`)
  }

  return payload
}

export const useProviderStore = defineStore('provider', () => {
  const loaded = loadProviders()
  const providers = ref<ProviderConfig[]>(loaded.providers)
  const agentModelBindings = ref<Record<AgentType, ProviderModelRef | null>>(loadAgentBindings())
  const embeddingModelBinding = ref<ProviderModelRef | null>(loadEmbeddingModelBinding())
  const modelContextOverrides = ref<Record<string, number>>(loadModelContextOverrides())
  const toolWorkflowSettings = ref(loadToolWorkflowSettings())
  const syncingProviderIds = ref<string[]>([])
  const providerWarnings = ref<string[]>(loaded.warnings)

  const modelOptions = computed(() =>
    providers.value
      .filter(provider => provider.isActive)
      .flatMap(provider =>
        provider.models.map(model => ({
          value: encodeProviderModelRef({ providerId: provider.id, modelId: model.id }),
          label: formatModelLabel(provider.id, model.name),
          providerId: provider.id,
          modelId: model.id,
          providerName: provider.id,
          modelName: model.name,
          source: model.source,
          supportsEmbeddings: model.supportsEmbeddings,
          embeddingDimensions: model.embeddingDimensions ?? null,
        }))
      )
  )

  const embeddingModelOptions = computed(() =>
    modelOptions.value.filter(option => option.supportsEmbeddings)
  )

  watch(providers, value => writeJsonStorage(PROVIDER_STORAGE_KEY, value), { deep: true, flush: 'sync' })
  watch(agentModelBindings, value => writeJsonStorage(AGENT_MODEL_STORAGE_KEY, value), { deep: true, flush: 'sync' })
  watch(embeddingModelBinding, value => writeJsonStorage(EMBEDDING_MODEL_STORAGE_KEY, value), { deep: true, flush: 'sync' })
  watch(modelContextOverrides, value => writeJsonStorage(MODEL_CONTEXT_STORAGE_KEY, value), { deep: true, flush: 'sync' })
  watch(toolWorkflowSettings, value => writeJsonStorage(TOOL_WORKFLOW_SETTINGS_STORAGE_KEY, value), { deep: true, flush: 'sync' })

  function applyModelContextOverridesToProvider(provider: ProviderConfig) {
    pruneModelContextOverridesForProvider(
      modelContextOverrides.value,
      provider.id,
      new Set(provider.models.map(model => model.id))
    )

    for (const model of provider.models) {
      const key = contextOverrideKey(provider.id, model.id)
      const tokens = modelContextOverrides.value[key]
      if (Number.isFinite(tokens) && tokens > 0) {
        model.contextTokens = tokens
        model.contextTokensSource = 'manual'
      }
    }
  }

  function applyModelContextOverrides() {
    for (const provider of providers.value) {
      applyModelContextOverridesToProvider(provider)
    }
  }

  function reapplyModelContextOverridesForProvider(providerId: string) {
    const provider = getProviderById(providerId)
    if (!provider) return false
    applyModelContextOverridesToProvider(provider)
    return true
  }

  function normalizeProviderModels(provider: ProviderConfig) {
    const customModels = provider.models.filter(model => model.source === 'custom')
    const merged = mergeModelSets(
      provider.models.filter(model => model.source !== 'custom'),
      customModels
    )
    provider.models = merged
  }

  function getUniqueProviderIdForName(name: string) {
    const baseId = createProviderIdFromName(name)
    const usedIds = new Set(providers.value.map(provider => provider.id))
    return uniqueProviderId(baseId, usedIds)
  }

  function addProvider(data: { type: ProviderType; apiKey?: string | null; baseUrl: string; models?: ModelConfig[]; name?: string }) {
    const name = data.name?.trim()
    if (!name) {
      throw new Error('Provider name is required')
    }

    const baseId = createProviderIdFromName(name)
    const id = getUniqueProviderIdForName(name)
    if (id !== baseId) {
      providerWarnings.value = [...providerWarnings.value, `Provider ID "${baseId}" already exists. Saved as "${id}" instead.`]
    }

    const provider: ProviderConfig = {
      id,
      type: data.type,
      name,
      apiKey: data.apiKey ?? '',
      baseUrl: data.baseUrl,
      models: data.models?.length ? data.models.map(cloneModel) : [],
      isActive: true,
      lastSyncedAt: null,
    }

    providers.value.push(provider)
    ensureAgentModelBindings()
    ensureEmbeddingModelBinding()
    applyModelContextOverridesToProvider(provider)
    return provider
  }

  function updateProviderName(providerId: string, name: string) {
    const provider = getProviderById(providerId)
    if (!provider) throw new Error('Provider not found')

    const nextName = name.trim()
    if (!nextName) throw new Error('Provider name cannot be empty')

    provider.name = nextName
    return provider
  }

  function updateProviderConfig(
    providerId: string,
    data: {
      type: ProviderType
      name: string
      apiKey?: string | null
      baseUrl: string
      models: ModelConfig[]
    }
  ) {
    const provider = getProviderById(providerId)
    if (!provider) throw new Error('Provider not found')

    const nextName = data.name.trim()
    if (!nextName) throw new Error('Provider name cannot be empty')
    if (!data.models.length) throw new Error('Provider must have at least one model')

    const existingModelsById = new Map(provider.models.map(model => [model.id, model]))
    provider.type = data.type
    provider.name = nextName
    provider.apiKey = data.apiKey ?? ''
    provider.baseUrl = data.baseUrl.trim() || defaultBaseUrls[data.type]
    provider.models = data.models.map((model) => {
      const existing = existingModelsById.get(model.id)
      const sanitized = sanitizeModel(model, model.source)
      return {
        ...sanitized,
        contextTokens: existing?.contextTokens ?? sanitized.contextTokens,
        contextTokensSource: existing?.contextTokensSource ?? sanitized.contextTokensSource,
      }
    })

    applyModelContextOverridesToProvider(provider)
    ensureAgentModelBindings()
    ensureEmbeddingModelBinding()
    return provider
  }

  function removeProvider(id: string) {
    const index = providers.value.findIndex(provider => provider.id === id)
    if (index === -1) return
    providers.value.splice(index, 1)
    for (const key of Object.keys(modelContextOverrides.value)) {
      if (key.startsWith(`${id}::`)) {
        delete modelContextOverrides.value[key]
      }
    }
    for (const role of Object.keys(agentModelBindings.value) as AgentType[]) {
      const binding = agentModelBindings.value[role]
      if (binding?.providerId === id) {
        agentModelBindings.value[role] = pickModelRefForRole(providers.value, role)
      }
    }
    ensureAgentModelBindings()
    ensureEmbeddingModelBinding()
  }

  function getProviderForTier(tier: 'expert' | 'standard'): ProviderConfig | null {
    return providers.value.find(provider => provider.isActive && provider.models.some(model => model.tier === tier)) ?? null
  }

  function getProviderById(providerId: string) {
    return providers.value.find(provider => provider.id === providerId) ?? null
  }

  function getModelByRef(ref: ProviderModelRef | null) {
    if (!ref) return null
    const provider = getProviderById(ref.providerId)
    if (!provider) return null
    const model = findModelForRef(provider, ref)
    if (!model) return null
    return { provider, model }
  }

  function getModelLabel(ref: ProviderModelRef | null) {
    const match = getModelByRef(ref)
    if (!match) return ''
    return formatModelLabel(match.provider.id, match.model.name)
  }

  function isActiveChatModelRef(ref: ProviderModelRef | null) {
    return isUsableChatModelRef(providers.value, ref)
  }

  function getAgentModelBinding(role: AgentType) {
    return agentModelBindings.value[role] ?? null
  }

  function setAgentModelBinding(role: AgentType, ref: ProviderModelRef | null) {
    agentModelBindings.value[role] = ref
  }

  function getEmbeddingModelBinding() {
    return embeddingModelBinding.value
  }

  function setEmbeddingModelBinding(ref: ProviderModelRef | null) {
    embeddingModelBinding.value = ref
  }

  function ensureAgentModelBindings() {
    let changed = false
    for (const role of Object.keys(agentModelBindings.value) as AgentType[]) {
      if (!isValidModelRef(providers.value, agentModelBindings.value[role])) {
        agentModelBindings.value[role] = pickModelRefForRole(providers.value, role)
        changed = true
      }
    }

    if (changed) {
      writeJsonStorage(AGENT_MODEL_STORAGE_KEY, agentModelBindings.value)
    }
  }

  function ensureEmbeddingModelBinding() {
    if (isValidEmbeddingModelRef(providers.value, embeddingModelBinding.value)) {
      return
    }

    embeddingModelBinding.value = pickEmbeddingModelRef(providers.value)
    writeJsonStorage(EMBEDDING_MODEL_STORAGE_KEY, embeddingModelBinding.value)
  }

  function getModelOptionsForRole(role: AgentType) {
    const preferred = getAgentModelBinding(role)
    return modelOptions.value.map(option => ({
      ...option,
      selected: preferred?.providerId === option.providerId && preferred?.modelId === option.modelId,
    }))
  }

  function getEmbeddingModelOptions() {
    const preferred = getEmbeddingModelBinding()
    return embeddingModelOptions.value.map(option => ({
      ...option,
      selected: preferred?.providerId === option.providerId && preferred?.modelId === option.modelId,
    }))
  }

  async function requestModelList(provider: ProviderConfig) {
    if (window.electronAPI?.provider?.listModels) {
      const payload = await window.electronAPI?.provider?.listModels({
        type: provider.type,
        apiKey: provider.apiKey || '',
        baseUrl: provider.baseUrl,
      })
      return normalizeFetchedModels(provider.type, payload)
    }

    const payload = await fetchProxyModelList(provider)
    return normalizeFetchedModels(provider.type, payload)
  }

  async function previewModelList(request: { type: ProviderType; apiKey?: string | null; baseUrl: string }) {
    const type = normalizeProviderType(request.type)
    const provider: ProviderConfig = {
      id: 'preview-provider',
      type,
      name: defaultProviderNames[type],
      apiKey: request.apiKey ?? '',
      baseUrl: request.baseUrl,
      models: [],
      isActive: true,
      lastSyncedAt: null,
    }

    return requestModelList(provider)
  }

  async function refreshProviderModels(providerId: string) {
    const provider = getProviderById(providerId)
    if (!provider) throw new Error('Provider not found')

    if (!syncingProviderIds.value.includes(providerId)) {
      syncingProviderIds.value.push(providerId)
    }

    try {
      const remoteModels = await requestModelList(provider)
      if (!remoteModels.length) {
        throw new Error(`${provider.name} returned no models`)
      }

      const customModels = provider.models.filter(model => model.source === 'custom')
      provider.models = mergeRefreshedModels(provider.models, remoteModels, customModels)
      applyModelContextOverridesToProvider(provider)
      provider.lastSyncedAt = new Date().toISOString()
      ensureAgentModelBindings()
      ensureEmbeddingModelBinding()
      return provider.models
    } catch (error) {
      normalizeProviderModels(provider)
      throw error
    } finally {
      syncingProviderIds.value = syncingProviderIds.value.filter(id => id !== providerId)
    }
  }

  async function refreshAllProviderModels() {
    const results = await Promise.allSettled(
      providers.value.map(provider => refreshProviderModels(provider.id))
    )

    return results
  }

  function addCustomModel(providerId: string, model: Partial<ModelConfig> & { id: string; name: string }) {
    const provider = getProviderById(providerId)
    if (!provider) throw new Error('Provider not found')

    const nextModel = sanitizeModel({
      ...model,
      source: 'custom',
      reasoning: model.reasoning ?? defaultReasoningConfig(),
    }, 'custom')

    const index = provider.models.findIndex(item => item.id === nextModel.id)
    if (index === -1) {
      provider.models.push(nextModel)
    } else {
      provider.models[index] = nextModel
    }

    provider.lastSyncedAt = provider.lastSyncedAt ?? new Date().toISOString()
    ensureAgentModelBindings()
    ensureEmbeddingModelBinding()
    applyModelContextOverridesToProvider(provider)
    return nextModel
  }

  function getDefaultModelRefForRole(role: AgentType) {
    return pickModelRefForRole(providers.value, role)
  }

  function getAvailableModelRefForRole(role: AgentType, preferred?: ProviderModelRef | null) {
    if (isUsableChatModelRef(providers.value, preferred ?? null)) {
      return preferred ?? null
    }

    const binding = getAgentModelBinding(role)
    if (isUsableChatModelRef(providers.value, binding)) {
      return binding
    }

    return getDefaultModelRefForRole(role)
  }

  function requireAgentModelRef(role: AgentType) {
    const binding = getAgentModelBinding(role)
    if (binding && !isUsableChatModelRef(providers.value, binding)) {
      const fallback = getDefaultModelRefForRole(role)
      if (fallback) return fallback
      throw new Error(`Configured model for ${role} is unavailable or inactive: ${binding.providerId}/${binding.modelId}. Enable the provider, refresh the provider model list, or select another model.`)
    }

    const fallback = binding ?? getDefaultModelRefForRole(role)
    if (!fallback) {
      throw new Error(`No model available for ${role}. Please configure a provider first.`)
    }
    return fallback
  }

  function resolveModelRef(value: string | ProviderModelRef | null | undefined) {
    if (!value) return null
    if (typeof value === 'string') return decodeProviderModelRef(value)
    return value
  }

  function isRefreshingProvider(providerId: string) {
    return syncingProviderIds.value.includes(providerId)
  }

  function setModelContextTokens(providerId: string, modelId: string, contextTokens: number | null) {
    const provider = getProviderById(providerId)
    if (!provider) return false
    const model = provider.models.find(m => m.id === modelId)
    if (!model) return false
    if (import.meta.env.DEV) {
      console.debug('[providerStore] setModelContextTokens', { providerId, modelId, contextTokens })
    }
    if (contextTokens && contextTokens > 0) {
      const key = contextOverrideKey(providerId, modelId)
      model.contextTokens = contextTokens
      model.contextTokensSource = 'manual'
      modelContextOverrides.value[key] = contextTokens
    } else {
      delete modelContextOverrides.value[contextOverrideKey(providerId, modelId)]
      model.contextTokens = null
      model.contextTokensSource = null
    }
    return true
  }

  function clearModelContextTokens(providerId: string, modelId: string) {
    const provider = getProviderById(providerId)
    if (!provider) return false
    const model = provider.models.find(m => m.id === modelId)
    if (!model) return false
    if (import.meta.env.DEV) {
      console.debug('[providerStore] clearModelContextTokens', { providerId, modelId })
    }
    // Revert to fallback
    const fallback = provider.type === 'anthropic' || provider.type === 'openai' || provider.type === 'openai-responses' || provider.type === 'google'
      ? inferContextTokensForModel(provider.type, modelId)
      : null
    delete modelContextOverrides.value[contextOverrideKey(providerId, modelId)]
    model.contextTokens = fallback
    model.contextTokensSource = fallback ? 'fallback' : null
    return true
  }

  function setMaxToolCallRounds(rounds: number) {
    toolWorkflowSettings.value = {
      ...toolWorkflowSettings.value,
      maxToolCallRounds: normalizeMaxToolCallRounds(rounds),
    }
  }

  function setMinIssueSeverity(severity: IssueSeverityThreshold) {
    toolWorkflowSettings.value = {
      ...toolWorkflowSettings.value,
      minIssueSeverity: normalizeIssueSeverityThreshold(severity),
    }
  }

  function inferContextTokensForModel(providerType: ProviderType, modelId: string): number | null {
    // Re-use the fallback tables from catalog
    const openaiTable: Record<string, number> = {
      'gpt-4o': 128000, 'gpt-4o-mini': 128000, 'gpt-4-turbo': 128000,
      'gpt-4': 8192, 'gpt-4-32k': 32768, 'gpt-3.5-turbo': 16385,
      'o1': 200000, 'o1-mini': 128000, 'o1-pro': 200000,
      'o3': 200000, 'o3-mini': 200000, 'o4-mini': 200000,
      'gpt-4.1': 1047576, 'gpt-4.1-mini': 1047576, 'gpt-4.1-nano': 1047576,
      'gpt-5': 1047576, 'gpt-5-mini': 1047576, 'gpt-5-nano': 1047576,
    }
    const anthropicTable: Record<string, number> = {
      'claude-opus-4-20250514': 200000, 'claude-sonnet-4-20250514': 200000,
      'claude-haiku-4-20250414': 200000, 'claude-3-5-sonnet-20241022': 200000,
      'claude-3-5-haiku-20241022': 200000, 'claude-3-opus-20240229': 200000,
    }
    const id = modelId.toLowerCase()
    const googleTable: Record<string, number> = {
      'gemini-2.5-pro': 1048576, 'gemini-2.5-flash': 1048576,
      'gemini-2.0-flash': 1048576, 'gemini-2.0-flash-lite': 1048576,
      'gemini-1.5-pro': 2097152, 'gemini-1.5-flash': 1048576,
    }
    const table = providerType === 'openai' || providerType === 'openai-responses' ? openaiTable : providerType === 'google' ? googleTable : anthropicTable
    if (table[id]) return table[id]
    if (providerType === 'openai' || providerType === 'openai-responses') {
      if (id.includes('gpt-4.1') || id.includes('gpt-5')) return 1047576
      if (id.includes('gpt-4o') || id.includes('gpt-4-turbo')) return 128000
      if (id.includes('o1') || id.includes('o3') || id.includes('o4')) return 200000
      if (id.includes('gpt-4')) return 8192
      if (id.includes('gpt-3.5')) return 16385
    }
    if (providerType === 'anthropic' && id.includes('claude')) return 200000
    if (providerType === 'google' && id.includes('gemini')) return 1048576
    return null
  }

  ensureAgentModelBindings()
  ensureEmbeddingModelBinding()
  applyModelContextOverrides()

  return {
    providers,
    agentModelBindings,
    embeddingModelBinding,
    toolWorkflowSettings,
    syncingProviderIds,
    providerWarnings,
    modelOptions,
    embeddingModelOptions,
    addProvider,
    getUniqueProviderIdForName,
    updateProviderName,
    updateProviderConfig,
    removeProvider,
    getProviderForTier,
    getProviderById,
    getModelByRef,
    getModelLabel,
    isActiveChatModelRef,
    getAgentModelBinding,
    setAgentModelBinding,
    getEmbeddingModelBinding,
    setEmbeddingModelBinding,
    ensureAgentModelBindings,
    ensureEmbeddingModelBinding,
    reapplyModelContextOverridesForProvider,
    getModelOptionsForRole,
    getEmbeddingModelOptions,
    refreshProviderModels,
    refreshAllProviderModels,
    previewModelList,
    addCustomModel,
    getDefaultModelRefForRole,
    getAvailableModelRefForRole,
    requireAgentModelRef,
    resolveModelRef,
    isRefreshingProvider,
    setModelContextTokens,
    clearModelContextTokens,
    setMaxToolCallRounds,
    setMinIssueSeverity,
  }
})
