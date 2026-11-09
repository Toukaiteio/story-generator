<script setup lang="ts">
import { computed, ref } from 'vue'
import { LayoutGrid, Rows3, Sparkles } from 'lucide-vue-next'
import ChapterCard from './ChapterCard.vue'
import StudioViewHeader from './StudioViewHeader.vue'
import { translatePhrase } from '@/i18n'
import type { DropdownItem } from '@/components/ui/dropdown'
import type { StudioView } from './StudioViewHeader.vue'
import type { Chapter } from '@/types/chapter'

const props = defineProps<{
  chapters: Chapter[]
  activeChapterId?: string | null
  busy?: boolean
  inert?: boolean
}>()

const emit = defineEmits<{
  open: [chapterId: string]
  plan: [chapterId: string]
  planNext: []
  proofread: [chapterId: string]
  polish: [chapterId: string]
  syncElements: [chapterId: string]
  switchView: [view: StudioView]
}>()

const tr = translatePhrase

type SortKey = 'index' | 'title' | 'status'

const sort = ref<SortKey>('index')
const collapsed = ref<string[]>([])
const statusFilter = ref<string>('all')

const columns = computed(() => [
  { key: 'idea', label: 'Ideas', match: (chapter: Chapter) => chapter.status === 'outline' },
  { key: 'draft', label: 'Drafting', match: (chapter: Chapter) => ['writing', 'draft'].includes(chapter.status) },
  { key: 'review', label: 'Revision', match: (chapter: Chapter) => ['proofreading', 'proofread', 'polishing'].includes(chapter.status) },
  { key: 'final', label: 'Final', match: (chapter: Chapter) => chapter.status === 'polished' },
])

const visibleColumns = computed(() =>
  columns.value.filter(column => statusFilter.value === 'all' || statusFilter.value === column.key),
)

const grouped = computed(() =>
  visibleColumns.value.map(column => ({
    ...column,
    chapters: props.chapters.filter(column.match).sort((a, b) => {
      if (sort.value === 'title') return a.title.localeCompare(b.title, document.documentElement.lang || 'zh-CN')
      if (sort.value === 'status') return a.status.localeCompare(b.status)
      return a.index - b.index
    }),
  })),
)

function toggleColumn(key: string) {
  collapsed.value = collapsed.value.includes(key)
    ? collapsed.value.filter(item => item !== key)
    : [...collapsed.value, key]
}

const headerActions = computed<DropdownItem[]>(() => [
  { heading: 'Columns' },
  { label: 'All columns', checked: statusFilter.value === 'all', action: () => { statusFilter.value = 'all' } },
  ...columns.value.map(column => ({
    label: column.label,
    checked: statusFilter.value === column.key,
    action: () => { statusFilter.value = column.key },
  })),
  { divider: true },
  { heading: 'Sort by' },
  { label: 'Chapter order', checked: sort.value === 'index', action: () => { sort.value = 'index' } },
  { label: 'Title', checked: sort.value === 'title', action: () => { sort.value = 'title' } },
  { label: 'Status', checked: sort.value === 'status', action: () => { sort.value = 'status' } },
])
</script>

<template>
  <div class="flex h-full min-h-0 min-w-0 flex-col" :inert="inert">
    <StudioViewHeader
      view="board"
      :title="statusFilter === 'all' ? tr('All chapters') : tr(columns.find(column => column.key === statusFilter)?.label ?? 'All chapters')"
      :meta="`${chapters.length} ${tr('chapters')}`"
      :menu-items="headerActions"
      @update:view="emit('switchView', $event)"
    >
      <template #actions>
        <button class="app-key-action h-9 gap-1.5 px-3.5 text-caption" :disabled="busy" @click="emit('planNext')">
          <Sparkles :size="15" />
          <span>{{ tr('Plan next chapter') }}</span>
        </button>
      </template>
    </StudioViewHeader>

    <div class="flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto px-4 pb-4 pt-3">
      <section
        v-for="column in grouped"
        :key="column.key"
        class="flex min-h-0 flex-1 min-w-[220px] flex-col rounded-ios-lg bg-surface-2/70 p-2"
      >
        <header class="flex items-center justify-between px-4 pb-2 pt-1">
          <button
            type="button"
            class="flex items-center gap-1.5 text-caption font-semibold text-text-secondary"
            :title="tr('Collapse')"
            @click="toggleColumn(column.key)"
          >
            <Rows3 :size="13" class="text-text-muted" />
            {{ tr(column.label) }}
          </button>
          <span class="rounded-full bg-surface-1 px-2 py-0.5 text-meta font-medium text-text-muted">{{ column.chapters.length }}</span>
        </header>

        <div v-if="!collapsed.includes(column.key)" class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-5 pt-4">
          <ChapterCard
            v-for="chapter in column.chapters"
            :key="chapter.id"
            :chapter="chapter"
            :busy="busy"
            :active="chapter.id === activeChapterId"
            @open="emit('open', chapter.id)"
            @plan="emit('plan', chapter.id)"
            @proofread="emit('proofread', chapter.id)"
            @polish="emit('polish', chapter.id)"
            @sync-elements="emit('syncElements', chapter.id)"
          />
        </div>
        <button
          v-else
          type="button"
          class="flex flex-1 items-start justify-center rounded-ios px-4 py-3 text-meta text-text-muted hover:bg-surface-1/60"
          :title="tr('Expand')"
          @click="toggleColumn(column.key)"
        >
          <LayoutGrid :size="16" />
        </button>
      </section>
    </div>
  </div>
</template>
