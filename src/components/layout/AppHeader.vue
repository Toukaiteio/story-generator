<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useUiStore } from '@/stores/ui'
import { Minus, Square, X, ChevronRight } from 'lucide-vue-next'

const route = useRoute()
const ui = useUiStore()

const breadcrumbs = computed(() => {
  const name = route.name as string
  const map: Record<string, string> = {
    Projects: ui.t('sidebar.projects'),
    Workspace: ui.t('sidebar.workspace'),
    Knowledge: ui.t('sidebar.knowledge'),
    WritingStyles: ui.t('sidebar.writingStyles'),
    Providers: ui.t('sidebar.providers'),
    Settings: ui.t('sidebar.settings'),
  }
  return [map[name] || name]
})

function minimize() {
  window.electronAPI?.window.minimize()
}

function maximize() {
  window.electronAPI?.window.maximize()
}

function close() {
  window.electronAPI?.window.close()
}
</script>

<template>
  <header class="h-12 flex items-center justify-between px-4 bg-surface-1 border-b border-surface-4 shrink-0 drag-region select-none">
    <div class="flex items-center gap-2 no-drag">
      <div v-for="(crumb, i) in breadcrumbs" :key="i" class="flex items-center gap-2">
        <ChevronRight v-if="i > 0" :size="12" class="text-text-muted" />
        <span class="text-sm font-medium text-text-primary">{{ crumb }}</span>
      </div>
    </div>

    <div class="flex items-center gap-0.5 no-drag">
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md text-text-muted hover:text-text-secondary hover:bg-surface-3 transition-colors duration-100"
        @click="minimize"
      >
        <Minus :size="14" />
      </button>
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md text-text-muted hover:text-text-secondary hover:bg-surface-3 transition-colors duration-100"
        @click="maximize"
      >
        <Square :size="12" />
      </button>
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md text-text-muted hover:text-danger hover:bg-danger-subtle transition-colors duration-100"
        @click="close"
      >
        <X :size="14" />
      </button>
    </div>
  </header>
</template>
