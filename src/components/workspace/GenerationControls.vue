<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useGenerationStore } from '@/stores/generation'
import { useToast } from '@/composables/useToast'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import { ArrowRight, Play, Square, CheckCircle2, Circle, Loader2 } from 'lucide-vue-next'

const projectStore = useProjectStore()
const genStore = useGenerationStore()
const toast = useToast()

const project = computed(() => projectStore.activeProject)

const stages = [
  { key: 'planning', label: 'Planning' },
  { key: 'chapter-outline', label: 'Chapters' },
  { key: 'writing', label: 'Writing' },
  { key: 'proofreading', label: 'Proofread' },
  { key: 'polishing', label: 'Polish' },
]

const nextAction = computed(() => project.value ? genStore.getNextAction(project.value) : { stage: 'done' as const })

const stageStatus = computed(() => {
  const p = project.value
  return stages.map(stage => {
    let done = false

    if (!p) {
      done = false
    } else if (stage.key === 'planning') {
      done = !!p.outline.trim() && p.characters.length > 0
    } else if (stage.key === 'chapter-outline') {
      done = p.chapters.length > 0 && p.chapters.every(ch => ch.outline.objective.trim() || ch.outline.endingHook.trim())
    } else if (stage.key === 'writing') {
      done = p.chapters.length > 0 && p.chapters.every(ch => ch.content.trim())
    } else if (stage.key === 'proofreading') {
      done = p.chapters.length > 0 && p.chapters.every(ch => ch.proofreadContent.trim())
    } else if (stage.key === 'polishing') {
      done = p.chapters.length > 0 && p.chapters.every(ch => ch.polishedContent.trim())
    }

    return { ...stage, done, isActive: genStore.isGenerating && genStore.currentStage === stage.key }
  })
})

async function generateNextStep() {
  if (!project.value) return
  try {
    await genStore.generateNextStage(project.value.id)
  } catch (error: any) {
    toast.error(error?.message || 'Generation failed')
  }
}

async function startGeneration() {
  if (!project.value) return
  try {
    await genStore.generateAll(project.value.id)
  } catch (error: any) {
    toast.error(error?.message || 'Generation failed')
  }
}

function cancelGeneration() {
  genStore.cancelGeneration()
}
</script>

<template>
  <div class="border-b border-surface-4 bg-surface-1 px-4 py-3">
    <div class="flex items-center justify-between gap-4">
      <!-- Stage Progress -->
      <div class="flex items-center gap-1">
        <div
          v-for="stage in stageStatus"
          :key="stage.key"
          class="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs"
          :class="{
            'bg-accent-subtle text-accent': stage.isActive,
            'text-success': stage.done && !stage.isActive,
            'text-text-muted': !stage.done && !stage.isActive,
          }"
        >
          <Loader2 v-if="stage.isActive" :size="10" class="animate-spin" />
          <CheckCircle2 v-else-if="stage.done" :size="10" />
          <Circle v-else :size="10" />
          <span>{{ stage.label }}</span>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-2">
        <BaseTag v-if="genStore.isGenerating" variant="warning" size="sm">
          {{ genStore.progressMessage || 'Generating...' }}
        </BaseTag>

        <BaseButton
          v-if="!genStore.isGenerating"
          variant="ghost"
          size="sm"
          :disabled="nextAction.stage === 'done'"
          @click="generateNextStep"
        >
          <ArrowRight :size="14" />
          <span>Next Step</span>
        </BaseButton>

        <BaseButton
          v-if="!genStore.isGenerating"
          variant="primary"
          size="sm"
          @click="startGeneration"
        >
          <Play :size="14" />
          <span>Generate All</span>
        </BaseButton>

        <BaseButton
          v-else
          variant="danger"
          size="sm"
          @click="cancelGeneration"
        >
          <Square :size="14" />
          <span>Stop</span>
        </BaseButton>
      </div>
    </div>

    <!-- Error Messages -->
    <div v-if="genStore.errors.length" class="mt-2">
      <div
        v-for="error in genStore.errors.slice(-3)"
        :key="error.id"
        class="text-xs text-danger mt-1"
      >
        {{ error.message }}
      </div>
    </div>
  </div>
</template>