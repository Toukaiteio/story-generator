<script setup lang="ts">
import { computed } from 'vue'
import { AlignLeft } from 'lucide-vue-next'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import { countWords } from '@/app'
import { translatePhrase } from '@/i18n'
import type { Chapter } from '@/types/chapter'

const props = defineProps<{
  chapters: Chapter[]
  activeChapterId: string | null
  busy?: boolean
}>()

const emit = defineEmits<{
  open: [chapterId: string]
  plan: [chapterId: string]
  planNext: []
}>()

const tr = translatePhrase

const statusMeta: Record<Chapter['status'], { label: string; className: string }> = {
  outline: { label: 'Idea', className: 'bg-surface-3 text-text-secondary' },
  writing: { label: 'Writing', className: 'bg-accent-subtle text-accent' },
  draft: { label: 'Draft', className: 'bg-accent-subtle text-accent' },
  proofreading: { label: 'Proofread', className: 'bg-warning-subtle text-warning' },
  proofread: { label: 'Proofread', className: 'bg-warning-subtle text-warning' },
  polishing: { label: 'Polish', className: 'bg-warning-subtle text-warning' },
  polished: { label: 'Final', className: 'bg-success-subtle text-success' },
}

const timeline = computed(() => [...props.chapters].sort((a, b) => a.index - b.index))

function statusOf(chapter: Chapter) {
  return statusMeta[chapter.status] ?? statusMeta.outline
}

function wordCount(chapter: Chapter) {
  return countWords(chapter.content || chapter.polishedContent)
}
</script>

<template>
  <div class="flex min-h-0 flex-col pb-2">
    <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
      <ol class="relative space-y-1">
        <li v-for="chapter in timeline" :key="chapter.id" class="relative">
          <button
            type="button"
            class="w-full rounded-ios px-3 py-2.5 text-left transition-colors"
            :class="chapter.id === activeChapterId ? 'bg-surface-1 shadow-ios-pill' : 'hover:bg-surface-1/60'"
            @click="emit('open', chapter.id)"
          >
            <div class="flex items-center gap-2">
              <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-meta font-semibold" :class="statusOf(chapter).className">
                {{ chapter.index + 1 }}
              </span>
              <span class="min-w-0 flex-1 truncate text-caption font-medium text-text-primary">{{ chapter.title }}</span>
            </div>
            <div class="mt-1.5 flex items-center gap-2 pl-8">
              <span class="inline-flex h-5 items-center rounded-full px-2 text-meta font-medium" :class="statusOf(chapter).className">
                {{ tr(statusOf(chapter).label) }}
              </span>
              <span class="text-meta text-text-muted">{{ wordCount(chapter) }} {{ tr('words') }}</span>
            </div>
            <p v-if="chapter.outline.objective" class="mt-1 line-clamp-2 pl-8 text-meta leading-relaxed text-text-secondary">
              {{ chapter.outline.objective }}
            </p>
          </button>
          <button
            type="button"
            class="absolute right-1.5 top-1.5 hidden h-7 w-7 items-center justify-center rounded-full text-text-muted hover:bg-surface-2 hover:text-accent"
            :title="tr('Plan this chapter')"
            :disabled="busy"
            @click.stop="emit('plan', chapter.id)"
          >
            <Sparkles :size="14" />
          </button>
        </li>

        <li v-if="!timeline.length" class="flex flex-col items-center gap-2 px-3 py-8 text-center">
          <AlignLeft :size="20" class="text-text-muted" />
          <p class="text-meta text-text-muted">{{ tr('No chapters yet') }}</p>
        </li>
      </ol>
    </div>

    <div class="mt-2 flex items-center justify-between gap-1 border-t border-line px-4 pt-2">
      <AppSidebar />
    </div>
  </div>
</template>
