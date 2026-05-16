<script setup lang="ts">
import { useUiStore } from '@/stores/ui'
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-vue-next'
import type { Toast } from '@/types/common'

const ui = useUiStore()

const icons: Record<string, any> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}

const colors: Record<string, string> = {
  success: 'text-success',
  error: 'text-danger',
  warning: 'text-warning',
  info: 'text-accent',
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed top-4 right-4 z-[400] flex max-w-[calc(100vw-1rem)] flex-col gap-2 pointer-events-none sm:max-w-[min(90vw,460px)]">
      <TransitionGroup name="slide-up">
        <div
          v-for="toast in ui.toasts"
          :key="toast.id"
          class="flex items-start gap-3 px-4 py-3 rounded-lg border border-surface-4 bg-surface-1 shadow-xl pointer-events-auto min-w-0 max-w-full"
        >
          <component :is="icons[toast.type]" :size="18" :class="`${colors[toast.type]} mt-0.5 shrink-0`" />
          <span class="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-text-primary">{{ toast.message }}</span>
          <button
            class="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors duration-100 shrink-0"
            @click="ui.removeToast(toast.id)"
          >
            <X :size="14" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
