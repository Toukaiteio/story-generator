<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import { useUiStore } from '@/stores/ui'
import {
  FolderOpen,
  PenTool,
  BookOpen,
  Palette,
  Server,
  Settings,
} from 'lucide-vue-next'
import BaseTooltip from '@/components/ui/BaseTooltip.vue'
import type { SidebarItem } from '@/types/common'

import { computed } from 'vue'

const router = useRouter()
const route = useRoute()
const ui = useUiStore()

interface NavItem {
  id: SidebarItem
  icon: any
  label: string
  route: string
}

const navItems = computed<NavItem[]>(() => [
  { id: 'projects', icon: FolderOpen, label: ui.t('sidebar.projects'), route: '/' },
  { id: 'workspace', icon: PenTool, label: ui.t('sidebar.workspace'), route: '/workspace' },
  { id: 'knowledge', icon: BookOpen, label: ui.t('sidebar.knowledge'), route: '/knowledge' },
  { id: 'writingStyles', icon: Palette, label: ui.t('sidebar.writingStyles'), route: '/styles' },
  { id: 'providers', icon: Server, label: ui.t('sidebar.providers'), route: '/providers' },
  { id: 'settings', icon: Settings, label: ui.t('sidebar.settings'), route: '/settings' },
])

function navigate(item: NavItem) {
  ui.navigateTo(item.id)
  router.push(item.route)
}

function isActive(item: NavItem): boolean {
  return route.path === item.route || (item.id === 'workspace' && route.path.startsWith('/workspace'))
}
</script>

<template>
  <aside class="flex flex-col w-12 h-full bg-surface-1 border-r border-surface-4 shrink-0">
    <div class="flex flex-col items-center flex-1 py-2 gap-1">
      <div class="w-8 h-8 flex items-center justify-center mb-2">
        <PenTool :size="20" class="text-accent" />
      </div>

      <BaseTooltip
        v-for="item in navItems"
        :key="item.id"
        :text="item.label"
        position="right"
      >
        <button
          :class="[
            'w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-100',
            isActive(item)
              ? 'bg-surface-3 text-text-primary'
              : 'text-text-muted hover:text-text-secondary hover:bg-surface-3/50',
          ]"
          @click="navigate(item)"
        >
          <component :is="item.icon" :size="18" />
        </button>
      </BaseTooltip>
    </div>
  </aside>
</template>
