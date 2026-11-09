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
    <div class="pointer-events-none fixed bottom-5 right-5 z-[400] flex max-w-[calc(100vw-2rem)] flex-col gap-2 sm:max-w-[min(90vw,420px)]">
      <TransitionGroup name="slide-up">
        <div
          v-for="toast in ui.toasts"
          :key="toast.id"
          class="pointer-events-auto flex min-w-0 max-w-full items-start gap-3 rounded-ios bg-surface-1 px-4 py-3 shadow-ios-lg"
        >
          <component :is="icons[toast.type]" :size="18" :class="`${colors[toast.type]} mt-0.5 shrink-0`" />
          <span class="min-w-0 flex-1 whitespace-pre-wrap break-words text-caption leading-relaxed text-text-primary">{{ toast.message }}</span>
          <button
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors duration-100 hover:bg-surface-2 hover:text-text-primary"
            @click="ui.removeToast(toast.id)"
          >
            <X :size="14" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
