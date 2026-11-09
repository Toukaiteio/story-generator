<script setup lang="ts">
import { computed, ref } from 'vue'
import { AlertTriangle, BookOpen, Check, ChevronDown, ChevronRight, CircleDashed, Copy, FileText, ListChecks, Search, Wrench, X } from 'lucide-vue-next'
import { translatePhrase } from '@/i18n'

export interface ToolCallStatusItem {
  id: string
  name: string
  status: 'pending' | 'running' | 'success' | 'warning' | 'error'
  title?: string
  description?: string
  detail?: string
  before?: string
  after?: string
}

const props = defineProps<{
  item: ToolCallStatusItem
}>()

const emit = defineEmits<{
  copy: [text: string]
}>()

const tr = translatePhrase
const isExpanded = ref(false)

const toolMeta = computed(() => {
  const map: Record<string, { label: string; description: string; icon: any; tone: string }> = {
    replace_chapter_content: {
      label: 'Replace chapter',
      description: 'Preparing a full chapter revision',
      icon: FileText,
      tone: 'accent',
    },
    replace_chapter_section: {
      label: 'Edit section',
      description: 'Rewriting a matched passage only',
      icon: Search,
      tone: 'warning',
    },
    get_chapter_region: {
      label: 'Read chapter region',
      description: 'Inspecting exact chapter text for a safer edit',
      icon: Search,
      tone: 'accent',
    },
    update_todolist: {
      label: 'Update todo list',
      description: 'Planning and tracking tool steps',
      icon: ListChecks,
      tone: 'accent',
    },
    insert_todolist_item: {
      label: 'Insert todo item',
      description: 'Adding a new todo item',
      icon: ListChecks,
      tone: 'accent',
    },
    modify_todolist_item: {
      label: 'Update todo item',
      description: 'Adjusting one todo item',
      icon: ListChecks,
      tone: 'accent',
    },
    get_chapter_word_count: {
      label: 'Count chapter words',
      description: 'Checking current chapter length',
      icon: FileText,
      tone: 'accent',
    },
    get_chapter_outline: {
      label: 'Read chapter outline',
      description: 'Inspecting structured chapter planning fields',
      icon: BookOpen,
      tone: 'accent',
    },
    replace_chapter_outline_field: {
      label: 'Update outline field',
      description: 'Changing one chapter planning field',
      icon: BookOpen,
      tone: 'warning',
    },
    rewrite_chapter_outline: {
      label: 'Rewrite chapter outline',
      description: 'Preparing a complete structured outline revision',
      icon: BookOpen,
      tone: 'accent',
    },
    replace_story_outline: {
      label: 'Replace story outline',
      description: 'Updating the master story outline',
      icon: BookOpen,
      tone: 'accent',
    },
    replace_story_characters: {
      label: 'Replace story characters',
      description: 'Updating character profiles',
      icon: FileText,
      tone: 'accent',
    },
    request_project_change: {
      label: 'Request project change',
      description: 'Submitting a change proposal for voting',
      icon: Wrench,
      tone: 'warning',
    },
    normalize_project_change: {
      label: 'Normalize project change',
      description: 'Converting proposal into executable change',
      icon: Wrench,
      tone: 'accent',
    },
    read_master_outline: {
      label: 'Read master outline',
      description: 'Fetching current master outline',
      icon: BookOpen,
      tone: 'accent',
    },
    replace_master_outline: {
      label: 'Replace master outline',
      description: 'Updating master outline content',
      icon: BookOpen,
      tone: 'accent',
    },
    clear_master_outline: {
      label: 'Clear master outline',
      description: 'Removing all master outline content',
      icon: BookOpen,
      tone: 'warning',
    },
    read_characters: {
      label: 'Read characters',
      description: 'Fetching current character entities',
      icon: FileText,
      tone: 'accent',
    },
    create_characters: {
      label: 'Create characters',
      description: 'Adding new character entities',
      icon: FileText,
      tone: 'accent',
    },
    update_characters: {
      label: 'Update characters',
      description: 'Applying updates to character entities',
      icon: FileText,
      tone: 'accent',
    },
    delete_characters: {
      label: 'Delete characters',
      description: 'Removing character entities',
      icon: FileText,
      tone: 'warning',
    },
    read_chapter_outline: {
      label: 'Read chapter plan',
      description: 'Fetching current chapter planning data',
      icon: BookOpen,
      tone: 'accent',
    },
    delete_chapter_outline_fields: {
      label: 'Delete chapter plan fields',
      description: 'Removing specific chapter planning fields',
      icon: BookOpen,
      tone: 'warning',
    },
    get_relationships_at_chapter: {
      label: 'Read chapter relationships',
      description: 'Loading relationship state at a chapter',
      icon: Search,
      tone: 'accent',
    },
    get_latest_relationships: {
      label: 'Read latest relationships',
      description: 'Loading latest relationship state',
      icon: Search,
      tone: 'accent',
    },
    get_relationship_between: {
      label: 'Read relationship pair',
      description: 'Loading relationship between two characters',
      icon: Search,
      tone: 'accent',
    },
    get_relationship_events: {
      label: 'Read relationship events',
      description: 'Loading relationship event history',
      icon: Search,
      tone: 'accent',
    },
    get_relationship_event: {
      label: 'Read relationship event',
      description: 'Loading one relationship event detail',
      icon: Search,
      tone: 'accent',
    },
    get_character_profile: {
      label: 'Read character profile',
      description: 'Loading character profile and links',
      icon: FileText,
      tone: 'accent',
    },
  }

  return map[props.item.name] ?? {
    label: props.item.name.replace(/_/g, ' '),
    description: 'Using tool',
    icon: Wrench,
    tone: 'default',
  }
})

