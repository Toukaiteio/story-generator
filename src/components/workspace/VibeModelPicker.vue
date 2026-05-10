<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, Search } from 'lucide-vue-next'
import { useProviderStore } from '@/stores/provider'
import { translatePhrase } from '@/i18n'
import { decodeProviderModelRef, encodeProviderModelRef } from '@/services/provider/catalog'
import type { AgentType } from '@/types/agent'

const props = withDefaults(defineProps<{
  modelValue: string
  role: AgentType
  disabled?: boolean
  fallbackLabel?: string
}>(), {
  disabled: false,
  fallbackLabel: 'No available model',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const providerStore = useProviderStore()
const tr = translatePhrase

const showModelPicker = ref(false)
const modelSearch = ref('')
const collapsedProviderIds = ref<Set<string>>(new Set())

const selectedModelRef = computed(() => {
  const selected = decodeProviderModelRef(props.modelValue)
  return providerStore.getAvailableModelRefForRole(props.role, selected)
})

const selectedModelLabel = computed(() =>
  providerStore.getModelLabel(selectedModelRef.value) || props.fallbackLabel
)

const groupedModels = computed(() => {
  const query = modelSearch.value.trim().toLowerCase()
  return providerStore.providers
    .filter(provider => provider.isActive)
    .map(provider => {
      const models = provider.models
        .filter(model => !model.supportsEmbeddings)
        .filter(model => {
          if (!query) return true
          return `${provider.id} ${provider.name} ${model.id} ${model.name}`.toLowerCase().includes(query)
        })
      return { provider, models }
    })
    .filter(group => group.models.length > 0)
})

function toggleProvider(providerId: string) {
  if (collapsedProviderIds.value.has(providerId)) {
    collapsedProviderIds.value.delete(providerId)
  } else {
    collapsedProviderIds.value.add(providerId)
  }
}

function selectModel(providerId: string, modelId: string) {
  emit('update:modelValue', encodeProviderModelRef({ providerId, modelId }))
  showModelPicker.value = false
}
</script>

<template>
  <div class="relative shrink-0 border-b border-surface-4 px-3 py-2">
    <button
      class="flex w-full items-center justify-between gap-2 rounded-md border border-surface-4 bg-surface-2 px-2.5 py-2 text-left text-xs text-text-secondary hover:border-surface-5 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
      :disabled="disabled"
      @click="showModelPicker = !showModelPicker"
    >
      <span class="min-w-0 truncate">
        <span class="text-text-muted">{{ tr('Model') }}:</span>
        <span class="ml-1 font-medium text-text-primary">{{ selectedModelLabel }}</span>
      </span>
      <ChevronDown :size="13" class="shrink-0 transition-transform" :class="showModelPicker ? 'rotate-180' : ''" />
    </button>

    <div
      v-if="showModelPicker"
      class="absolute left-3 right-3 top-[calc(100%-4px)] z-50 rounded-lg border border-surface-4 bg-surface-1 shadow-xl"
    >
      <div class="border-b border-surface-4 p-2">
        <div class="flex items-center gap-2 rounded-md border border-surface-4 bg-surface-2 px-2 py-1.5">
          <Search :size="12" class="text-text-muted" />
          <input
            v-model="modelSearch"
            class="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
            :placeholder="tr('Search models...')"
          />
        </div>
      </div>
      <div class="max-h-72 overflow-y-auto p-1 custom-scrollbar">
        <div v-for="group in groupedModels" :key="group.provider.id" class="mb-1">
          <button
            class="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs font-semibold text-text-secondary hover:bg-surface-2 hover:text-text-primary"
            @click="toggleProvider(group.provider.id)"
          >
            <span class="truncate">{{ group.provider.name || group.provider.id }}</span>
            <ChevronDown :size="12" class="transition-transform" :class="collapsedProviderIds.has(group.provider.id) ? '-rotate-90' : ''" />
          </button>
          <div v-if="!collapsedProviderIds.has(group.provider.id)" class="space-y-0.5">
            <button
              v-for="model in group.models"
              :key="model.id"
              class="flex w-full items-center justify-between gap-2 rounded px-3 py-1.5 text-left text-xs hover:bg-surface-2"
              :class="selectedModelRef?.providerId === group.provider.id && selectedModelRef?.modelId === model.id ? 'text-accent bg-accent-subtle/50' : 'text-text-secondary'"
              @click="selectModel(group.provider.id, model.id)"
            >
              <span class="min-w-0 truncate">{{ model.name || model.id }}</span>
              <span class="shrink-0 text-[10px] text-text-muted">{{ model.tier }}</span>
            </button>
          </div>
        </div>
        <p v-if="!groupedModels.length" class="px-3 py-4 text-center text-xs text-text-muted">
          {{ tr('No matching models') }}
        </p>
      </div>
    </div>
  </div>
</template>
