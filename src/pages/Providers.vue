<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useProviderStore } from '@/stores/provider'
import { providerManager } from '@/services/provider'
import { useToast } from '@/composables/useToast'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import VibeModelPicker from '@/components/workspace/VibeModelPicker.vue'
import {
  Server,
  Plus,
  Key,
  Trash2,
  X,
  Zap,
  RefreshCw,
  Bot,
  Sparkles,
  BookOpen,
  Wand2,
  PenTool,
  Pencil,
  CheckCircle,
  XCircle,
  Loader,
  Network,
  Wrench,
  ChevronDown,
} from 'lucide-vue-next'
import type { AgentType } from '@/types/agent'
import type { ModelSource, ModelConfig, ReasoningEffort, ProviderType } from '@/types/provider'
import {
  createCustomModelDraft,
  createProviderIdFromName,
  decodeProviderModelRef,
  encodeProviderModelRef,
  formatModelLabel,
  defaultBaseUrls,
} from '@/services/provider/catalog'

const ui = useUiStore()
const providerStore = useProviderStore()
const toast = useToast()

function tr(value: string) {
  return ui.text(value)
}

onMounted(() => {
  ui.navigateTo('providers')
  void syncProviderModels()
})

const showAddDrawer = ref(false)
const showEditProviderDrawer = ref(false)
const showDeleteConfirm = ref(false)
const showCustomModelDrawer = ref(false)
const activeProviderTab = ref<'providers' | 'mapping'>('providers')
const pendingDeleteId = ref<string | null>(null)
const expandedProviderModelIds = ref<Set<string>>(new Set())
const bulkAgentModelValue = ref('')
const testEmbeddingLoading = ref(false)
const testEmbeddingResult = ref<{ ok: boolean; dimensions?: number; error?: string; modelLabel?: string } | null>(null)

const newProvider = ref({
  type: 'openai' as ProviderType,
  name: '',
  apiKey: '',
  baseUrl: '',
})

const editingProviderForm = ref({
  providerId: '',
  type: 'openai' as ProviderType,
  name: '',
  apiKey: '',
  baseUrl: '',
})

interface ModelDraft {
  id: string
  name: string
  tier: 'expert' | 'standard'
  maxTokens: string
  supportsStreaming: boolean
  supportsEmbeddings: boolean
  embeddingDimensions: string
  source: ModelSource
  reasoning: {
    enabled: boolean
    effort: ReasoningEffort
  }
}

const providerModelDrafts = ref<ModelDraft[]>([])

const customModelForm = reactive({
  providerId: '',
  id: '',
  name: '',
  tier: 'standard' as 'expert' | 'standard',
  maxTokens: '8192',
  supportsStreaming: true,
  supportsEmbeddings: false,
  embeddingDimensions: '',
  reasoningEnabled: false,
  reasoningEffort: 'medium' as ReasoningEffort,
})

const providerTypeOptions = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'OpenAI Responses', value: 'openai-responses' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'Google GenAI', value: 'google' },
]

const providerOptions = computed(() =>
  providerStore.providers.map(provider => ({
    label: `${provider.name} (${provider.id})`,
    value: provider.id,
  }))
)

const previewProviderId = computed(() => providerStore.getUniqueProviderIdForName(newProvider.value.name))
const baseProviderId = computed(() => createProviderIdFromName(newProvider.value.name))
const providerIdCollision = computed(() =>
  !!newProvider.value.name.trim() && previewProviderId.value !== baseProviderId.value
)

const chatModelCount = computed(() =>
  providerStore.modelOptions.filter(option => !option.supportsEmbeddings).length
)
const embeddingModelOptions = computed(() =>
  providerStore.getEmbeddingModelOptions().map(option => ({
    label: option.label,
    value: option.value,
  }))
)

const roleOptions: Array<{ id: AgentType; label: string; icon: any; description: string }> = [
  { id: 'outline', label: 'Outline Agent', icon: Bot, description: 'Story structure and premise' },
  { id: 'detailer', label: 'Detailer Agent', icon: Wand2, description: 'Refine user-authored story configuration' },
  { id: 'character', label: 'Character Agent', icon: Sparkles, description: 'Character design and relationship setup' },
  { id: 'storyPlanner', label: 'Story Planner Agent', icon: Bot, description: 'Combined planning fallback for outline and cast generation' },
  { id: 'chapterPlanner', label: 'Chapter Planner Agent', icon: BookOpen, description: 'Tool-driven chapter-by-chapter planning' },
  { id: 'chapterTitlePlanner', label: 'Chapter Title Planner Agent', icon: BookOpen, description: 'Generate concise chapter titles from chapter plans' },
  { id: 'writer', label: 'Writer Agent', icon: PenTool, description: 'Chapter drafting and scene writing' },
  { id: 'editingAI', label: 'Editing AI', icon: Pencil, description: 'Chapter audit and issue repair coordination' },
  { id: 'relationshipTracker', label: 'Relationship Tracker', icon: Network, description: 'Extract chapter-by-chapter relationship changes' },
  { id: 'skillAgent', label: 'Skill Agent', icon: Wrench, description: 'Plan, normalize, execute, and verify approved meeting tool changes' },
  { id: 'proposerAgent', label: 'Meeting Proposer Agent', icon: Sparkles, description: 'Internal meeting proposal synthesis and action role' },
  { id: 'proofreader', label: 'Proofreader Agent', icon: RefreshCw, description: 'Consistency and grammar review' },
  { id: 'polisher', label: 'Polisher Agent', icon: Zap, description: 'Language enhancement and final polish' },
]

const providerTabOptions = [
  { id: 'providers', label: 'Providers', description: 'Manage provider connections and model lists' },
  { id: 'mapping', label: 'Agent Binding', description: 'Bind role models and the default embedding model' },
]

const editingContext = ref<{ providerId: string; modelId: string; value: string | number } | null>(null)

function startEditContext(providerId: string, modelId: string, currentTokens: number | null | undefined) {
  editingContext.value = {
    providerId,
    modelId,
    value: currentTokens ? String(currentTokens) : '',
  }
}

function saveContextEdit() {
  if (!editingContext.value) return
  const { providerId, modelId, value } = editingContext.value
  const tokens = String(value).trim() ? Number(String(value).trim()) : null
  if (import.meta.env.DEV) {
    console.debug('[Providers] saveContextEdit', { providerId, modelId, value, tokens })
  }
  if (tokens !== null && (!Number.isFinite(tokens) || tokens <= 0)) {
    toast.warning('Context window must be a positive number')
    return
  }
  try {
    const updated = providerStore.setModelContextTokens(providerId, modelId, tokens)
    if (!updated) {
      toast.error('Failed to update context window')
      return
    }
    editingContext.value = null
    toast.success(tokens ? 'Context window updated' : 'Context window cleared')
  } catch (error: any) {
    toast.error(error?.message || 'Failed to update context window')
  }
}

function revertContextToAuto(providerId: string, modelId: string) {
  if (import.meta.env.DEV) {
    console.debug('[Providers] revertContextToAuto', { providerId, modelId })
  }
  const updated = providerStore.clearModelContextTokens(providerId, modelId)
  if (!updated) {
    toast.error('Failed to restore automatic context window')
    return
  }
  editingContext.value = null
  toast.success('Reverted to auto-detected context window')
}

