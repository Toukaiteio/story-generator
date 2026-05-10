<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useGenerationStore } from '@/stores/generation'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'
import { exportProject, exportProjectEpub, type ExportFormat } from '@/services/export'
import { isChapterPlanComplete } from '@/services/generation/flow'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import { ArrowRight, Play, Square, CheckCircle2, Circle, Loader2, Download } from 'lucide-vue-next'

const projectStore = useProjectStore()
const genStore = useGenerationStore()
const toast = useToast()
const tr = translatePhrase

const project = computed(() => projectStore.activeProject)

const stages = [
  { key: 'planning', label: 'Planning' },
  { key: 'chapter-outline', label: 'Chapters' },
  { key: 'writing', label: 'Writing' },
  { key: 'proofreading', label: 'Proofread' },
  { key: 'polishing', label: 'Polish' },
]

const nextAction = computed(() => project.value ? genStore.getNextAction(project.value) : { stage: 'done' as const })

const nextStepLabel = computed(() => {
  if (nextAction.value.stage === 'chapter-outline' && typeof nextAction.value.chapterIndex === 'number') {
    return 'Complete Current Chapter'
  }
  return 'Next Step'
})

const stageStatus = computed(() => {
  const p = project.value
  return stages.map(stage => {
    let done = false

    if (!p) {
      done = false
    } else if (stage.key === 'planning') {
      done = !!p.outline.trim() && p.characters.length > 0
    } else if (stage.key === 'chapter-outline') {
      done = p.chapters.length > 0 && p.chapters.every(isChapterPlanComplete)
    } else if (stage.key === 'writing') {
      done = p.chapters.length > 0 && p.chapters.every(ch => ch.content.trim())
    } else if (stage.key === 'proofreading') {
      done = p.chapters.length > 0 && p.chapters.every(ch => ['proofread', 'polishing', 'polished'].includes(ch.status))
    } else if (stage.key === 'polishing') {
      done = p.chapters.length > 0 && p.chapters.every(ch => ch.content.trim() && ch.status === 'polished')
    }

    return { ...stage, done, isActive: genStore.isGenerating && genStore.currentStage === stage.key }
  })
})

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

async function generateNextStep() {
  if (!project.value) return
  try {
    await genStore.generateNextStage(project.value.id)
  } catch (error: any) {
    toast.error(error?.message || 'Generation failed')
  }
}

async function startGeneration() {
  if (!project.value) return
  try {
    await genStore.generateAll(project.value.id)
  } catch (error: any) {
    toast.error(error?.message || 'Generation failed')
  }
}

function cancelGeneration() {
  genStore.cancelGeneration()
}
</script>

<template>
  <div class="border-b border-surface-4 bg-surface-1 px-4 py-3">
    <div class="flex items-center justify-between gap-4">
      <!-- Stage Progress -->
      <div class="flex items-center gap-1">
        <div
          v-for="stage in stageStatus"
          :key="stage.key"
          class="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs"
          :class="{
            'bg-accent-subtle text-accent': stage.isActive,
            'text-success': stage.done && !stage.isActive,
            'text-text-muted': !stage.done && !stage.isActive,
          }"
        >
          <Loader2 v-if="stage.isActive" :size="10" class="animate-spin" />
          <CheckCircle2 v-else-if="stage.done" :size="10" />
          <Circle v-else :size="10" />
          <span>{{ tr(stage.label) }}</span>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-2">
        <BaseTag v-if="genStore.isGenerating" variant="warning" size="sm">
          {{ tr(genStore.progressMessage || 'Generating...') }}
        </BaseTag>

        <div
          v-if="!genStore.isGenerating"
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

        <BaseButton
          v-if="!genStore.isGenerating"
          variant="ghost"
          size="sm"
          :disabled="nextAction.stage === 'done'"
          @click="generateNextStep"
        >
          <ArrowRight :size="14" />
          <span>{{ tr(nextStepLabel) }}</span>
        </BaseButton>

        <BaseButton
          v-if="!genStore.isGenerating"
          variant="primary"
          size="sm"
          @click="startGeneration"
        >
          <Play :size="14" />
          <span>{{ tr('Generate All') }}</span>
        </BaseButton>

        <BaseButton
          v-else
          variant="danger"
          size="sm"
          @click="cancelGeneration"
        >
          <Square :size="14" />
          <span>{{ tr('Stop') }}</span>
        </BaseButton>
      </div>
    </div>

    <!-- Error Messages -->
    <div v-if="genStore.errors.length" class="mt-2">
      <div
        v-for="error in genStore.errors.slice(-3)"
        :key="error.id"
        class="text-xs text-danger mt-1"
      >
        {{ error.message }}
      </div>
    </div>
  </div>
</template>
