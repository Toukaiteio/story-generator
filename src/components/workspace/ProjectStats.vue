<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore } from '@/stores/project'
import { estimateTokens } from '@/services/knowledge/chunker'
import { translatePhrase } from '@/i18n'
import { FileText, Users, BookOpen, PenTool } from 'lucide-vue-next'

const projectStore = useProjectStore()
const tr = translatePhrase
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

  const totalTokens = p.chapters.reduce((sum, ch) => {
    const content = ch.content
    return sum + estimateTokens(content)
  }, 0)

  const completedChapters = p.chapters.filter(ch =>
    ch.content
  ).length

  return [
    {
      label: 'Chapters',
      value: p.chapters.length,
      icon: FileText,
      detail: `${completedChapters} ${tr('written')}`,
    },
    {
      label: 'Characters',
      value: p.characters.length,
      icon: Users,
      detail: `${p.characters.filter(c => c.role === 'protagonist').length} ${tr('protagonist')}`,
    },
    {
      label: 'Tokens',
      value: formatNumber(totalTokens),
      icon: PenTool,
      detail: 'CJK-aware estimate',
    },
    {
      label: 'Knowledge',
      value: p.knowledgeBaseIds.length,
      icon: BookOpen,
      detail: 'bases linked',
    },
  ]
})

function formatNumber(num: number): string {
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k'
  }
  return num.toString()
}
</script>

<template>
  <div v-if="project" class="space-y-3">
    <h3 class="text-xs font-medium text-text-secondary uppercase tracking-wider">{{ tr('Project Stats') }}</h3>
    <div class="grid grid-cols-2 gap-2">
      <div
        v-for="stat in stats"
        :key="stat.label"
        class="rounded-lg border border-surface-4 bg-surface-2 p-3"
      >
        <div class="flex items-center gap-2 mb-1">
          <component :is="stat.icon" :size="12" class="text-text-muted" />
          <span class="text-2xs text-text-muted">{{ tr(stat.label) }}</span>
        </div>
        <div class="text-lg font-semibold text-text-primary">{{ stat.value }}</div>
        <div v-if="stat.detail" class="text-2xs text-text-muted mt-0.5">{{ tr(stat.detail) }}</div>
      </div>
    </div>
  </div>
</template>
