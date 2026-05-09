<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useUiStore } from '@/stores/ui'
import { estimateTokens } from '@/services/knowledge/chunker'
import { CheckCircle2, Circle, Clock, PenTool } from 'lucide-vue-next'

const projectStore = useProjectStore()
const ui = useUiStore()
const project = computed(() => projectStore.activeProject)

interface ChapterStatus {
  id: string
  index: number
  title: string
  status: 'empty' | 'outline' | 'draft' | 'proofread' | 'polished'
  tokenCount: number
}

const chapters = computed<ChapterStatus[]>(() => {
  const p = project.value
  if (!p) return []

  return p.chapters.map(ch => {
    let status: ChapterStatus['status'] = 'empty'
    if (ch.polishedContent) status = 'polished'
    else if (['proofread', 'polishing', 'polished'].includes(ch.status)) status = 'proofread'
    else if (ch.content) status = 'draft'
    else if (ch.outline.objective || ch.outline.endingHook) status = 'outline'

    const content = ch.polishedContent || ch.content
    const tokenCount = estimateTokens(content)

    return {
      id: ch.id,
      index: ch.index,
      title: ch.title,
      status,
      tokenCount,
    }
  })
})

const completionRate = computed(() => {
  if (!chapters.value.length) return 0
  const completed = chapters.value.filter(ch => ch.status === 'polished' || ch.status === 'proofread').length
  return Math.round((completed / chapters.value.length) * 100)
})

function navigateToChapter(chapterId: string) {
  ui.setWorkspaceNode(`chapter-${chapterId}`)
}

function statusIcon(status: ChapterStatus['status']) {
  switch (status) {
    case 'polished': return CheckCircle2
    case 'proofread': return CheckCircle2
    case 'draft': return PenTool
    case 'outline': return Clock
    default: return Circle
  }
}

function statusColor(status: ChapterStatus['status']) {
  switch (status) {
    case 'polished': return 'text-success'
    case 'proofread': return 'text-accent'
    case 'draft': return 'text-warning'
    case 'outline': return 'text-text-muted'
    default: return 'text-text-muted/50'
  }
}
</script>

<template>
  <div v-if="project && chapters.length" class="space-y-3">
    <div class="flex items-center justify-between">
      <h3 class="text-xs font-medium text-text-secondary uppercase tracking-wider">Chapter Progress</h3>
      <span class="text-2xs text-text-muted">{{ completionRate }}% complete</span>
    </div>

    <div class="space-y-1">
      <button
        v-for="chapter in chapters"
        :key="chapter.id"
        class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-surface-3 transition-colors"
        @click="navigateToChapter(chapter.id)"
      >
        <component
          :is="statusIcon(chapter.status)"
          :size="12"
          :class="statusColor(chapter.status)"
        />
        <span class="text-xs text-text-primary truncate flex-1">
          Ch{{ chapter.index + 1 }}: {{ chapter.title }}
        </span>
        <span v-if="chapter.tokenCount" class="text-2xs text-text-muted">
          {{ chapter.tokenCount }} tok
        </span>
      </button>
    </div>
  </div>
</template>
