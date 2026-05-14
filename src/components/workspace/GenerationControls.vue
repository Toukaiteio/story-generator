<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'
import { exportProject, exportProjectEpub, type ExportFormat } from '@/services/export'
import BaseButton from '@/components/ui/BaseButton.vue'
import { Download } from 'lucide-vue-next'

const projectStore = useProjectStore()
const toast = useToast()
const tr = translatePhrase

const project = computed(() => projectStore.activeProject)

const canExportManuscript = computed(() =>
  !!project.value?.chapters.length && project.value.chapters.every(chapter => chapter.content.trim())
)

const exportDisabledReason = computed(() => {
  const p = project.value
  if (!p) return 'Open a project before exporting.'
  if (!p.chapters.length) return 'Generate or add chapter outlines before exporting.'

  const missing = p.chapters
    .filter(chapter => !chapter.content.trim())
    .sort((a, b) => a.index - b.index)

  if (missing.length) {
    const preview = missing.slice(0, 4).map(chapter => `Ch ${chapter.index + 1}`).join(', ')
    const suffix = missing.length > 4 ? ` and ${missing.length - 4} more` : ''
    return `Export is available after Writing is complete. Missing chapter text: ${preview}${suffix}.`
  }

  return ''
})

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

async function exportManuscript(format: Exclude<ExportFormat, 'json'>) {
  if (!project.value || !canExportManuscript.value) return
  try {
    if (format === 'epub') {
      const { data, filename } = await exportProjectEpub(project.value)
      downloadBlob(filename, new Blob([data as BlobPart], { type: 'application/epub+zip' }))
      toast.success('EPUB exported')
      return
    }

    const { content, filename } = exportProject(project.value, format)
    const mime = format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8'
    downloadBlob(filename, new Blob([content], { type: mime }))
    toast.success('Manuscript exported')
  } catch (error: any) {
    toast.error(error?.message || 'Export failed')
  }
}

</script>

<template>
  <div class="border-b border-surface-4 bg-surface-1 px-4 py-3">
    <div class="flex items-center justify-between gap-4">
      <div class="min-w-0">
        <p class="truncate text-xs font-semibold text-text-primary">{{ tr('Manuscript Export') }}</p>
        <p class="truncate text-[11px] text-text-muted">{{ tr('Stages are navigation only; optional review and polish passes do not block export.') }}</p>
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-2">
        <div
          class="group relative hidden md:flex items-center gap-1 rounded-md border border-surface-4 bg-surface-2 p-0.5"
          :aria-label="exportDisabledReason || tr('Export manuscript')"
        >
          <BaseButton variant="ghost" size="sm" :disabled="!canExportManuscript" @click="exportManuscript('markdown')">
            <Download :size="13" />
            <span>MD</span>
          </BaseButton>
          <BaseButton variant="ghost" size="sm" :disabled="!canExportManuscript" @click="exportManuscript('plaintext')">
            <Download :size="13" />
            <span>TXT</span>
          </BaseButton>
          <BaseButton variant="ghost" size="sm" :disabled="!canExportManuscript" @click="exportManuscript('epub')">
            <Download :size="13" />
            <span>EPUB</span>
          </BaseButton>
          <div
            v-if="!canExportManuscript"
            class="pointer-events-none absolute right-0 top-full z-50 mt-2 w-72 rounded-md border border-surface-4 bg-surface-1 px-3 py-2 text-xs leading-relaxed text-text-secondary opacity-0 shadow-xl transition-opacity duration-100 group-hover:opacity-100"
          >
            <p class="font-medium text-text-primary">{{ tr('Export unavailable') }}</p>
            <p class="mt-1">{{ tr(exportDisabledReason) }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
