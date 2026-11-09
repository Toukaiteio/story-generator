<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen, FileDown, MoreVertical, Trash2, FolderOpen, Link, Unlink, RefreshCw, Search, Calendar } from 'lucide-vue-next'
import type { StoryProject } from '@/types/project'
import type { ProjectExportBinding } from '@/app'
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
  remove: [id: string]
  delete: [id: string]
  exportFormat: [id: string, format: 'markdown' | 'json' | 'plaintext' | 'epub']
  exportProjectFile: [id: string]
  bindExportDirectory: [id: string]
  syncExport: [id: string]
  unbindExportDirectory: [id: string]
  reveal: [path: string]
}>()

const tr = translatePhrase

const statusVariant = computed(() => {
  const map: Record<string, string> = {
    draft: 'default',
    generating: 'warning',
    completed: 'success',
    error: 'danger',
  }
  return (map[props.project.status] ?? 'default') as 'default' | 'warning' | 'success' | 'danger'
})

const exportBinding = computed(() => props.exportBinding ?? null)

const formattedDate = computed(() =>
  new Date(props.project.updatedAt).toLocaleDateString(document.documentElement.lang || 'zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }),
)

const dropdownItems = computed(() => [
  { label: 'Open', icon: FolderOpen, action: () => emit('open', props.project.id) },
  { label: 'Reveal in folder', icon: Search, action: () => emit('reveal', props.project.directoryPath) },
  { label: exportBinding.value ? 'Rebind export directory' : 'Bind export directory', icon: Link, action: () => emit('bindExportDirectory', props.project.id) },
  { label: 'Sync export now', icon: RefreshCw, disabled: !exportBinding.value || props.isExportSyncing, action: () => emit('syncExport', props.project.id) },
  ...(exportBinding.value ? [{ label: 'Unbind export directory', icon: Unlink, danger: true, action: () => emit('unbindExportDirectory', props.project.id) }] : []),
  { divider: true },
  { label: 'Export project file', icon: FileDown, action: () => emit('exportProjectFile', props.project.id) },
  { label: 'Export Markdown', icon: FileDown, action: () => emit('exportFormat', props.project.id, 'markdown') },
  { label: 'Export JSON', icon: FileDown, action: () => emit('exportFormat', props.project.id, 'json') },
  { label: 'Export plain text', icon: FileDown, action: () => emit('exportFormat', props.project.id, 'plaintext') },
  { label: 'Export EPUB', icon: FileDown, action: () => emit('exportFormat', props.project.id, 'epub') },
  { divider: true },
  { label: 'Remove from library', icon: FileDown, action: () => emit('remove', props.project.id) },
  { divider: true },
  { label: 'Delete', icon: Trash2, danger: true, action: () => emit('delete', props.project.id) },
])
</script>

<template>
  <article
    class="group relative cursor-pointer rounded-ios border border-transparent bg-surface-1 p-5 shadow-ios-pill transition-colors hover:border-accent/40"
    @click="emit('open', project.id)"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2.5">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-accent">
          <BookOpen :size="17" />
        </span>
        <h3 class="truncate text-body font-semibold text-text-primary">{{ project.name }}</h3>
      </div>
      <div class="shrink-0" @click.stop>
        <BaseDropdown :items="dropdownItems">
          <template #trigger>
            <div class="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-2 hover:text-text-secondary">
              <MoreVertical :size="16" />
            </div>
          </template>
        </BaseDropdown>
      </div>
    </div>

    <p class="mt-3 line-clamp-2 min-h-10 text-caption leading-relaxed text-text-secondary">
      {{ project.theme || tr('No premise yet') }}
    </p>

    <div class="mt-3 flex flex-wrap items-center gap-1.5">
      <BaseTag v-if="project.genre" variant="accent" size="sm">{{ project.genre }}</BaseTag>
      <BaseTag size="sm">{{ project.language || 'English' }}</BaseTag>
      <BaseTag size="sm">{{ project.chapters.length }} / {{ project.chapterCount }} {{ tr('chapters') }}</BaseTag>
      <BaseTag :variant="statusVariant" size="sm">{{ tr(project.status) }}</BaseTag>
      <BaseTag v-if="exportBinding" variant="success" size="sm" :title="exportBinding.filePath">{{ tr('Linked') }}</BaseTag>
      <BaseTag v-if="exportBinding?.lastError" variant="danger" size="sm" :title="exportBinding.lastError">{{ tr('Sync error') }}</BaseTag>
      <BaseTag v-if="isExportSyncing" variant="warning" size="sm">{{ tr('Syncing') }}</BaseTag>
    </div>

    <div class="mt-3 flex items-center gap-1.5 text-meta text-text-muted">
      <Calendar :size="12" />
      <span>{{ formattedDate }}</span>
    </div>
  </article>
</template>
