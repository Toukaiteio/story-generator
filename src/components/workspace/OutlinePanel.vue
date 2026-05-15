<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useUiStore } from '@/stores/ui'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { Save, List } from 'lucide-vue-next'

const projectStore = useProjectStore()
const ui = useUiStore()
const toast = useToast()
const tr = translatePhrase

const project = computed(() => projectStore.activeProject)
const outlineText = ref('')
const outlineUnsavedNodeKey = computed(() => project.value ? `outline-${project.value.id}` : '')
const isOutlineDirty = computed(() => {
  if (!project.value) return false
  return outlineText.value !== (project.value.outline || '')
})

watch(project, (p) => {
  outlineText.value = p?.outline || ''
}, { immediate: true })

watch(isOutlineDirty, dirty => {
  const nodeKey = outlineUnsavedNodeKey.value
  if (!nodeKey) return
  ui.setWorkspaceNodeUnsaved(nodeKey, dirty)
}, { immediate: true })

watch(outlineUnsavedNodeKey, (next, previous) => {
  if (previous && previous !== next) {
    ui.setWorkspaceNodeUnsaved(previous, false)
  }
  if (next) {
    ui.setWorkspaceNodeUnsaved(next, isOutlineDirty.value)
  }
})

async function saveOutline() {
  if (!project.value) return
  const saved = await projectStore.updateProject(project.value.id, { outline: outlineText.value })
  if (!saved) {
    toast.error('Failed to save outline')
    return
  }
  toast.success('Outline saved')
}

onBeforeUnmount(() => {
  const nodeKey = outlineUnsavedNodeKey.value
  if (nodeKey && !isOutlineDirty.value) {
    ui.setWorkspaceNodeUnsaved(nodeKey, false)
  }
})

async function saveFromShortcut() {
  await saveOutline()
}

defineExpose({
  saveFromShortcut,
})
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
