<script setup lang="ts">
import { computed } from 'vue'
import { Plus, Sparkles } from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'
import ChapterCard from './ChapterCard.vue'
import { translatePhrase } from '@/i18n'
import type { Chapter } from '@/types/chapter'

const props = defineProps<{
  chapters: Chapter[]
  busy?: boolean
}>()

const emit = defineEmits<{
  open: [chapterId: string]
  write: [chapterId: string]
  proofread: [chapterId: string]
  polish: [chapterId: string]
  plan: [chapterId: string]
  planNext: []
}>()

const tr = translatePhrase

const columns = computed(() => [
  {
    key: 'plan',
    label: 'Plan',
    match: (chapter: Chapter) => chapter.status === 'outline',
  },
  {
    key: 'draft',
    label: 'Draft',
    match: (chapter: Chapter) => ['writing', 'draft'].includes(chapter.status),
  },
  {
    key: 'review',
    label: 'Review',
    match: (chapter: Chapter) => ['proofreading', 'proofread', 'polishing'].includes(chapter.status),
  },
  {
    key: 'final',
    label: 'Final',
    match: (chapter: Chapter) => chapter.status === 'polished',
  },
])

const grouped = computed(() =>
  columns.value.map(column => ({
    ...column,
    chapters: props.chapters.filter(column.match),
  })),
)
</script>

<template>
  <div class="flex h-full min-h-0 gap-3 overflow-x-auto p-3">
    <section
      v-for="column in grouped"
      :key="column.key"
      class="flex h-full w-64 shrink-0 flex-col rounded-2xl bg-surface-1"
    >
      <header class="flex items-center justify-between px-3 py-2.5">
        <h3 class="text-2xs font-bold uppercase tracking-wider text-text-secondary">{{ tr(column.label) }}</h3>
        <span class="text-2xs text-text-muted">{{ column.chapters.length }}</span>
      </header>
      <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        <ChapterCard
          v-for="chapter in column.chapters"
          :key="chapter.id"
          :chapter="chapter"
          :busy="busy"
          @open="emit('open', chapter.id)"
          @write="emit('write', chapter.id)"
          @proofread="emit('proofread', chapter.id)"
          @polish="emit('polish', chapter.id)"
          @plan="emit('plan', chapter.id)"
        />
        <BaseButton
          v-if="column.key === 'plan'"
          variant="secondary"
          size="sm"
          class="!w-full !justify-start"
          :loading="busy"
          @click="emit('planNext')"
        >
          <Sparkles :size="13" />
          <span>{{ tr('Plan next chapter') }}</span>
        </BaseButton>
      </div>
    </section>
  </div>
</template>