function formatContextTokens(tokens: number | null | undefined): string {
  if (!tokens) return 'Unknown'
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

function contextSourceLabel(source: string | null | undefined): string {
  if (source === 'api') return 'API'
  if (source === 'manual') return 'Manual'
  if (source === 'fallback') return 'Fallback'
  return ''
}

function contextSourceVariant(source: string | null | undefined): 'accent' | 'warning' | 'success' | 'default' {
  if (source === 'api') return 'success'
  if (source === 'manual') return 'warning'
  if (source === 'fallback') return 'accent'
  return 'default'
}

function createDraftFromModel(model: ModelConfig): ModelDraft {
  return {
    id: model.id,
    name: model.name,
    tier: model.tier,
    maxTokens: String(model.maxTokens),
    supportsStreaming: model.supportsStreaming,
    supportsEmbeddings: model.supportsEmbeddings,
    embeddingDimensions: model.embeddingDimensions ? String(model.embeddingDimensions) : '',
    source: model.source,
    reasoning: {
      enabled: model.reasoning?.enabled ?? false,
      effort: model.reasoning?.effort ?? 'medium',
    },
  }
}

function createBlankDraft(providerType: ProviderType): ModelDraft {
  return createDraftFromModel(createCustomModelDraft(providerType, '', '', 'custom'))
}

function buildModelsFromDrafts(drafts: ModelDraft[]) {
  const modelsMap = new Map<string, {
    id: string
    name: string
    tier: 'expert' | 'standard'
    maxTokens: number
    supportsStreaming: boolean
    supportsEmbeddings: boolean
    embeddingDimensions: number | null
    source: ModelSource
    reasoning: {
      enabled: boolean
      effort: ReasoningEffort
    }
  }>()

  for (const model of drafts) {
    if (!model.id.trim()) continue
    modelsMap.set(model.id.trim(), {
      id: model.id.trim(),
      name: model.name.trim() || model.id.trim(),
      tier: model.tier,
      maxTokens: Number(model.maxTokens) || 8192,
      supportsStreaming: model.supportsStreaming,
      supportsEmbeddings: model.supportsEmbeddings,
      embeddingDimensions: model.supportsEmbeddings
        ? (Number(model.embeddingDimensions) || null)
        : null,
      source: model.source,
      reasoning: {
        enabled: model.reasoning.enabled,
        effort: model.reasoning.effort,
      },
    })
  }

  return [...modelsMap.values()]
}

function resetDraftModels(providerType: ProviderType) {
  providerModelDrafts.value = []
  void syncDraftModels(
    {
      type: providerType,
      apiKey: newProvider.value.apiKey,
      baseUrl: newProvider.value.baseUrl,
    },
    true
  )
}

function loadProviderDraft(providerId: string) {
  const provider = providerStore.getProviderById(providerId)
  if (!provider) return

  editingProviderForm.value = {
    providerId: provider.id,
    type: provider.type,
    name: provider.name,
    apiKey: provider.apiKey ?? '',
    baseUrl: provider.baseUrl ?? '',
  }
  providerModelDrafts.value = provider.models.map(model => createDraftFromModel(model))
}

function addDraftModel(providerType: ProviderType = newProvider.value.type) {
  providerModelDrafts.value.push(createBlankDraft(providerType))
}

function removeDraftModel(index: number) {
  providerModelDrafts.value.splice(index, 1)
}

async function syncDraftModels(
  request: { type: ProviderType; apiKey?: string | null; baseUrl?: string } = {
    type: newProvider.value.type,
    apiKey: newProvider.value.apiKey,
    baseUrl: newProvider.value.baseUrl,
  },
  silent = false
) {
  try {
    const models = await providerStore.previewModelList({
      type: request.type,
      apiKey: request.apiKey || '',
      baseUrl: request.baseUrl || defaultBaseUrls[request.type],
    })

    const existingCustomModels = providerModelDrafts.value.filter(model => model.source === 'custom')
    const nextDrafts = new Map<string, ModelDraft>()

    for (const model of models) {
      nextDrafts.set(model.id, createDraftFromModel(model))
    }

    for (const model of existingCustomModels) {
      if (!nextDrafts.has(model.id)) {
        nextDrafts.set(model.id, model)
      }
    }

    providerModelDrafts.value = [...nextDrafts.values()]
    if (!silent) {
      toast.success('Model list synced')
    }
  } catch (error: any) {
    if (!silent) {
      toast.error(error?.message || 'Failed to sync model list')
    }
  }
}

function syncEditDraftModels() {
  void syncDraftModels(
    {
      type: editingProviderForm.value.type,
      apiKey: editingProviderForm.value.apiKey,
      baseUrl: editingProviderForm.value.baseUrl,
    },
    false
  )
}

watch(
  () => newProvider.value.type,
  (type) => {
    if (showAddDrawer.value) {
      resetDraftModels(type)
    }
  }
)

watch(showAddDrawer, (open) => {
  if (open) {
    resetDraftModels(newProvider.value.type)
  }
})

watch(
  () => editingProviderForm.value.type,
  (type) => {
    if (showEditProviderDrawer.value) {
      void syncDraftModels(
        {
          type,
          apiKey: editingProviderForm.value.apiKey,
          baseUrl: editingProviderForm.value.baseUrl,
        },
        true
      )
    }
  }
)

async function syncProviderModels(providerId?: string) {
  const targets = providerId
    ? providerStore.providers.filter(provider => provider.id === providerId)
    : providerStore.providers

  if (!targets.length) return { failures: 0 }

  const results = await Promise.allSettled(
    targets.map(provider => providerStore.refreshProviderModels(provider.id))
  )

  const failures = results.filter(result => result.status === 'rejected')
  if (failures.length) {
    toast.warning(`Model sync completed with ${failures.length} failed provider(s).`)
  } else if (providerId) {
    toast.success('Model list refreshed')
  }

  return { failures: failures.length }
}

async function addProvider() {
  const models = buildModelsFromDrafts(providerModelDrafts.value)

  if (!models.length) {
    toast.warning('Please add at least one model before saving')
    return
  }

  const provider = providerStore.addProvider({
    type: newProvider.value.type,
    name: newProvider.value.name,
    apiKey: newProvider.value.apiKey,
    baseUrl: newProvider.value.baseUrl || defaultBaseUrls[newProvider.value.type],
    models,
  })

  newProvider.value = { type: 'openai', name: '', apiKey: '', baseUrl: '' }
  providerModelDrafts.value = []
  showAddDrawer.value = false
  toast.success(`Provider ${provider.name} added`)
}

function openEditProviderDrawer(providerId: string) {
  loadProviderDraft(providerId)
  showAddDrawer.value = false
  showCustomModelDrawer.value = false
  showEditProviderDrawer.value = true
}

function cancelEditProviderDrawer() {
  showEditProviderDrawer.value = false
  editingProviderForm.value = {
    providerId: '',
    type: 'openai',
    name: '',
    apiKey: '',
    baseUrl: '',
  }
  providerModelDrafts.value = []
}

function saveEditedProvider() {
  const providerId = editingProviderForm.value.providerId
  const provider = providerStore.getProviderById(providerId)
  if (!provider) {
    toast.error('Provider not found')
    return
  }

  const name = editingProviderForm.value.name.trim()
  if (!name) {
    toast.error('Provider name is required')
    return
  }

  const models = buildModelsFromDrafts(providerModelDrafts.value)
  if (!models.length) {
    toast.warning('Please keep at least one model')
    return
  }

  try {
    const updatedProvider = providerStore.updateProviderConfig(providerId, {
      type: editingProviderForm.value.type,
      name,
      apiKey: editingProviderForm.value.apiKey,
      baseUrl: editingProviderForm.value.baseUrl || defaultBaseUrls[editingProviderForm.value.type],
      models,
    })

    showEditProviderDrawer.value = false
    providerModelDrafts.value = []
    toast.success(`Provider ${updatedProvider.name} updated`)
  } catch (error: any) {
    toast.error(error?.message || 'Failed to update provider')
  }
}

async function refreshProvider(providerId: string) {
  try {
    await syncProviderModels(providerId)
  } catch (error: any) {
    toast.error(error?.message || 'Failed to refresh provider models')
  }
}

function openCustomModelDrawer(providerId: string) {
  customModelForm.providerId = providerId
  customModelForm.id = ''
  customModelForm.name = ''
  customModelForm.tier = 'standard'
  customModelForm.maxTokens = '8192'
  customModelForm.supportsStreaming = true
  customModelForm.supportsEmbeddings = false
  customModelForm.embeddingDimensions = ''
  customModelForm.reasoningEnabled = false
  customModelForm.reasoningEffort = 'medium'
  showCustomModelDrawer.value = true
}

function saveCustomModel() {
  if (!customModelForm.providerId || !customModelForm.id.trim()) {
    toast.warning('Model id is required')
    return
  }

  providerStore.addCustomModel(customModelForm.providerId, {
    id: customModelForm.id.trim(),
    name: customModelForm.name.trim() || customModelForm.id.trim(),
    tier: customModelForm.tier,
    maxTokens: Number(customModelForm.maxTokens) || 8192,
    supportsStreaming: customModelForm.supportsStreaming,
    supportsEmbeddings: customModelForm.supportsEmbeddings,
    embeddingDimensions: customModelForm.supportsEmbeddings
      ? (Number(customModelForm.embeddingDimensions) || null)
      : null,
    source: 'custom',
    reasoning: {
      enabled: customModelForm.reasoningEnabled,
      effort: customModelForm.reasoningEffort,
    },
  })

  providerStore.ensureAgentModelBindings()
  showCustomModelDrawer.value = false
  toast.success('Custom model added')
}

function handleDelete(id: string) {
  pendingDeleteId.value = id
  showDeleteConfirm.value = true
}

function confirmDelete() {
  if (pendingDeleteId.value) {
    providerStore.removeProvider(pendingDeleteId.value)
    pendingDeleteId.value = null
    toast.success('Provider removed')
  }
}

function selectedRoleValue(role: AgentType) {
  const binding = providerStore.getAgentModelBinding(role)
  return binding ? encodeProviderModelRef(binding) : ''
}

function updateRoleModel(role: AgentType, value: string) {
  providerStore.setAgentModelBinding(role, value ? decodeProviderModelRef(value) : null)
}

function applyModelToAllAgents() {
  const modelRef = decodeProviderModelRef(bulkAgentModelValue.value)
  if (!modelRef) {
    toast.warning('Select a model before applying it to all Agents')
    return
  }

  for (const role of roleOptions) {
    providerStore.setAgentModelBinding(role.id, modelRef)
  }
  toast.success('All Agent bindings updated')
}

function selectedEmbeddingValue() {
  const binding = providerStore.getEmbeddingModelBinding()
  return binding ? encodeProviderModelRef(binding) : ''
}

function updateEmbeddingModel(value: string) {
  providerStore.setEmbeddingModelBinding(value ? decodeProviderModelRef(value) : null)
  testEmbeddingResult.value = null
}

async function testEmbeddingModel() {
  const binding = providerStore.getEmbeddingModelBinding()
  if (!binding) {
    toast.warning('No embedding model selected')
    return
  }

  testEmbeddingLoading.value = true
  testEmbeddingResult.value = null

  providerManager.setProviders(providerStore.providers)
  const provider = providerManager.getModelConfigForRef(binding)
  if (!provider) {
    testEmbeddingResult.value = { ok: false, error: 'Provider not found or inactive' }
    testEmbeddingLoading.value = false
    return
  }

  const modelLabel = `${provider.provider.id}/${provider.model.name}`
  const baseUrl = provider.provider.baseUrl.replace(/\/+$/, '')
  const apiKey = provider.provider.apiKey ?? ''
  const providerType = provider.provider.type

  try {
    let response: Response
    if (providerType === 'google') {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (apiKey) headers['x-goog-api-key'] = apiKey
      response = await fetch(`${baseUrl}/v1beta/models/${binding.modelId}:embedContent`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content: { parts: [{ text: 'Hello, world!' }] } }),
      })
    } else {
      response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey ? `Bearer ${apiKey}` : '',
        },
        body: JSON.stringify({
          model: binding.modelId,
          input: 'Hello, world!',
        }),
      })
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      throw new Error(`${response.status} ${errorText}`)
    }

    const payload = await response.json()
    let embedding: unknown
    if (providerType === 'google') {
      embedding = payload?.embedding?.values
    } else {
      embedding = payload?.data?.[0]?.embedding
    }
    if (!Array.isArray(embedding)) {
      throw new Error('API response did not contain embedding data')
    }

    testEmbeddingResult.value = {
      ok: true,
      dimensions: embedding.length,
      modelLabel,
    }
    toast.success(`Test successful — ${embedding.length} dimensions`)
  } catch (error: any) {
    testEmbeddingResult.value = {
      ok: false,
      error: error?.message || 'Embedding test failed',
      modelLabel,
    }
    toast.error(`Embedding test failed: ${error?.message || 'Unknown error'}`)
  } finally {
    testEmbeddingLoading.value = false
  }
}

