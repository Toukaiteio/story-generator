<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Check, ChevronDown, Key, Pencil, Plus, RefreshCw, Server, Trash2, Wrench, X, Zap } from 'lucide-vue-next'
import BaseDrawer from '@/components/ui/BaseDrawer.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSegmented from '@/components/ui/BaseSegmented.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseDropdown from '@/components/ui/BaseDropdown.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import {
  useModelCatalog,
  decodeProviderModelRef,
  encodeProviderModelRef,
  formatModelLabel,
  defaultBaseUrls,
  builtinModels,
} from '@/app'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'
import type { AgentType } from '@/types/agent'
import type { ModelConfig, ModelSource, ProviderType, ReasoningEffort } from '@/types/provider'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const tr = translatePhrase
const store = useModelCatalog()
const toast = useToast()

const open = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const maxTokenPresets = [2048, 4096, 8192, 16384, 32768]
const providerTypes: Array<{ label: string; value: ProviderType }> = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'OpenAI Responses', value: 'openai-responses' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'Google GenAI', value: 'google' },
]

const roleOptions: Array<{ id: AgentType; label: string }> = [
  { id: 'outline', label: 'Outline' },
  { id: 'detailer', label: 'Detailer' },
  { id: 'character', label: 'Character' },
  { id: 'chapterPlanner', label: 'Chapter planner' },
  { id: 'chapterTitlePlanner', label: 'Chapter titles' },
  { id: 'writer', label: 'Writer' },
  { id: 'editingAI', label: 'Editing' },
  { id: 'relationshipTracker', label: 'Relationships' },
  { id: 'skillAgent', label: 'Skill agent' },
  { id: 'proofreader', label: 'Proofreader' },
  { id: 'polisher', label: 'Polisher' },
]

const tab = ref<'providers' | 'binding'>('providers')
const editingId = ref<string | null>(null)
const formOpen = ref(false)
const expandedModelProviders = ref<string[]>([])
const pendingDeleteId = ref<string | null>(null)
const customModelProviderId = ref<string | null>(null)
const customModelId = ref('')
const customModelName = ref('')
const testingEmbedding = ref(false)
const embeddingTest = ref<{ ok: boolean; dimensions?: number; error?: string; label?: string } | null>(null)
const bulkModel = ref('')

const form = reactive({
  type: 'openai' as ProviderType,
  name: '',
  apiKey: '',
  baseUrl: '',
})

const drafts = ref<Array<{ id: string; name: string; tier: 'expert' | 'standard'; maxTokens: string; supportsStreaming: boolean; supportsEmbeddings: boolean; embeddingDimensions: string; source: ModelSource; reasoningEnabled: boolean; reasoningEffort: ReasoningEffort }>>([])

const chatCount = computed(() => store.modelOptions.filter(option => !option.supportsEmbeddings).length)

const embeddingOptions = computed(() =>
  store.modelOptions
    .filter(option => option.supportsEmbeddings)
    .map(option => ({ label: option.label, value: option.value })),
)

function resetForm() {
  form.type = 'openai'
  form.name = ''
  form.apiKey = ''
  form.baseUrl = ''
  drafts.value = []
}

function useCatalog(type: ProviderType = form.type) {
  drafts.value = builtinModels[type].map(model => ({
    id: model.id,
    name: model.name,
    tier: model.tier,
    maxTokens: String(model.maxTokens),
    supportsStreaming: model.supportsStreaming,
    supportsEmbeddings: model.supportsEmbeddings,
    embeddingDimensions: model.embeddingDimensions ? String(model.embeddingDimensions) : '',
    source: 'builtin',
    reasoningEnabled: model.reasoning?.enabled ?? false,
    reasoningEffort: model.reasoning?.effort ?? 'medium',
  }))
}

async function fetchDrafts(type: ProviderType = form.type, apiKey = form.apiKey, baseUrl = form.baseUrl) {
  try {
    const models = await store.previewModelList({
      type,
      apiKey: apiKey || '',
      baseUrl: baseUrl || defaultBaseUrls[type],
    })
    drafts.value = models.map(model => ({
      id: model.id,
      name: model.name,
      tier: model.tier,
      maxTokens: String(model.maxTokens),
      supportsStreaming: model.supportsStreaming,
      supportsEmbeddings: model.supportsEmbeddings,
      embeddingDimensions: model.embeddingDimensions ? String(model.embeddingDimensions) : '',
      source: model.source,
      reasoningEnabled: model.reasoning?.enabled ?? false,
      reasoningEffort: model.reasoning?.effort ?? 'medium',
    }))
    toast.success('Model list synced')
  } catch (error: any) {
    useCatalog(type)
    toast.warning(error?.message || 'Fetch failed. Built-in catalog loaded instead.')
  }
}

