<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore } from '@/stores/project'
import { FileText, Users, BookOpen, PenTool } from 'lucide-vue-next'

const projectStore = useProjectStore()
const project = computed(() => projectStore.activeProject)

interface StatItem {
  label: string
  value: string | number
  icon: any
  detail?: string
}

const stats = computed<StatItem[]>(() => {
  const p = project.value
  if (!p) return []

  const totalWords = p.chapters.reduce((sum, ch) => {
    const content = ch.polishedContent || ch.proofreadContent || ch.content
    return sum + countWords(content)
  }, 0)

  const completedChapters = p.chapters.filter(ch =>
    ch.polishedContent || ch.proofreadContent || ch.content
  ).length

  return [
    {
      label: 'Chapters',
      value: p.chapters.length,
      icon: FileText,
      detail: `${completedChapters} written`,
    },
    {
      label: 'Characters',
      value: p.characters.length,
      icon: Users,
      detail: `${p.characters.filter(c => c.role === 'protagonist').length} protagonist`,
    },
    {
      label: 'Words',
      value: formatNumber(totalWords),
      icon: PenTool,
      detail: p.length === 'short' ? '~5k target' : p.length === 'medium' ? '~20k target' : '~50k target',
    },
    {
      label: 'Knowledge',
      value: p.knowledgeBaseIds.length,
      icon: BookOpen,
      detail: 'bases linked',
    },
  ]
})

function countWords(text: string): number {
  if (!text) return 0
  return text.trim().split(/\s+/).filter(Boolean).length
}

function formatNumber(num: number): string {
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k'
  }
  return num.toString()
}
</script>

<template>
  <div v-if="project" class="space-y-3">
    <h3 class="text-xs font-medium text-text-secondary uppercase tracking-wider">Project Stats</h3>
    <div class="grid grid-cols-2 gap-2">
      <div
        v-for="stat in stats"
        :key="stat.label"
        class="rounded-lg border border-surface-4 bg-surface-2 p-3"
      >
        <div class="flex items-center gap-2 mb-1">
          <component :is="stat.icon" :size="12" class="text-text-muted" />
          <span class="text-2xs text-text-muted">{{ stat.label }}</span>
        </div>
        <div class="text-lg font-semibold text-text-primary">{{ stat.value }}</div>
        <div v-if="stat.detail" class="text-2xs text-text-muted mt-0.5">{{ stat.detail }}</div>
      </div>
    </div>
  </div>
</template>