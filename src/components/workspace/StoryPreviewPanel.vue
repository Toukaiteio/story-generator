<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useToast } from '@/composables/useToast'
import { exportProject, exportProjectEpub, type ExportFormat } from '@/services/export'
import { BookOpen, Download, ChevronDown } from 'lucide-vue-next'
import EmptyState from '@/components/ui/EmptyState.vue'
import BaseButton from '@/components/ui/BaseButton.vue'

const projectStore = useProjectStore()
const toast = useToast()
const project = computed(() => projectStore.activeProject)
const chapters = computed(() => project.value?.chapters ?? [])
const showExportMenu = ref(false)
const exportMenuRef = ref<HTMLElement | null>(null)

function uint8ToBase64(data: Uint8Array): string {
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function handleClickOutside(e: MouseEvent) {
  if (exportMenuRef.value && !exportMenuRef.value.contains(e.target as Node)) {
    showExportMenu.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', handleClickOutside))
onUnmounted(() => document.removeEventListener('mousedown', handleClickOutside))

const exportFormats: { format: ExportFormat; label: string; extension: string }[] = [
  { format: 'markdown', label: 'Markdown', extension: '.md' },
  { format: 'json', label: 'JSON', extension: '.json' },
  { format: 'plaintext', label: 'Plain Text', extension: '.txt' },
  { format: 'epub', label: 'EPUB', extension: '.epub' },
]

async function handleExport(format: ExportFormat) {
  if (!project.value) return
  showExportMenu.value = false

  try {
    if (format === 'epub') {
      const { data, filename } = await exportProjectEpub(project.value)
      const base64 = uint8ToBase64(data)
      const saved = await window.electronAPI?.file?.writeBinary?.(
        `${filename}`,
        base64
      )
      if (saved) {
        toast.success(`Exported ${filename}`)
      } else {
        // Fallback: trigger download via blob
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
        const blob = new Blob([buffer], {
          type: 'application/epub+zip',
        })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
        toast.success(`Exported ${filename}`)
      }
    } else {
      const { content, filename } = exportProject(project.value, format)
      const saved = await window.electronAPI?.file?.write?.(`${filename}`, content)
      if (saved) {
        toast.success(`Exported ${filename}`)
      } else {
        const blob = new Blob([content], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
        toast.success(`Exported ${filename}`)
      }
    }
  } catch (error: any) {
    toast.error(error?.message || 'Export failed')
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div v-if="project" class="max-w-3xl mx-auto px-6 py-8">
      <div class="flex items-start justify-between mb-4">
        <div>
          <h1 class="text-2xl font-bold text-text-primary mb-1" style="font-family: Georgia, serif;">
            {{ project.name }}
          </h1>
          <p v-if="project.summary" class="text-sm text-text-secondary italic">{{ project.summary }}</p>
        </div>
        <div ref="exportMenuRef" class="relative">
          <BaseButton variant="secondary" size="sm" @click="showExportMenu = !showExportMenu">
            <Download :size="14" />
            <span>Export</span>
            <ChevronDown :size="12" />
          </BaseButton>
          <Transition name="fade">
            <div
              v-if="showExportMenu"
              class="absolute right-0 mt-1 w-40 rounded-md border border-surface-4 bg-surface-2 shadow-lg z-10"
            >
              <button
                v-for="f in exportFormats"
                :key="f.format"
                class="flex items-center justify-between w-full px-3 py-2 text-xs text-text-primary hover:bg-surface-3 transition-colors"
                @click="handleExport(f.format)"
              >
                <span>{{ f.label }}</span>
                <span class="text-text-muted">{{ f.extension }}</span>
              </button>
            </div>
          </Transition>
        </div>
      </div>

      <div class="space-y-8">
        <div v-for="chapter in chapters" :key="chapter.id">
          <h2
            class="text-lg font-semibold text-text-primary mb-4 pb-2 border-b border-surface-4"
            style="font-family: Georgia, serif;"
          >
            Chapter {{ chapter.index + 1 }}: {{ chapter.title }}
          </h2>
          <div
            class="text-sm text-text-primary whitespace-pre-wrap leading-relaxed"
            style="font-family: Georgia, serif; line-height: 1.8;"
          >
            {{ chapter.polishedContent || chapter.proofreadContent || chapter.content || 'No content yet.' }}
          </div>
        </div>
      </div>
    </div>

    <EmptyState
      v-else
      :icon="BookOpen"
      title="No project loaded"
      description="Open a project to see the story preview."
    />
  </div>
</template>
