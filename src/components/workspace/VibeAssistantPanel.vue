<script setup lang="ts">
import { ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import VibeAssistant from './VibeAssistant.vue'
import { Sparkles, MessageSquare, X } from 'lucide-vue-next'

const props = defineProps<{
  stage: string
  context?: Record<string, any>
}>()

const emit = defineEmits<{
  apply: [content: string]
}>()

const isOpen = ref(false)

function toggle() {
  isOpen.value = !isOpen.value
}

function handleApply(content: string) {
  emit('apply', content)
}
</script>

<template>
  <!-- Floating Button & Inline Panel -->
  <div class="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
    <Transition name="fade">
      <div v-if="isOpen" class="w-[380px] h-[500px] rounded-xl border border-surface-4 bg-surface-1 shadow-2xl overflow-hidden mb-2">
        <div class="flex items-center justify-between px-3 py-2 bg-surface-2 border-b border-surface-4">
          <div class="flex items-center gap-2">
            <Sparkles :size="14" class="text-accent" />
            <span class="text-xs font-medium text-text-primary">Vibe Assistant</span>
          </div>
          <button
            class="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors"
            @click="isOpen = false"
          >
            <X :size="14" />
          </button>
        </div>
        <VibeAssistant
          :stage="stage"
          :context="context"
          @apply="handleApply"
        />
      </div>
    </Transition>

    <BaseButton
      variant="primary"
      size="sm"
      class="shadow-lg rounded-full w-12 h-12 !p-0"
      @click="toggle"
    >
      <Sparkles v-if="!isOpen" :size="20" />
      <X v-else :size="20" />
    </BaseButton>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>