const hasChangePreview = computed(() =>
  typeof props.item.before === 'string'
  && typeof props.item.after === 'string'
  && (props.item.before.trim() || props.item.after.trim())
)

function previewLines(value?: string) {
  const text = value?.trim() || ''
  if (!text) return []
  return text.split(/\r?\n/).filter(line => line.trim())
}

const removedLines = computed(() => previewLines(props.item.before))
const addedLines = computed(() => previewLines(props.item.after))

const statusConfig = computed(() => {
  switch (props.item.status) {
    case 'running':
    case 'pending':
      return { icon: CircleDashed, class: 'text-accent animate-spin' }
    case 'success':
      return { icon: Check, class: 'text-success' }
    case 'warning':
      return { icon: AlertTriangle, class: 'text-warning' }
    case 'error':
      return { icon: X, class: 'text-danger' }
    default:
      return { icon: CircleDashed, class: 'text-text-muted' }
  }
})

const detailCopyText = computed(() => [
  `Tool: ${props.item.name}`,
  `Status: ${props.item.status}`,
  props.item.detail ? `Detail:\n${props.item.detail}` : '',
].filter(Boolean).join('\n\n'))

function copyDetail(event: MouseEvent) {
  event.stopPropagation()
  if (detailCopyText.value) emit('copy', detailCopyText.value)
}
</script>

<template>
  <div class="group flex flex-col overflow-hidden rounded-ios bg-surface-2/70 transition-colors hover:bg-surface-2">
    <div
      class="flex min-h-[36px] cursor-pointer select-none items-center justify-between gap-2 px-3 py-1.5"
      @click="hasChangePreview ? (isExpanded = !isExpanded) : null"
    >
      <div class="flex min-w-0 items-center gap-2 text-text-secondary">
        <component :is="toolMeta.icon" :size="15" class="shrink-0" />
        <span class="truncate text-caption font-medium text-text-primary">{{ tr(item.title || toolMeta.label) }}</span>
        <span class="hidden truncate text-meta text-text-muted sm:inline">{{ tr(item.description || toolMeta.description) }}</span>
      </div>

      <div class="flex shrink-0 items-center gap-1.5">
        <div
          v-if="item.detail"
          class="hidden max-w-[110px] truncate rounded-full bg-surface-1 px-2 py-0.5 text-meta text-text-muted md:block"
        >
          {{ item.detail }}
        </div>
        <component :is="statusConfig.icon" :size="14" :class="statusConfig.class" stroke-width="2.5" />
        <button
          v-if="hasChangePreview"
          class="flex h-5 w-5 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text-primary"
        >
          <ChevronDown v-if="isExpanded" :size="14" />
          <ChevronRight v-else :size="14" />
        </button>
      </div>
    </div>

    <div v-if="item.status === 'error' || (item.status === 'warning' && item.detail)" class="border-t border-line bg-danger-subtle/60 px-3 py-2">
      <div class="flex items-start gap-2">
        <AlertTriangle v-if="item.status === 'warning'" :size="14" class="mt-0.5 shrink-0 text-warning" />
        <X v-else :size="14" class="mt-0.5 shrink-0 text-danger" />
        <p class="min-w-0 flex-1 whitespace-pre-wrap break-words text-meta leading-relaxed [overflow-wrap:anywhere]" :class="item.status === 'error' ? 'text-danger' : 'text-text-secondary'">
          {{ item.detail }}
        </p>
        <button
          v-if="item.detail"
          type="button"
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-1 hover:text-text-primary"
          :title="tr('Copy tool error')"
          :aria-label="tr('Copy tool error')"
          @click="copyDetail"
        >
          <Copy :size="12" />
        </button>
      </div>
    </div>

    <div v-if="hasChangePreview && isExpanded" class="border-t border-line bg-surface-1">
      <div class="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span class="text-meta font-medium text-text-secondary">{{ tr('Changes') }}</span>
        <div class="flex items-center gap-2 text-meta font-medium">
          <span v-if="removedLines.length" class="text-danger">-{{ removedLines.length }}</span>
          <span v-if="addedLines.length" class="text-success">+{{ addedLines.length }}</span>
        </div>
      </div>

      <div class="custom-scrollbar max-h-64 overflow-y-auto px-3 py-2 font-mono text-meta">
        <div v-if="removedLines.length">
          <div
            v-for="(line, index) in removedLines"
            :key="`removed-${index}`"
            class="flex items-start gap-2 bg-danger-subtle/50 px-3 py-0.5"
          >
            <span class="w-3 shrink-0 select-none text-center font-bold text-danger/70">-</span>
            <span class="min-w-0 flex-1 whitespace-pre-wrap break-words text-text-secondary">{{ line }}</span>
          </div>
        </div>

        <div v-if="addedLines.length">
          <div
            v-for="(line, index) in addedLines"
            :key="`added-${index}`"
            class="flex items-start gap-2 bg-success-subtle/60 px-3 py-0.5"
          >
            <span class="w-3 shrink-0 select-none text-center font-bold text-success/70">+</span>
            <span class="min-w-0 flex-1 whitespace-pre-wrap break-words text-text-primary">{{ line }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(60, 60, 67, 0.22);
  border-radius: 999px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(60, 60, 67, 0.34);
}
</style>
