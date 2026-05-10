<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { Save, List } from 'lucide-vue-next'

const projectStore = useProjectStore()
const toast = useToast()
const tr = translatePhrase

const project = computed(() => projectStore.activeProject)
const outlineText = ref('')

watch(project, (p) => {
  outlineText.value = p?.outline || ''
}, { immediate: true })

async function saveOutline() {
  if (!project.value) return
  const saved = await projectStore.updateProject(project.value.id, { outline: outlineText.value })
  if (!saved) {
    toast.error('Failed to save outline')
    return
  }
  toast.success('Outline saved')
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-3xl mx-auto px-6 py-6">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h2 class="text-base font-semibold text-text-primary">{{ tr('Story Outline') }}</h2>
          <p class="text-xs text-text-secondary mt-0.5">{{ tr('The overall story blueprint and thematic direction.') }}</p>
        </div>
        <BaseButton variant="primary" size="sm" @click="saveOutline">
          <Save :size="14" />
          <span>{{ tr('Save') }}</span>
        </BaseButton>
      </div>

      <BaseTextarea
        v-if="project"
        v-model="outlineText"
        :placeholder="tr('Write or paste your story outline here...')"
        :rows="24"
        :auto-resize="true"
      />

      <EmptyState
        v-else
        :icon="List"
        :title="tr('No project loaded')"
        :description="tr('Open a project to edit the story outline.')"
      />
    </div>
  </div>
</template>