function buildModels(): ModelConfig[] {
  const seen = new Map<string, ModelConfig>()
  for (const draft of drafts.value) {
    if (!draft.id.trim()) continue
    seen.set(draft.id.trim(), {
      id: draft.id.trim(),
      name: draft.name.trim() || draft.id.trim(),
      tier: draft.tier,
      maxTokens: Number(draft.maxTokens) || 8192,
      supportsStreaming: draft.supportsStreaming,
      supportsEmbeddings: draft.supportsEmbeddings,
      embeddingDimensions: draft.supportsEmbeddings ? Number(draft.embeddingDimensions) || null : null,
      source: draft.source,
      reasoning: { enabled: draft.reasoningEnabled, effort: draft.reasoningEffort },
    })
  }
  return [...seen.values()]
}

const overflowItems = computed(() => [
  { label: 'Sync models', icon: RefreshCw, disabled: !store.providers.length, action: () => void syncAll() },
])

function openCreate() {
  editingId.value = null
  resetForm()
  formOpen.value = true
  void fetchDrafts()
}

function openEdit(providerId: string) {
  const provider = store.getProviderById(providerId)
  if (!provider) return
  editingId.value = providerId
  form.type = provider.type
  form.name = provider.name
  form.apiKey = provider.apiKey ?? ''
  form.baseUrl = provider.baseUrl
  drafts.value = provider.models.map(model => ({
    id: model.id,
    name: model.name,
    tier: model.tier,
    maxTokens: String(model.maxTokens),
    supportsStreaming: model.supportsStreaming,
    supportsEmbeddings: model.supportsEmbeddings,
    embeddingDimensions: model.embeddingDimensions ? String(model.embeddingDimensions) : '',
    source: model.source,
    reasoningEnabled: model.reasoning?.enabled ?? false,
    reasoningEffort: model.reasoning?.effort ?? 'medium',
  }))
  formOpen.value = true
}

function saveProvider() {
  const models = buildModels()
  if (!form.name.trim()) {
    toast.warning('Provider name is required')
    return
  }
  if (!models.length) {
    toast.warning('Fetch models or add one manually')
    return
  }
  try {
    if (editingId.value) {
      store.updateProviderConfig(editingId.value, {
        type: form.type,
        name: form.name,
        apiKey: form.apiKey,
        baseUrl: form.baseUrl || defaultBaseUrls[form.type],
        models,
      })
      toast.success('Provider updated')
    } else {
      store.addProvider({
        type: form.type,
        name: form.name,
        apiKey: form.apiKey,
        baseUrl: form.baseUrl || defaultBaseUrls[form.type],
        models,
      })
      toast.success('Provider added')
    }
    formOpen.value = false
    editingId.value = null
  } catch (error: any) {
    toast.error(error?.message || 'Failed to save provider')
  }
}

async function syncProvider(providerId: string) {
  try {
    await store.refreshProviderModels(providerId)
    toast.success('Model list refreshed')
  } catch (error: any) {
    toast.error(error?.message || 'Sync failed')
  }
}

async function syncAll() {
  const results = await Promise.allSettled(store.providers.map(provider => store.refreshProviderModels(provider.id)))
  const failures = results.filter(result => result.status === 'rejected').length
  if (failures) toast.warning(`Sync finished, ${failures} failed`)
}

function openCustomModel(providerId: string) {
  customModelProviderId.value = providerId
  customModelId.value = ''
  customModelName.value = ''
}

function addCustomModel() {
  if (!customModelProviderId.value || !customModelId.value.trim()) return
  store.addCustomModel(customModelProviderId.value, {
    id: customModelId.value.trim(),
    name: customModelName.value.trim() || customModelId.value.trim(),
    tier: 'standard',
    maxTokens: 8192,
    supportsStreaming: true,
    supportsEmbeddings: false,
    embeddingDimensions: null,
    source: 'custom',
    reasoning: { enabled: false, effort: 'medium' },
  })
  store.ensureAgentModelBindings()
  customModelProviderId.value = null
  toast.success('Custom model added')
}

function confirmDeleteProvider() {
  if (!pendingDeleteId.value) return
  store.removeProvider(pendingDeleteId.value)
  pendingDeleteId.value = null
  toast.success('Provider removed')
}

function roleValue(role: AgentType) {
  const binding = store.getAgentModelBinding(role)
  return binding ? encodeProviderModelRef(binding) : ''
}

