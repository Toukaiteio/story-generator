<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'
import BaseTag from '@/components/ui/BaseTag.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { BookOpen, Link, Unlink, ExternalLink } from 'lucide-vue-next'

const projectStore = useProjectStore()
const knowledgeStore = useKnowledgeStore()
const toast = useToast()
const tr = translatePhrase

const project = computed(() => projectStore.activeProject)

const selectedKnowledgeBaseIds = ref<string[]>([])

const knowledgeBaseOptions = computed(() =>
  knowledgeStore.sortedKnowledgeBases.map(base => ({
    id: base.id,
    name: base.name,
    description: base.description,
    documents: base.documents.length,
  }))
)

const selectedKnowledgeBases = computed(() =>
  knowledgeBaseOptions.value.filter(base => selectedKnowledgeBaseIds.value.includes(base.id))
)

// Sync from project
const stopSync = computed(() => {
  const p = project.value
  if (p) {
    selectedKnowledgeBaseIds.value = Array.isArray(p.knowledgeBaseIds)
      ? [...p.knowledgeBaseIds]
      : []
  }
  return true
})

function toggleKnowledgeBase(baseId: string) {
  if (selectedKnowledgeBaseIds.value.includes(baseId)) {
    selectedKnowledgeBaseIds.value = selectedKnowledgeBaseIds.value.filter(id => id !== baseId)
  } else {
    selectedKnowledgeBaseIds.value = [...selectedKnowledgeBaseIds.value, baseId]
  }
  saveKnowledgeBases()
}

async function saveKnowledgeBases() {
  if (!project.value) return
  const availableIds = new Set(knowledgeBaseOptions.value.map(base => base.id))
  const knowledgeBaseIds = Array.from(new Set(
    selectedKnowledgeBaseIds.value.filter(id => availableIds.has(id))
  ))
  await projectStore.updateProject(project.value.id, { knowledgeBaseIds })
}
</script>

<template>
  <div class="h-full flex flex-col bg-surface-1 border-l border-surface-4 overflow-hidden">
    <div class="px-3 py-3 border-b border-surface-4 shrink-0">
      <div class="flex items-center gap-2">
        <BookOpen :size="14" class="text-accent" />
        <h3 class="text-xs font-semibold text-text-secondary uppercase tracking-wider">{{ tr('Knowledge Bases') }}</h3>
      </div>
      <p class="text-2xs text-text-muted mt-1">
        {{ selectedKnowledgeBases.length }} {{ tr('linked') }}
      </p>
    </div>

    <div class="flex-1 overflow-y-auto py-2">
      <div v-if="knowledgeBaseOptions.length" class="space-y-1 px-2">
        <button
          v-for="base in knowledgeBaseOptions"
          :key="base.id"
          :class="[
            'w-full flex items-start gap-2 px-2 py-2 rounded-md text-left transition-colors duration-100',
            selectedKnowledgeBaseIds.includes(base.id)
              ? 'bg-accent-subtle border border-accent/20'
              : 'hover:bg-surface-3 border border-transparent',
          ]"
          @click="toggleKnowledgeBase(base.id)"
        >
          <div
            :class="[
              'w-4 h-4 rounded border mt-0.5 flex items-center justify-center shrink-0',
              selectedKnowledgeBaseIds.includes(base.id)
                ? 'bg-accent border-accent'
                : 'border-surface-5',
            ]"
          >
            <svg
              v-if="selectedKnowledgeBaseIds.includes(base.id)"
              class="w-3 h-3 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="3"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-xs font-medium text-text-primary truncate">{{ base.name }}</div>
            <div v-if="base.description" class="text-2xs text-text-muted mt-0.5 line-clamp-2">
              {{ base.description }}
            </div>
            <div class="flex items-center gap-1.5 mt-1">
              <BaseTag size="sm">{{ base.documents }} {{ tr('docs') }}</BaseTag>
            </div>
          </div>
        </button>
      </div>

      <div v-else class="px-3 py-6 text-center">
        <BookOpen :size="24" class="text-text-muted mx-auto mb-2" />
        <p class="text-xs text-text-muted">{{ tr('No knowledge bases') }}</p>
        <p class="text-2xs text-text-muted mt-1">
          {{ tr('Create one in Knowledge Base page') }}
        </p>
      </div>
    </div>
  </div>
</template>
