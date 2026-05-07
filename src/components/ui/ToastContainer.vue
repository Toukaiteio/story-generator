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
    <div class="fixed top-4 right-4 z-[400] flex flex-col gap-2 pointer-events-none">
      <TransitionGroup name="slide-up">
        <div
          v-for="toast in ui.toasts"
          :key="toast.id"
          class="flex items-center gap-3 px-4 py-3 rounded-lg border border-surface-4 bg-surface-1 shadow-xl pointer-events-auto min-w-[280px] max-w-[420px]"
        >
          <component :is="icons[toast.type]" :size="18" :class="colors[toast.type]" />
          <span class="flex-1 text-sm text-text-primary">{{ toast.message }}</span>
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
