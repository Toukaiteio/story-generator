<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import { useGenerationStore } from '@/stores/generation'
import { ChevronUp, ChevronDown, Loader2 } from 'lucide-vue-next'

const genStore = useGenerationStore()
const scrollContainer = ref<HTMLDivElement | null>(null)
const collapsed = ref(false)

const stageLabel = computed(() => {
  const labels: Record<string, string> = {
    planning: 'Planning Story',
    'chapter-outline': 'Planning Chapters',
    writing: 'Writing Chapter',
    proofreading: 'Proofreading',
    polishing: 'Polishing',
  }
  return labels[genStore.currentStage] ?? 'Processing'
})

const progressText = computed(() => {
  if (!genStore.isGenerating) return ''
  if (genStore.progressMessage) return genStore.progressMessage
  return genStore.streamContent ? 'Generating...' : 'Starting...'
})

watch(() => genStore.streamContent, async () => {
  if (!collapsed.value) {
    await nextTick()
    if (scrollContainer.value) {
      scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
    }
  }
})
</script>

<template>
  <Transition name="slide">
    <div
      v-if="genStore.isGenerating"
      class="pt-2 px-4 mb-3"
    >
      <div class="rounded-lg border border-surface-4 bg-surface-2 overflow-hidden">
      <!-- Header -->
      <div
        class="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-surface-3 transition-colors"
        @click="collapsed = !collapsed"
      >
        <div class="flex items-center gap-2">
          <Loader2 :size="12" class="text-accent animate-spin" />
          <span class="text-xs font-medium text-text-primary">{{ stageLabel }}</span>
          <span v-if="progressText && !genStore.streamContent" class="text-2xs text-text-muted">
            {{ progressText }}
          </span>
        </div>
        <button class="p-1 hover:bg-surface-4 rounded text-text-muted">
          <ChevronDown v-if="!collapsed" :size="12" />
          <ChevronUp v-else :size="12" />
        </button>
      </div>

      <!-- Content -->
      <div v-if="!collapsed && genStore.streamContent" class="border-t border-surface-4">
        <div
          ref="scrollContainer"
          class="max-h-[150px] overflow-y-auto px-3 py-2 text-xs text-text-secondary whitespace-pre-wrap leading-relaxed"
        >
          {{ genStore.streamContent }}
        </div>
      </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: all 0.2s ease;
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>