function modelTagVariant(source: string) {
  if (source === 'custom') return 'warning'
  if (source === 'remote') return 'accent'
  return 'success'
}

function toggleProviderModels(providerId: string) {
  if (expandedProviderModelIds.value.has(providerId)) {
    expandedProviderModelIds.value.delete(providerId)
  } else {
    expandedProviderModelIds.value.add(providerId)
  }
}

function formatSyncedTime(value?: string | null) {
  if (!value) return 'Never synced'
  return new Date(value).toLocaleString()
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <div class="flex items-center justify-between px-6 py-4 border-b border-surface-4 shrink-0">
      <div>
        <h1 class="text-lg font-semibold text-text-primary">{{ tr('Providers') }}</h1>
        <p class="text-xs text-text-secondary mt-0.5">
          {{ tr('Configure providers, sync model lists, and bind models to each Agent role') }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <BaseButton
          variant="secondary"
          size="sm"
          :loading="providerStore.syncingProviderIds.length > 0"
          :disabled="!providerStore.providers.length"
          @click="syncProviderModels()"
        >
          <RefreshCw :size="14" />
          <span>{{ tr('Sync Models') }}</span>
        </BaseButton>
        <BaseButton variant="primary" size="sm" @click="showAddDrawer = true">
          <Plus :size="14" />
          <span>{{ tr('Add Provider') }}</span>
        </BaseButton>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-6">
      <div class="max-w-5xl mx-auto space-y-4">
        <div
          v-if="providerStore.providerWarnings.length"
          class="rounded-lg border border-warning/30 bg-warning-subtle/60 px-4 py-3 text-xs text-warning"
        >
          <p class="font-medium">{{ tr('Duplicate provider IDs were detected and renamed automatically.') }}</p>
          <p class="mt-1">
            {{ tr('Model labels use `ProviderID/Model`, so the affected providers were adjusted to keep labels unique.') }}
          </p>
        </div>

        <div class="flex items-center justify-between gap-4">
          <div>
            <h2 class="text-sm font-semibold text-text-primary">{{ tr('Provider Center') }}</h2>
            <p class="text-xs text-text-secondary mt-0.5">
              {{ tr('Keep provider setup and Agent bindings in separate views.') }}
            </p>
          </div>
          <div class="flex items-center gap-2 rounded-xl border border-surface-4 bg-surface-2 p-1">
            <button
              v-for="tab in providerTabOptions"
              :key="tab.id"
              type="button"
              class="min-w-[132px] rounded-lg px-3 py-2 text-left transition-colors duration-100"
              :class="activeProviderTab === tab.id
                ? 'bg-accent-subtle text-accent'
                : 'text-text-secondary hover:bg-surface-3 hover:text-text-primary'"
              @click="activeProviderTab = tab.id as 'providers' | 'mapping'"
            >
              <div class="text-sm font-medium">{{ tr(tab.label) }}</div>
              <div class="text-2xs mt-0.5 opacity-80">{{ tr(tab.description) }}</div>
            </button>
          </div>
        </div>

        <BaseCard v-if="activeProviderTab === 'mapping'" padding="md">
          <div class="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 class="text-sm font-semibold text-text-primary">{{ tr('Agent Model Mapping') }}</h2>
              <p class="text-xs text-text-secondary mt-0.5">
                {{ tr('Bind a specific model to each Agent role. These settings are saved automatically.') }}
              </p>
            </div>
            <BaseTag variant="accent" size="sm">{{ tr('Role-level configuration') }}</BaseTag>
          </div>

          <div v-if="providerStore.providers.length" class="space-y-4">
            <div class="rounded-lg border border-surface-4 bg-surface-1 p-4">
              <div class="flex flex-col gap-3 md:flex-row md:items-end">
                <div class="min-w-0 flex-1">
                  <h3 class="text-sm font-semibold text-text-primary">{{ tr('Apply One Model to All Agents') }}</h3>
                  <p class="mt-0.5 text-xs text-text-secondary">
                    {{ tr('Choose a chat model, then update every Agent binding at once.') }}
                  </p>
                  <div class="mt-3">
                    <VibeModelPicker
                      v-model="bulkAgentModelValue"
                      variant="inline"
                      :fallback-label="chatModelCount ? 'Select model' : 'No models available'"
                      :disabled="!chatModelCount"
                    />
                  </div>
                </div>
                <BaseButton
                  variant="primary"
                  size="sm"
                  class="md:mb-0.5"
                  :disabled="!chatModelCount || !bulkAgentModelValue"
                  @click="applyModelToAllAgents"
                >
                  <Wand2 :size="14" />
                  <span>{{ tr('Apply to All Agents') }}</span>
                </BaseButton>
              </div>
            </div>

            <div
              v-for="role in roleOptions"
              :key="role.id"
              class="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)] items-start"
            >
              <div class="flex items-start gap-3">
                <div class="w-9 h-9 rounded-lg bg-surface-3 flex items-center justify-center shrink-0">
                  <component :is="role.icon" :size="16" class="text-accent" />
                </div>
                <div>
                  <h3 class="text-sm font-medium text-text-primary">{{ tr(role.label) }}</h3>
                  <p class="text-xs text-text-secondary mt-0.5">{{ tr(role.description) }}</p>
                </div>
              </div>
              <VibeModelPicker
                :model-value="selectedRoleValue(role.id)"
                :role="role.id"
                variant="inline"
                :fallback-label="chatModelCount ? 'Select model' : 'No models available'"
                :disabled="!chatModelCount"
                @update:model-value="value => updateRoleModel(role.id, value)"
              />
            </div>

            <div class="mt-5 rounded-lg border border-surface-4 bg-surface-1 p-4">
              <div class="flex items-center justify-between gap-3 mb-3">
                <div>
                  <h3 class="text-sm font-semibold text-text-primary">{{ tr('Embedding Model') }}</h3>
                  <p class="text-xs text-text-secondary mt-0.5">
                    {{ tr('Used as the default embedding model for Knowledge Base vector and hybrid modes.') }}
                  </p>
                </div>
                <BaseTag variant="accent" size="sm">{{ tr('Global default') }}</BaseTag>
              </div>

              <BaseSelect
                :model-value="selectedEmbeddingValue()"
                :options="embeddingModelOptions"
                :placeholder="embeddingModelOptions.length ? 'Select embedding model' : 'No embedding-capable models available'"
                :disabled="!embeddingModelOptions.length"
                @update:model-value="updateEmbeddingModel"
              />

              <div class="mt-3 flex items-start gap-3">
                <BaseButton
                  variant="secondary"
                  size="sm"
                  :disabled="!selectedEmbeddingValue() || testEmbeddingLoading"
                  :loading="testEmbeddingLoading"
                  @click="testEmbeddingModel"
                >
                  <template v-if="!testEmbeddingLoading">
                    <Zap :size="14" />
                  </template>
                  <span>{{ tr('Test') }}</span>
                </BaseButton>

                <div v-if="testEmbeddingResult" class="flex items-center gap-2 text-2xs">
                  <template v-if="testEmbeddingResult.ok">
                    <CheckCircle :size="14" class="text-success shrink-0" />
                    <span class="text-text-primary">
                      {{ testEmbeddingResult.dimensions }} dimensions
                    </span>
                    <span class="text-text-muted truncate max-w-[200px]">
                      · {{ testEmbeddingResult.modelLabel }}
                    </span>
                  </template>
                  <template v-else>
                    <XCircle :size="14" class="text-danger shrink-0" />
                    <span class="text-danger truncate max-w-[280px]">
                      {{ testEmbeddingResult.error }}
                    </span>
                  </template>
                </div>
              </div>

              <p class="text-2xs text-text-muted mt-2">
                {{ tr('Only models marked as embedding-capable are shown here.') }}
              </p>
            </div>
          </div>

          <EmptyState
            v-else
            :icon="Server"
            title="No providers configured"
            description="Add a provider first, then come back to bind models to each Agent role."
          >
            <template #action>
              <BaseButton variant="primary" size="sm" @click="showAddDrawer = true">
                <Plus :size="14" />
                <span>{{ tr('Add Provider') }}</span>
              </BaseButton>
            </template>
          </EmptyState>
        </BaseCard>

        <template v-else>
          <EmptyState
            v-if="!providerStore.providers.length"
            :icon="Server"
            title="No providers configured"
            description="Add a provider, sync its model list, and then map models to your story agents."
          >
            <template #action>
              <BaseButton variant="primary" size="sm" @click="showAddDrawer = true">
                <Plus :size="14" />
                <span>{{ tr('Add Provider') }}</span>
              </BaseButton>
            </template>
          </EmptyState>

          <div v-else class="space-y-3">
          <BaseCard
            v-for="provider in providerStore.providers"
            :key="provider.id"
            padding="md"
          >
            <div class="flex flex-col gap-4">
              <div class="flex items-start justify-between gap-3">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-lg bg-surface-3 flex items-center justify-center">
                    <Zap :size="18" class="text-accent" />
                  </div>
                  <div>
                    <h3 class="text-sm font-semibold text-text-primary">{{ provider.name }}</h3>
                    <p class="text-xs text-text-muted">
                      ID: {{ provider.id }} · {{ provider.type }} · {{ provider.models.length }} models
                    </p>
                    <p class="text-xs text-text-muted mt-0.5">
                      Synced: {{ formatSyncedTime(provider.lastSyncedAt) }}
                    </p>
                    <p class="text-xs text-text-muted mt-0.5 break-all">
                      Base URL: {{ provider.baseUrl }}
                    </p>
                    <p class="text-xs text-text-muted mt-0.5">
                      Provider ID: {{ provider.id }}
                    </p>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <BaseTag :variant="provider.isActive ? 'success' : 'default'" size="sm">
                    {{ tr(provider.isActive ? 'Active' : 'Inactive') }}
                  </BaseTag>
                  <BaseButton
                    variant="secondary"
                    size="sm"
                    :loading="providerStore.isRefreshingProvider(provider.id)"
                    @click="refreshProvider(provider.id)"
                  >
                    <RefreshCw :size="14" />
                    <span>{{ tr('Sync') }}</span>
                  </BaseButton>
                  <BaseButton
                    variant="secondary"
                    size="sm"
                    @click="openEditProviderDrawer(provider.id)"
                  >
                    <Pencil :size="14" />
                    <span>{{ tr('Edit Config') }}</span>
                  </BaseButton>
                  <BaseButton
                    variant="secondary"
                    size="sm"
                    @click="openCustomModelDrawer(provider.id)"
                  >
                    <Plus :size="14" />
                    <span>{{ tr('Custom Model') }}</span>
                  </BaseButton>
                  <button
                    class="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-danger hover:bg-danger-subtle transition-colors duration-100"
                    @click="handleDelete(provider.id)"
                  >
                    <Trash2 :size="14" />
                  </button>
                </div>
              </div>

              <div v-if="provider.models.length" class="rounded-lg border border-surface-4 bg-surface-1">
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface-2 transition-colors duration-100"
                  @click="toggleProviderModels(provider.id)"
                >
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-text-primary">{{ tr('Models') }}</p>
                    <p class="text-xs text-text-muted">
                      {{ provider.models.length }} {{ tr('configured model(s)') }}
                    </p>
                  </div>
                  <ChevronDown
                    :size="16"
                    class="shrink-0 text-text-muted transition-transform"
                    :class="expandedProviderModelIds.has(provider.id) ? 'rotate-180' : ''"
                  />
                </button>

                <div
                  v-if="expandedProviderModelIds.has(provider.id)"
                  class="grid gap-2 border-t border-surface-4 p-3 md:grid-cols-2"
                >
                  <div
                    v-for="model in provider.models"
                    :key="model.id"
                    class="rounded-lg border border-surface-4 bg-surface-2 px-3 py-2"
                >
                  <div class="flex items-center justify-between gap-2">
                    <div class="min-w-0">
                      <p class="text-sm font-medium text-text-primary truncate">
                        {{ formatModelLabel(provider.id, model.name) }}
                      </p>
                      <p class="text-xs text-text-muted mt-0.5 truncate">
                        {{ model.id }}
                      </p>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                      <BaseTag :variant="model.tier === 'expert' ? 'accent' : 'default'" size="sm">
                        {{ model.tier }}
                      </BaseTag>
                      <BaseTag :variant="modelTagVariant(model.source)" size="sm">
                        {{ model.source }}
                      </BaseTag>
                      <BaseTag v-if="model.reasoning?.enabled" variant="warning" size="sm">
                        reasoning {{ model.reasoning.effort }}
                      </BaseTag>
                    </div>
                  </div>

                  <!-- Context Window Row -->
                  <div class="mt-2 pt-2 border-t border-surface-4/50">
                    <div
                      v-if="editingContext?.providerId === provider.id && editingContext?.modelId === model.id"
                      class="flex items-center gap-2"
                    >
                      <input
                        v-model="editingContext.value"
                        type="number"
                        min="1"
                        placeholder="e.g. 128000"
                        class="flex-1 h-7 rounded border border-surface-4 bg-surface-2 px-2 text-xs text-text-primary outline-none focus:border-accent"
                        @keydown.enter="saveContextEdit"
                        @keydown.escape="editingContext = null"
                      />
                      <button
                        type="button"
                        class="h-7 px-2 rounded bg-accent text-white text-2xs font-medium hover:bg-accent/80 transition-colors"
                        @click="saveContextEdit"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        class="h-7 px-2 rounded border border-surface-4 text-2xs text-text-secondary hover:bg-surface-3 transition-colors"
                        @click="editingContext = null"
                      >
                        Cancel
                      </button>
                    </div>
                    <div v-else class="flex items-center justify-between gap-2">
                      <div class="flex items-center gap-1.5">
                        <span class="text-2xs text-text-muted">{{ tr('Context') }}:</span>
                        <span class="text-2xs font-medium text-text-primary">
                          {{ formatContextTokens(model.contextTokens) }}
                        </span>
                        <BaseTag
                          v-if="model.contextTokensSource"
                          :variant="contextSourceVariant(model.contextTokensSource)"
                          size="sm"
                        >
                          {{ contextSourceLabel(model.contextTokensSource) }}
                        </BaseTag>
                      </div>
                      <div class="flex items-center gap-1">
                        <button
                          type="button"
                          class="text-2xs text-accent hover:underline"
                          @click="startEditContext(provider.id, model.id, model.contextTokens)"
                        >
                          {{ tr('Edit') }}
                        </button>
                        <button
                          type="button"
                          v-if="model.contextTokensSource === 'manual'"
                          class="text-2xs text-text-muted hover:text-text-secondary hover:underline"
                          @click="revertContextToAuto(provider.id, model.id)"
                        >
                          {{ tr('Auto') }}
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- Embedding Dimensions Row -->
                  <div v-if="model.supportsEmbeddings && model.embeddingDimensions" class="mt-1.5 flex items-center gap-1.5">
                    <span class="text-2xs text-text-muted">{{ tr('Dimensions') }}:</span>
                    <span class="text-2xs font-medium text-text-primary">{{ model.embeddingDimensions }}</span>
                  </div>
                </div>
              </div>
              </div>
              </div>
            </BaseCard>
          </div>
        </template>
      </div>
    </div>

    <!-- Add Provider Drawer -->
    <Transition name="backdrop">
      <div
        v-if="showAddDrawer"
        class="fixed inset-0 z-[100] bg-black/60"
        @mousedown.self="showAddDrawer = false"
      >
        <Transition name="slide-right" appear>
          <div
            v-if="showAddDrawer"
            class="absolute right-0 top-0 h-full w-[400px] bg-surface-1 border-l border-surface-4 shadow-2xl flex flex-col"
          >
            <div class="flex items-center justify-between px-5 py-4 border-b border-surface-4 shrink-0">
              <h2 class="text-base font-semibold text-text-primary">{{ tr('Add Provider') }}</h2>
              <button
                class="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors duration-100"
                @click="showAddDrawer = false"
              >
                <X :size="16" />
              </button>
            </div>
            <div class="flex-1 min-h-0 overflow-hidden px-5 py-4 flex flex-col gap-4">
              <BaseSelect
                v-model="newProvider.type"
                label="Provider"
                :options="providerTypeOptions"
              />
              <BaseInput
                v-model="newProvider.name"
                label="Provider Name"
                placeholder="e.g. Production OpenAI"
              />
              <p class="text-xs text-text-muted -mt-2">
                {{ tr('Required. Generated Provider ID:') }}
                <span class="font-mono text-text-primary">{{ previewProviderId }}</span>
              </p>
              <p v-if="providerIdCollision" class="text-xs text-warning -mt-2 leading-relaxed">
                {{ tr('This ID already exists, so a suffix will be appended automatically to keep model labels unique.') }}
              </p>
              <BaseInput
                v-model="newProvider.apiKey"
                label="API Key (optional)"
                type="password"
                placeholder="Leave empty if not needed"
                :icon="Key"
              />
              <BaseInput
                v-model="newProvider.baseUrl"
                label="Base URL (optional)"
                :placeholder="defaultBaseUrls[newProvider.type] || ''"
              />
              <p
                v-if="(newProvider.type === 'openai' || newProvider.type === 'openai-responses') && newProvider.baseUrl && !newProvider.baseUrl.includes('/v1')"
                class="text-xs text-warning leading-relaxed"
              >
                {{ tr('Reminder: this URL does not contain /v1. Keep it unchanged if your provider or proxy uses a root-level API.') }}
              </p>
              <div class="mt-1 flex-1 min-h-0 flex flex-col">
                <div class="flex items-center justify-between gap-2 mb-2">
                  <div>
                    <p class="text-xs font-medium text-text-secondary">{{ tr('Model Drafts') }}</p>
                    <p class="text-2xs text-text-muted mt-0.5">
                      {{ tr('Auto-sync a first draft, then edit the actual models you want to save.') }}
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <BaseButton type="button" variant="secondary" size="sm" @click="() => syncDraftModels()">
                      <RefreshCw :size="14" />
                      <span>{{ tr('Sync') }}</span>
                    </BaseButton>
                    <BaseButton type="button" variant="secondary" size="sm" @click="() => addDraftModel()">
                      <Plus :size="14" />
                      <span>{{ tr('Add') }}</span>
                    </BaseButton>
                  </div>
                </div>

                <div class="flex-1 min-h-0 space-y-3 overflow-y-auto pr-1">
                  <div
                    v-for="(model, index) in providerModelDrafts"
                    :key="`${model.id || 'draft'}-${index}`"
                    class="rounded-lg border border-surface-4 bg-surface-2 p-3"
                  >
                    <div class="flex items-start justify-between gap-2 mb-3">
                      <div>
                        <p class="text-sm font-medium text-text-primary">
                          {{ model.name || model.id || tr('New model') }}
                        </p>
                        <p class="text-xs text-text-muted mt-0.5">
                          {{ model.id || tr('Model ID required') }}
                        </p>
                      </div>
                      <button
                        class="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-danger hover:bg-danger-subtle transition-colors duration-100"
                        @click="removeDraftModel(index)"
                      >
                        <Trash2 :size="14" />
                      </button>
                    </div>

                    <div class="grid grid-cols-2 gap-2">
                      <BaseInput v-model="model.id" label="Model ID" placeholder="e.g. gpt-4o-mini" />
                      <BaseInput v-model="model.name" label="Display Name" placeholder="e.g. GPT-4o Mini" />
                    </div>

                    <div class="grid grid-cols-2 gap-2 mt-2">
                      <BaseSelect
                        v-model="model.tier"
                        label="Tier"
                        :options="[
                          { label: 'Expert', value: 'expert' },
                          { label: 'Standard', value: 'standard' },
                        ]"
                      />
                      <BaseInput v-model="model.maxTokens" label="Max Tokens" type="number" min="1" />
                    </div>

                    <div class="mt-2">
                      <p class="text-xs font-medium text-text-secondary mb-1.5">{{ tr('Streaming') }}</p>
                      <div class="flex gap-2">
                        <button
                          type="button"
                          class="flex-1 h-9 rounded-md border text-sm transition-colors duration-100"
                          :class="model.supportsStreaming
                            ? 'border-accent bg-accent-subtle text-accent'
                            : 'border-surface-4 bg-surface-1 text-text-secondary hover:border-surface-5'"
                          @click="model.supportsStreaming = true"
                        >
                          {{ tr('Supported') }}
                        </button>
                        <button
                          type="button"
                          class="flex-1 h-9 rounded-md border text-sm transition-colors duration-100"
                          :class="!model.supportsStreaming
                            ? 'border-accent bg-accent-subtle text-accent'
                            : 'border-surface-4 bg-surface-1 text-text-secondary hover:border-surface-5'"
                          @click="model.supportsStreaming = false"
                        >
                          {{ tr('Disabled') }}
                        </button>
                      </div>
                    </div>

                    <div class="mt-2">
                      <p class="text-xs font-medium text-text-secondary mb-1.5">{{ tr('Embedding') }}</p>
                      <div class="flex gap-2">
                        <button
                          type="button"
                          class="flex-1 h-9 rounded-md border text-sm transition-colors duration-100"
                          :class="model.supportsEmbeddings
                            ? 'border-accent bg-accent-subtle text-accent'
                            : 'border-surface-4 bg-surface-1 text-text-secondary hover:border-surface-5'"
                          @click="model.supportsEmbeddings = true"
                        >
                          {{ tr('Supported') }}
                        </button>
                        <button
                          type="button"
                          class="flex-1 h-9 rounded-md border text-sm transition-colors duration-100"
                          :class="!model.supportsEmbeddings
                            ? 'border-accent bg-accent-subtle text-accent'
                            : 'border-surface-4 bg-surface-1 text-text-secondary hover:border-surface-5'"
                          @click="model.supportsEmbeddings = false"
                        >
                          {{ tr('Disabled') }}
                        </button>
                      </div>
                      <BaseInput
                        v-if="model.supportsEmbeddings"
                        v-model="model.embeddingDimensions"
                        label="Embedding Dimensions"
                        type="number"
                        min="1"
                        placeholder="e.g. 1536"
                        class="mt-2"
                      />
                    </div>

                    <div class="mt-3 rounded-md border border-surface-4 bg-surface-1 p-3">
                      <div class="flex items-center justify-between gap-2 mb-2">
                        <div>
                          <p class="text-xs font-medium text-text-secondary">{{ tr('Reasoning') }}</p>
                          <p class="text-2xs text-text-muted mt-0.5">
                            {{ tr('Optional reasoning profile for this model.') }}
                          </p>
                        </div>
                        <button
                          type="button"
                          class="px-2.5 h-7 rounded-md border text-xs transition-colors duration-100"
                          :class="model.reasoning.enabled
                            ? 'border-accent bg-accent-subtle text-accent'
                            : 'border-surface-4 bg-surface-1 text-text-secondary hover:border-surface-5'"
                          @click="model.reasoning.enabled = !model.reasoning.enabled"
                        >
                          {{ tr(model.reasoning.enabled ? 'Enabled' : 'Disabled') }}
                        </button>
                      </div>

                      <BaseSelect
                        v-model="model.reasoning.effort"
                        label="Effort"
                        :disabled="!model.reasoning.enabled"
                        :options="[
                          { label: 'Minimal', value: 'minimal' },
                          { label: 'Low', value: 'low' },
                          { label: 'Medium', value: 'medium' },
                          { label: 'High', value: 'high' },
                          { label: 'Max', value: 'max' },
                        ]"
                      />
                    </div>
                  </div>

                  <EmptyState
                    v-if="!providerModelDrafts.length"
                    :icon="Server"
                    title="No models drafted"
                    description="Open this panel and wait for the auto-sync, or click Sync to fetch the model list."
                  />
                </div>
              </div>
            </div>
            <div class="px-5 py-3 border-t border-surface-4 shrink-0 flex justify-end gap-2">
              <BaseButton variant="ghost" size="sm" @click="showAddDrawer = false">{{ tr('Cancel') }}</BaseButton>
              <BaseButton
                variant="primary"
                size="sm"
                :disabled="!newProvider.name.trim()"
                @click="addProvider"
              >
                {{ tr('Add Provider') }}
              </BaseButton>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

    <!-- Edit Provider Drawer -->
    <Transition name="backdrop">
      <div
        v-if="showEditProviderDrawer"
        class="fixed inset-0 z-[105] bg-black/60"
        @mousedown.self="cancelEditProviderDrawer"
      >
        <Transition name="slide-right" appear>
          <div
            v-if="showEditProviderDrawer"
            class="absolute right-0 top-0 h-full w-[400px] bg-surface-1 border-l border-surface-4 shadow-2xl flex flex-col"
          >
            <div class="flex items-center justify-between px-5 py-4 border-b border-surface-4 shrink-0">
              <h2 class="text-base font-semibold text-text-primary">{{ tr('Edit Provider') }}</h2>
              <button
                class="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors duration-100"
                @click="cancelEditProviderDrawer"
              >
                <X :size="16" />
              </button>
            </div>
            <div class="flex-1 min-h-0 overflow-hidden px-5 py-4 flex flex-col gap-4">
              <BaseSelect
                v-model="editingProviderForm.type"
                label="Provider"
                :options="providerTypeOptions"
              />
              <BaseInput
                v-model="editingProviderForm.name"
                label="Provider Name"
                placeholder="e.g. Production OpenAI"
              />
              <p class="text-xs text-text-muted -mt-2">
                {{ tr('Provider ID:') }}
                <span class="font-mono text-text-primary">{{ editingProviderForm.providerId }}</span>
              </p>
              <BaseInput
                v-model="editingProviderForm.apiKey"
                label="API Key (optional)"
                type="password"
                placeholder="Leave empty if not needed"
                :icon="Key"
              />
              <BaseInput
                v-model="editingProviderForm.baseUrl"
                label="Base URL (optional)"
                :placeholder="defaultBaseUrls[editingProviderForm.type] || ''"
              />
              <p
                v-if="(editingProviderForm.type === 'openai' || editingProviderForm.type === 'openai-responses') && editingProviderForm.baseUrl && !editingProviderForm.baseUrl.includes('/v1')"
                class="text-xs text-warning leading-relaxed"
              >
                {{ tr('Reminder: this URL does not contain /v1. Keep it unchanged if your provider or proxy uses a root-level API.') }}
              </p>
              <div class="mt-1 flex-1 min-h-0 flex flex-col">
                <div class="flex items-center justify-between gap-2 mb-2">
                  <div>
                    <p class="text-xs font-medium text-text-secondary">{{ tr('Model Drafts') }}</p>
                    <p class="text-2xs text-text-muted mt-0.5">
                      {{ tr("Edit the provider's actual models and sync new ones if needed.") }}
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <BaseButton type="button" variant="secondary" size="sm" @click="syncEditDraftModels">
                      <RefreshCw :size="14" />
                      <span>{{ tr('Sync') }}</span>
                    </BaseButton>
                    <BaseButton type="button" variant="secondary" size="sm" @click="addDraftModel(editingProviderForm.type)">
                      <Plus :size="14" />
                      <span>{{ tr('Add') }}</span>
                    </BaseButton>
                  </div>
                </div>

                <div class="flex-1 min-h-0 space-y-3 overflow-y-auto pr-1">
                  <div
                    v-for="(model, index) in providerModelDrafts"
                    :key="`${model.id || 'draft'}-${index}`"
                    class="rounded-lg border border-surface-4 bg-surface-2 p-3"
                  >
                    <div class="flex items-start justify-between gap-2 mb-3">
                      <div>
                        <p class="text-sm font-medium text-text-primary">
                          {{ model.name || model.id || tr('New model') }}
                        </p>
                        <p class="text-xs text-text-muted mt-0.5">
                          {{ model.id || tr('Model ID required') }}
                        </p>
                      </div>
                      <button
                        class="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-danger hover:bg-danger-subtle transition-colors duration-100"
                        @click="removeDraftModel(index)"
                      >
                        <Trash2 :size="14" />
                      </button>
                    </div>

                    <div class="grid grid-cols-2 gap-2">
                      <BaseInput v-model="model.id" label="Model ID" placeholder="e.g. gpt-4o-mini" />
                      <BaseInput v-model="model.name" label="Display Name" placeholder="e.g. GPT-4o Mini" />
                    </div>

                    <div class="grid grid-cols-2 gap-2 mt-2">
                      <BaseSelect
                        v-model="model.tier"
                        label="Tier"
                        :options="[
                          { label: 'Expert', value: 'expert' },
                          { label: 'Standard', value: 'standard' },
                        ]"
                      />
                      <BaseInput v-model="model.maxTokens" label="Max Tokens" type="number" min="1" />
                    </div>

                    <div class="mt-2">
                      <p class="text-xs font-medium text-text-secondary mb-1.5">{{ tr('Streaming') }}</p>
                      <div class="flex gap-2">
                        <button
                          type="button"
                          class="flex-1 h-9 rounded-md border text-sm transition-colors duration-100"
                          :class="model.supportsStreaming
                            ? 'border-accent bg-accent-subtle text-accent'
                            : 'border-surface-4 bg-surface-1 text-text-secondary hover:border-surface-5'"
                          @click="model.supportsStreaming = true"
                        >
                          {{ tr('Supported') }}
                        </button>
                        <button
                          type="button"
                          class="flex-1 h-9 rounded-md border text-sm transition-colors duration-100"
                          :class="!model.supportsStreaming
                            ? 'border-accent bg-accent-subtle text-accent'
                            : 'border-surface-4 bg-surface-1 text-text-secondary hover:border-surface-5'"
                          @click="model.supportsStreaming = false"
                        >
                          {{ tr('Disabled') }}
                        </button>
                      </div>
                    </div>

                    <div class="mt-2">
                      <p class="text-xs font-medium text-text-secondary mb-1.5">{{ tr('Embedding') }}</p>
                      <div class="flex gap-2">
                        <button
                          type="button"
                          class="flex-1 h-9 rounded-md border text-sm transition-colors duration-100"
                          :class="model.supportsEmbeddings
                            ? 'border-accent bg-accent-subtle text-accent'
                            : 'border-surface-4 bg-surface-1 text-text-secondary hover:border-surface-5'"
                          @click="model.supportsEmbeddings = true"
                        >
                          {{ tr('Supported') }}
                        </button>
                        <button
                          type="button"
                          class="flex-1 h-9 rounded-md border text-sm transition-colors duration-100"
                          :class="!model.supportsEmbeddings
                            ? 'border-accent bg-accent-subtle text-accent'
                            : 'border-surface-4 bg-surface-1 text-text-secondary hover:border-surface-5'"
                          @click="model.supportsEmbeddings = false"
                        >
                          {{ tr('Disabled') }}
                        </button>
                      </div>
                      <BaseInput
                        v-if="model.supportsEmbeddings"
                        v-model="model.embeddingDimensions"
                        label="Embedding Dimensions"
                        type="number"
                        min="1"
                        placeholder="e.g. 1536"
                        class="mt-2"
                      />
                    </div>

                    <div class="mt-3 rounded-md border border-surface-4 bg-surface-1 p-3">
                      <div class="flex items-center justify-between gap-2 mb-2">
                        <div>
                          <p class="text-xs font-medium text-text-secondary">{{ tr('Reasoning') }}</p>
                          <p class="text-2xs text-text-muted mt-0.5">
                            {{ tr('Optional reasoning profile for this model.') }}
                          </p>
                        </div>
                        <button
                          type="button"
                          class="px-2.5 h-7 rounded-md border text-xs transition-colors duration-100"
                          :class="model.reasoning.enabled
                            ? 'border-accent bg-accent-subtle text-accent'
                            : 'border-surface-4 bg-surface-1 text-text-secondary hover:border-surface-5'"
                          @click="model.reasoning.enabled = !model.reasoning.enabled"
                        >
                          {{ tr(model.reasoning.enabled ? 'Enabled' : 'Disabled') }}
                        </button>
                      </div>

                      <BaseSelect
                        v-model="model.reasoning.effort"
                        label="Effort"
                        :disabled="!model.reasoning.enabled"
                        :options="[
                          { label: 'Minimal', value: 'minimal' },
                          { label: 'Low', value: 'low' },
                          { label: 'Medium', value: 'medium' },
                          { label: 'High', value: 'high' },
                          { label: 'Max', value: 'max' },
                        ]"
                      />
                    </div>
                  </div>

                  <EmptyState
                    v-if="!providerModelDrafts.length"
                    :icon="Server"
                    title="No models drafted"
                    description="Open this panel and wait for the auto-sync, or click Sync to fetch the model list."
                  />
                </div>
              </div>
            </div>
            <div class="px-5 py-3 border-t border-surface-4 shrink-0 flex justify-end gap-2">
              <BaseButton variant="ghost" size="sm" @click="cancelEditProviderDrawer">{{ tr('Cancel') }}</BaseButton>
              <BaseButton
                variant="primary"
                size="sm"
                :disabled="!editingProviderForm.name.trim()"
                @click="saveEditedProvider"
              >
                {{ tr('Save Changes') }}
              </BaseButton>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

    <!-- Custom Model Drawer -->
    <Transition name="backdrop">
      <div
        v-if="showCustomModelDrawer"
        class="fixed inset-0 z-[110] bg-black/60"
        @mousedown.self="showCustomModelDrawer = false"
      >
        <Transition name="slide-right" appear>
          <div
            v-if="showCustomModelDrawer"
            class="absolute right-0 top-0 h-full w-[420px] bg-surface-1 border-l border-surface-4 shadow-2xl flex flex-col"
          >
            <div class="flex items-center justify-between px-5 py-4 border-b border-surface-4 shrink-0">
              <h2 class="text-base font-semibold text-text-primary">{{ tr('Add Custom Model') }}</h2>
              <button
                class="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors duration-100"
                @click="showCustomModelDrawer = false"
              >
                <X :size="16" />
              </button>
            </div>

            <div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
              <BaseSelect
                v-model="customModelForm.providerId"
                label="Provider"
                :options="providerOptions"
                placeholder="Choose provider"
              />
              <BaseInput
                v-model="customModelForm.id"
                label="Model ID"
                placeholder="e.g. gpt-4.1-mini"
              />
              <BaseInput
                v-model="customModelForm.name"
                label="Display Name"
                placeholder="e.g. GPT-4.1 Mini"
              />
              <BaseSelect
                v-model="customModelForm.tier"
                label="Tier"
                :options="[
                  { label: 'Expert', value: 'expert' },
                  { label: 'Standard', value: 'standard' },
                ]"
              />
              <BaseInput
                v-model="customModelForm.maxTokens"
                label="Max Tokens"
                type="number"
                min="1"
              />
              <div class="flex flex-col gap-1.5">
                <label class="text-xs font-medium text-text-secondary">{{ tr('Streaming') }}</label>
                <div class="flex gap-2">
                  <button
                    type="button"
                    class="flex-1 h-9 rounded-md border text-sm transition-colors duration-100"
                    :class="customModelForm.supportsStreaming
                      ? 'border-accent bg-accent-subtle text-accent'
                      : 'border-surface-4 bg-surface-1 text-text-secondary hover:border-surface-5'"
                    @click="customModelForm.supportsStreaming = true"
                  >
                    {{ tr('Supported') }}
                  </button>
                  <button
                    type="button"
                    class="flex-1 h-9 rounded-md border text-sm transition-colors duration-100"
                    :class="!customModelForm.supportsStreaming
                      ? 'border-accent bg-accent-subtle text-accent'
                      : 'border-surface-4 bg-surface-1 text-text-secondary hover:border-surface-5'"
                    @click="customModelForm.supportsStreaming = false"
                  >
                    {{ tr('Disabled') }}
                  </button>
                </div>
              </div>

              <div class="flex flex-col gap-1.5">
                <label class="text-xs font-medium text-text-secondary">{{ tr('Embedding') }}</label>
                <div class="flex gap-2">
                  <button
                    type="button"
                    class="flex-1 h-9 rounded-md border text-sm transition-colors duration-100"
                    :class="customModelForm.supportsEmbeddings
                      ? 'border-accent bg-accent-subtle text-accent'
                      : 'border-surface-4 bg-surface-1 text-text-secondary hover:border-surface-5'"
                    @click="customModelForm.supportsEmbeddings = true"
                  >
                    {{ tr('Supported') }}
                  </button>
                  <button
                    type="button"
                    class="flex-1 h-9 rounded-md border text-sm transition-colors duration-100"
                    :class="!customModelForm.supportsEmbeddings
                      ? 'border-accent bg-accent-subtle text-accent'
                      : 'border-surface-4 bg-surface-1 text-text-secondary hover:border-surface-5'"
                    @click="customModelForm.supportsEmbeddings = false"
                  >
                    {{ tr('Disabled') }}
                  </button>
                </div>
                <BaseInput
                  v-if="customModelForm.supportsEmbeddings"
                  v-model="customModelForm.embeddingDimensions"
                  label="Embedding Dimensions"
                  type="number"
                  min="1"
                  placeholder="e.g. 1536"
                />
              </div>

              <div class="rounded-lg border border-surface-4 bg-surface-2 p-3">
                <div class="flex items-center justify-between gap-2 mb-2">
                  <div>
                    <p class="text-xs font-medium text-text-secondary">{{ tr('Reasoning') }}</p>
                    <p class="text-2xs text-text-muted mt-0.5">
                      {{ tr('Configure an optional reasoning profile for this model.') }}
                    </p>
                  </div>
                  <button
                    type="button"
                    class="px-2.5 h-7 rounded-md border text-xs transition-colors duration-100"
                    :class="customModelForm.reasoningEnabled
                      ? 'border-accent bg-accent-subtle text-accent'
                      : 'border-surface-4 bg-surface-1 text-text-secondary hover:border-surface-5'"
                    @click="customModelForm.reasoningEnabled = !customModelForm.reasoningEnabled"
                  >
                    {{ tr(customModelForm.reasoningEnabled ? 'Enabled' : 'Disabled') }}
                  </button>
                </div>
                <BaseSelect
                  v-model="customModelForm.reasoningEffort"
                  label="Effort"
                  :disabled="!customModelForm.reasoningEnabled"
                  :options="[
                    { label: 'Minimal', value: 'minimal' },
                    { label: 'Low', value: 'low' },
                    { label: 'Medium', value: 'medium' },
                    { label: 'High', value: 'high' },
                    { label: 'Max', value: 'max' },
                  ]"
                />
              </div>
            </div>

            <div class="px-5 py-3 border-t border-surface-4 shrink-0 flex justify-end gap-2">
              <BaseButton variant="ghost" size="sm" @click="showCustomModelDrawer = false">{{ tr('Cancel') }}</BaseButton>
              <BaseButton
                variant="primary"
                size="sm"
                :disabled="!customModelForm.providerId || !customModelForm.id.trim()"
                @click="saveCustomModel"
              >
                {{ tr('Save Model') }}
              </BaseButton>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

    <ConfirmDialog
      v-model="showDeleteConfirm"
      title="Remove Provider"
      message="This will remove the provider and all its model configurations. You can add it back later."
      confirm-text="Remove"
      variant="danger"
      @confirm="confirmDelete"
    />
  </div>
</template>
