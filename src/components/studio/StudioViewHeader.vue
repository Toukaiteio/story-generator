<script setup lang="ts">
import { computed } from 'vue'
import { PanelRightOpen, Settings2 } from 'lucide-vue-next'
import BaseDropdown from '@/components/ui/BaseDropdown.vue'
import StudioRail from './StudioRail.vue'
import type { DropdownItem } from '@/components/ui/dropdown'
import { useWorkspaceUi } from '@/app'
import { translatePhrase } from '@/i18n'
import type { StudioView } from './StudioRail.vue'

export type { StudioView } from './StudioRail.vue'

const props = defineProps<{
  view: StudioView
  title?: string
  meta?: string
  busy?: boolean
  menuItems?: DropdownItem[]
  menuWidth?: number
}>()

const emit = defineEmits<{ 'update:view': [value: StudioView] }>()

const tr = translatePhrase
const ui = useWorkspaceUi()

const openCopilot = () => { ui.workspaceCopilotOpen = !ui.workspaceCopilotOpen }

const overflow = computed<DropdownItem[]>(() => [
  ...(props.menuItems?.length ? [...props.menuItems, { divider: true }] : []),
  { heading: 'Workspace' },
  { label: 'Show view labels', checked: ui.studioRailExpanded, action: () => { ui.studioRailExpanded = !ui.studioRailExpanded } },
  { label: 'Copilot', icon: PanelRightOpen, checked: ui.workspaceCopilotOpen, action: openCopilot },
  { label: 'Story settings', icon: Settings2, action: () => { ui.storyConfigOpen = true } },
])
</script>

<template>
  <header class="studio-row flex h-12 shrink-0 items-center gap-2 px-3">
    <StudioRail
      :model-value="view"
      :expanded="ui.studioRailExpanded"
      @update:model-value="emit('update:view', $event)"
      @update:expanded="ui.studioRailExpanded = $event"
    />

    <span class="h-5 w-px shrink-0 bg-line" aria-hidden="true" />

    <div class="flex min-w-0 flex-1 items-center gap-2">
      <slot name="title">
        <h1 class="truncate text-title font-semibold text-text-primary">{{ title }}</h1>
      </slot>
      <span v-if="meta" class="shrink-0 text-meta text-text-muted">{{ meta }}</span>
    </div>

    <slot name="actions" />

    <BaseDropdown :items="overflow" :width="menuWidth">
      <template #trigger>
        <div class="capsule h-9 w-9 px-0" :aria-label="tr('More actions')">
          <span class="text-body leading-none">⋯</span>
        </div>
      </template>
    </BaseDropdown>
  </header>
</template>