function setRole(role: AgentType, value: string) {
  store.setAgentModelBinding(role, value ? decodeProviderModelRef(value) : null)
}

function applyBulkModel() {
  const ref = decodeProviderModelRef(bulkModel.value)
  if (!ref) return
  for (const role of roleOptions) store.setAgentModelBinding(role.id, ref)
  toast.success('All roles updated')
}

const embeddingValue = computed(() => {
  const binding = store.getEmbeddingModelBinding()
  return binding ? encodeProviderModelRef(binding) : ''
})

function setEmbedding(value: string) {
  store.setEmbeddingModelBinding(value ? decodeProviderModelRef(value) : null)
}

function setModelTokens(providerId: string, modelId: string, preset: number) {
  store.setModelContextTokens(providerId, modelId, preset)
}

function clearModelTokens(providerId: string, modelId: string) {
  store.clearModelContextTokens(providerId, modelId)
}

async function testEmbedding() {
  const binding = store.getEmbeddingModelBinding()
  if (!binding || testingEmbedding.value) return
  testingEmbedding.value = true
  embeddingTest.value = null
  const match = store.getModelByRef(binding)
  if (!match) {
    embeddingTest.value = { ok: false, error: tr('Embedding model not found') }
    testingEmbedding.value = false
    return
  }

  const baseUrl = match.provider.baseUrl.replace(/\/+$/, '')
  const apiKey = match.provider.apiKey ?? ''
  try {
    const response = match.provider.type === 'google'
      ? await fetch(`${baseUrl}/v1beta/models/${binding.modelId}:embedContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'x-goog-api-key': apiKey } : {}) },
          body: JSON.stringify({ content: { parts: [{ text: 'Hello, world!' }] } }),
        })
      : await fetch(`${baseUrl}/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify({ model: binding.modelId, input: 'Hello, world!' }),
        })

    if (!response.ok) throw new Error(`${response.status} ${await response.text().catch(() => '')}`.trim())
    const payload = await response.json()
    const embedding = match.provider.type === 'google' ? payload?.embedding?.values : payload?.data?.[0]?.embedding
    if (!Array.isArray(embedding)) throw new Error(tr('No embedding returned'))
    embeddingTest.value = { ok: true, dimensions: embedding.length, label: match.model.name }
    toast.success(`${tr('Test passed')} · ${embedding.length} ${tr('dimensions')}`)
  } catch (error: any) {
    embeddingTest.value = { ok: false, error: error?.message || tr('Embedding test failed') }
    toast.error(error?.message || 'Embedding test failed')
  } finally {
    testingEmbedding.value = false
  }
}

function toggleModels(providerId: string) {
  expandedModelProviders.value = expandedModelProviders.value.includes(providerId)
    ? expandedModelProviders.value.filter(id => id !== providerId)
    : [...expandedModelProviders.value, providerId]
}

watch(open, value => {
  if (!value) {
    formOpen.value = false
    editingId.value = null
    pendingDeleteId.value = null
    customModelProviderId.value = null
  }
})
</script>

