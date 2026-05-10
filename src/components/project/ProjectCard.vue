<script setup lang="ts">
import { computed } from 'vue'
import { Calendar, BookOpen, MoreVertical, Trash2, FolderOpen, FileDown, Link, Unlink, RefreshCw, Search } from 'lucide-vue-next'
import type { StoryProject } from '@/types/project'
import type { ProjectExportBinding } from '@/services/projectExportSync'
import { translatePhrase } from '@/i18n'
import BaseTag from '@/components/ui/BaseTag.vue'
import BaseDropdown from '@/components/ui/BaseDropdown.vue'

const props = defineProps<{
  project: StoryProject
  exportBinding?: ProjectExportBinding | null
  isExportSyncing?: boolean
}>()

const emit = defineEmits<{
  open: [id: string]
  delete: [id: string]
  export: [id: string]
  bindExportDirectory: [id: string]
  syncExport: [id: string]
  unbindExportDirectory: [id: string]
  reveal: [path: string]
}>()

const statusVariant = computed(() => {
  const map: Record<string, string> = {
    draft: 'default',
    generating: 'warning',
    completed: 'success',
    error: 'danger',
  }
  return (map[props.project.status] ?? 'default') as 'default' | 'warning' | 'success' | 'danger'
})

const languageLabel = computed(() => props.project.language || 'English')
const exportBinding = computed(() => props.exportBinding ?? null)
const tr = translatePhrase

const formattedDate = computed(() => {
  const date = new Date(props.project.updatedAt)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
})

const dropdownItems = computed(() => [
  { label: 'Open', icon: FolderOpen, action: () => emit('open', props.project.id) },
  { label: 'Reveal in Explorer', icon: Search, action: () => emit('reveal', props.project.directoryPath) },
  { label: exportBinding.value ? 'Rebind Export Directory' : 'Bind Export Directory', icon: Link, action: () => emit('bindExportDirectory', props.project.id) },
  { label: 'Sync Export Now', icon: RefreshCw, disabled: !exportBinding.value || props.isExportSyncing, action: () => emit('syncExport', props.project.id) },
  ...(exportBinding.value ? [{ label: 'Unbind Export Directory', icon: Unlink, danger: true, action: () => emit('unbindExportDirectory', props.project.id) }] : []),
  { label: 'Export Project File', icon: FileDown, action: () => emit('export', props.project.id) },
  { divider: true },
  { label: 'Delete', icon: Trash2, danger: true, action: () => emit('delete', props.project.id) },
])
</script>

<template>
  <div
    class="group relative rounded-lg border border-surface-4 bg-surface-2 p-4 cursor-pointer transition-all duration-100 hover:border-surface-5 hover:bg-surface-3 active:scale-[0.99]"
    @click="emit('open', project.id)"
  >
    <div class="flex items-start justify-between mb-3">
      <div class="flex items-center gap-2 min-w-0">
        <BookOpen :size="16" class="text-accent shrink-0" />
        <h3 class="text-sm font-semibold text-text-primary truncate">{{ project.name }}</h3>
      </div>
      <div class="opacity-0 group-hover:opacity-100 transition-opacity duration-100" @click.stop>
        <BaseDropdown :items="dropdownItems">
          <template #trigger>
            <div class="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-surface-4 transition-colors duration-100">
              <MoreVertical :size="14" />
            </div>
          </template>
        </BaseDropdown>
      </div>
    </div>

    <p class="text-xs text-text-secondary line-clamp-2 mb-3 min-h-[2rem]">
      {{ project.theme || tr('No theme specified') }}
    </p>

    <div class="flex items-center gap-2 flex-wrap">
      <BaseTag v-if="project.genre" variant="accent" size="sm">{{ project.genre }}</BaseTag>
      <BaseTag size="sm">{{ languageLabel }}</BaseTag>
      <BaseTag size="sm">{{ project.chapterCount }} {{ tr('chapters') }}</BaseTag>
      <BaseTag :variant="statusVariant" size="sm">{{ tr(project.status) }}</BaseTag>
      <BaseTag v-if="exportBinding" variant="success" size="sm" :title="exportBinding.filePath">{{ tr('Linked') }}</BaseTag>
      <BaseTag v-if="exportBinding?.lastError" variant="danger" size="sm" :title="exportBinding.lastError">{{ tr('Sync error') }}</BaseTag>
      <BaseTag v-if="isExportSyncing" variant="warning" size="sm">{{ tr('Syncing') }}</BaseTag>
    </div>

    <div class="flex items-center gap-1.5 mt-3 text-2xs text-text-muted">
      <Calendar :size="12" />
      <span>{{ formattedDate }}</span>
      <span class="mx-1">·</span>
      <span>{{ project.chapters.length }} {{ tr('chapters') }}</span>
    </div>
  </div>
</template>
