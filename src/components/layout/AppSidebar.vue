<script setup lang="ts">
import { BookOpen, Palette, Server, Settings } from 'lucide-vue-next'
import { useWorkspaceUi } from '@/app'
import { translatePhrase } from '@/i18n'

const ui = useWorkspaceUi()

const resources = [
  { key: 'knowledge', label: 'Knowledge', short: 'Sources', icon: BookOpen, open: () => ui.openDrawer('knowledge') },
  { key: 'styles', label: 'Writing styles', short: 'Styles', icon: Palette, open: () => ui.openDrawer('styles') },
  { key: 'models', label: 'Models', short: 'Models', icon: Server, open: () => ui.openDrawer('models') },
  { key: 'settings', label: 'Settings', short: 'Settings', icon: Settings, open: () => ui.openDrawer('settings') },
]
</script>

<template>
  <div class="grid w-full grid-cols-4 gap-0.5">
    <button
      v-for="item in resources"
      :key="item.key"
      type="button"
      class="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-ios text-text-muted transition-colors hover:bg-surface-1 hover:text-text-primary"
      :aria-label="translatePhrase(item.label)"
      :title="translatePhrase(item.label)"
      @click="item.open()"
    >
      <component :is="item.icon" :size="16" />
      <span class="max-w-full truncate px-0.5 text-meta">{{ translatePhrase(item.short) }}</span>
    </button>
  </div>
</template>