<template>
  <BaseDrawer v-model="open" :title="tr('Models')" width="480px" flush>
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex shrink-0 flex-wrap items-center gap-2 px-5 pb-2">
        <BaseSegmented
          :model-value="tab"
          :options="[{ label: tr('Providers'), value: 'providers' }, { label: tr('Agent binding'), value: 'binding' }]"
          @update:model-value="tab = $event as 'providers' | 'binding'"
        />
        <span class="text-meta text-text-muted">{{ store.providers.length }} {{ tr('providers') }} · {{ chatCount }} {{ tr('models') }}</span>
        <div class="ml-auto flex items-center gap-1">
          <BaseDropdown :items="overflowItems" :width="200">
            <template #trigger>
              <div class="capsule h-9 w-9 px-0" :aria-label="tr('More actions')">
                <span class="text-body leading-none">⋯</span>
              </div>
            </template>
          </BaseDropdown>
          <button class="app-key-action h-9 gap-1.5 px-3.5 text-caption" @click="openCreate">
            <Plus :size="15" />
            <span>{{ tr('Add provider') }}</span>
          </button>
        </div>
      </div>

      <div class="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 pb-6 pt-4">
        <template v-if="tab === 'providers'">
          <div v-for="provider in store.providers" :key="provider.id" class="rounded-ios bg-surface-1 p-3 shadow-ios-pill">
            <div class="flex items-center gap-2">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-accent">
                <Server :size="15" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-caption font-semibold text-text-primary">{{ provider.name }}</p>
                <p class="truncate text-meta text-text-muted">{{ provider.type }} · {{ provider.models.length }} {{ tr('models') }}</p>
              </div>
              <BaseTag :variant="provider.isActive ? 'success' : 'default'" size="sm">
                {{ tr(provider.isActive ? 'Enabled' : 'Disabled') }}
              </BaseTag>
            </div>

            <div class="mt-2 flex flex-wrap items-center gap-1">
              <button class="capsule h-8 gap-1 bg-surface-2 px-3 text-meta" @click="syncProvider(provider.id)">
                <RefreshCw :size="13" />
                {{ tr('Fetch models') }}
              </button>
              <button class="capsule h-8 gap-1 bg-surface-2 px-3 text-meta" @click="openEdit(provider.id)">
                <Pencil :size="13" />
                {{ tr('Edit') }}
              </button>
              <button class="capsule h-8 gap-1 bg-surface-2 px-3 text-meta" @click="openCustomModel(provider.id)">
                <Plus :size="13" />
                {{ tr('Custom model') }}
              </button>
              <button class="app-icon-button app-icon-button--danger ml-auto" :aria-label="tr('Delete provider')" @click="pendingDeleteId = provider.id">
                <Trash2 :size="15" />
              </button>
            </div>

            <div class="mt-2 rounded-ios bg-surface-2/60 px-3 py-2">
              <p class="truncate text-meta text-text-muted">{{ tr('Base URL') }}: {{ provider.baseUrl }}</p>
              <button class="mt-1 flex w-full items-center justify-between text-meta text-text-secondary" @click="toggleModels(provider.id)">
                <span>{{ provider.models.length }} {{ tr('models') }}</span>
                <ChevronDown :size="14" :class="expandedModelProviders.includes(provider.id) ? 'rotate-180' : ''" />
              </button>
              <div v-if="expandedModelProviders.includes(provider.id)" class="mt-1 space-y-1.5">
                <div v-for="model in provider.models" :key="model.id" class="rounded-ios bg-surface-1 px-2.5 py-1.5">
                  <p class="flex items-center justify-between gap-2 text-meta">
                    <span class="min-w-0 truncate text-text-secondary">{{ formatModelLabel(provider.id, model.name) }}</span>
                    <span class="shrink-0 text-text-muted">{{ model.tier }} · {{ model.contextTokens || model.maxTokens }}</span>
                  </p>
                  <div class="mt-1 flex flex-wrap gap-1">
                    <button
                      v-for="preset in maxTokenPresets"
                      :key="`${model.id}-${preset}`"
                      class="capsule h-6 px-2 text-meta"
                      :class="model.contextTokens === preset ? 'bg-accent-subtle text-accent' : 'bg-surface-2'"
                      @click="setModelTokens(provider.id, model.id, preset)"
                    >
                      {{ preset }}
                    </button>
                    <button class="capsule h-6 px-2 text-meta text-text-muted" @click="clearModelTokens(provider.id, model.id)">
                      {{ tr('Auto') }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <p v-if="!store.providers.length" class="px-5 py-6 text-center text-caption text-text-muted">
            {{ tr('No providers yet') }}
          </p>
        </template>

        <template v-else>
          <div class="flex items-center gap-2">
            <BaseSelect
              v-model="bulkModel"
              class="flex-1"
              :options="store.modelOptions.map(option => ({ label: option.label, value: option.value }))"
              :placeholder="tr('Pick one model for every role')"
            />
            <BaseButton variant="secondary" size="sm" :disabled="!bulkModel" @click="applyBulkModel">
              <Wrench :size="14" />
              <span>{{ tr('Apply') }}</span>
            </BaseButton>
          </div>

          <div v-for="role in roleOptions" :key="role.id" class="rounded-ios bg-surface-1 px-3 py-2 shadow-ios-pill">
            <p class="mb-1 text-meta font-medium text-text-secondary">{{ tr(role.label) }}</p>
            <BaseSelect
              :model-value="roleValue(role.id)"
              :options="store.modelOptions.map(option => ({ label: option.label, value: option.value }))"
              :placeholder="tr('No model')"
              @update:model-value="value => setRole(role.id, value)"
            />
          </div>

          <div class="rounded-ios bg-surface-1 px-3 py-2 shadow-ios-pill">
            <p class="mb-1 text-meta font-medium text-text-secondary">{{ tr('Embedding model') }}</p>
            <div class="flex items-center gap-1.5">
              <BaseSelect
                :model-value="embeddingValue"
                :options="embeddingOptions"
                :placeholder="tr('No embedding model')"
                class="min-w-0 flex-1"
                @update:model-value="setEmbedding"
              />
              <button class="capsule h-8 shrink-0 bg-surface-2 px-2.5 text-meta" :disabled="!embeddingValue || testingEmbedding" @click="testEmbedding">
                <Zap :size="13" class="mr-1 inline" />
                {{ tr('Test') }}
              </button>
            </div>
            <p v-if="embeddingTest" class="mt-1 text-meta" :class="embeddingTest.ok ? 'text-success' : 'text-danger'">
              {{ embeddingTest.ok ? `${embeddingTest.dimensions} ${tr('dimensions')} · ${embeddingTest.label}` : embeddingTest.error }}
            </p>
          </div>
        </template>
      </div>
    </div>

    <div v-if="customModelProviderId" class="shrink-0 border-t border-line bg-surface-1 px-5 py-3">
      <p class="mb-1.5 text-meta font-medium text-text-secondary">{{ tr('Custom model') }}</p>
      <div class="flex items-center gap-1.5">
        <BaseInput v-model="customModelId" class="flex-1" :placeholder="tr('Model id')" />
        <BaseInput v-model="customModelName" class="flex-1" :placeholder="tr('Display name')" />
      </div>
      <div class="mt-2 flex justify-end gap-1.5">
        <BaseButton variant="ghost" size="sm" @click="customModelProviderId = null">{{ tr('Cancel') }}</BaseButton>
        <BaseButton variant="primary" size="sm" :disabled="!customModelId.trim()" @click="addCustomModel">
          {{ tr('Add') }}
        </BaseButton>
      </div>
    </div>

    <BaseDialog v-model="formOpen" :title="tr(editingId ? 'Edit provider' : 'Add provider')" width="480px">
      <div class="space-y-3">
        <BaseSegmented v-model="form.type" :options="providerTypes" @update:model-value="fetchDrafts($event as ProviderType)" />
        <BaseInput v-model="form.name" :placeholder="tr('Provider name')" />
        <BaseInput v-model="form.apiKey" type="password" :icon="Key" :placeholder="tr('API key')" />
        <div class="flex items-end gap-1.5">
          <BaseInput v-model="form.baseUrl" class="flex-1" :placeholder="defaultBaseUrls[form.type]" />
          <BaseButton variant="secondary" size="sm" @click="fetchDrafts()">
            <RefreshCw :size="14" />
            <span>{{ tr('Fetch models') }}</span>
          </BaseButton>
          <BaseButton variant="secondary" size="sm" @click="useCatalog()">
            <Server :size="14" />
            <span>{{ tr('Catalog') }}</span>
          </BaseButton>
        </div>

        <div class="max-h-56 space-y-1.5 overflow-y-auto px-3 py-2">
          <div v-for="(draft, index) in drafts" :key="`${draft.id}-${index}`" class="rounded-ios bg-surface-2/70 px-3 py-2">
            <div class="flex items-center gap-1.5">
              <p class="min-w-0 flex-1 truncate text-caption text-text-primary">{{ draft.name || draft.id }}</p>
              <span class="rounded-full bg-surface-1 px-2 py-0.5 text-meta text-text-muted">{{ draft.source }}</span>
              <button class="app-icon-button app-icon-button--danger" :aria-label="tr('Remove')" @click="drafts.splice(index, 1)">
                <X :size="14" />
              </button>
            </div>
            <div class="mt-1.5 flex flex-wrap gap-1">
              <button
                v-for="preset in maxTokenPresets"
                :key="preset"
                class="capsule h-7 px-2.5 text-meta"
                :class="Number(draft.maxTokens) === preset ? 'bg-accent-subtle text-accent' : 'bg-surface-1'"
                @click="draft.maxTokens = String(preset)"
              >
                {{ preset }}
              </button>
            </div>
          </div>
          <p v-if="!drafts.length" class="px-2 py-3 text-center text-meta text-text-muted">{{ tr('Fetch models to build the list') }}</p>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <BaseButton variant="secondary" size="sm" @click="formOpen = false">{{ tr('Cancel') }}</BaseButton>
          <BaseButton variant="primary" size="sm" @click="saveProvider">
            <Check :size="14" />
            <span>{{ tr('Save') }}</span>
          </BaseButton>
        </div>
      </template>
    </BaseDialog>

    <ConfirmDialog
      :model-value="!!pendingDeleteId"
      :title="tr('Delete provider')"
      :message="tr('Its models and role bindings are removed too.')"
      :confirm-text="tr('Delete')"
      variant="danger"
      @update:model-value="value => { if (!value) pendingDeleteId = null }"
      @confirm="confirmDeleteProvider"
    />
  </BaseDrawer>
</template>
