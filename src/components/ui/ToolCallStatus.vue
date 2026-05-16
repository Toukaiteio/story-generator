<script setup lang="ts">
import { computed, ref } from 'vue'
import { AlertTriangle, BookOpen, Check, ChevronDown, ChevronRight, CircleDashed, FileText, ListChecks, Search, Wrench, X } from 'lucide-vue-next'
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
    record_meeting_consensus: {
      label: 'Record meeting consensus',
      description: 'Saving the agreed consensus result',
      icon: FileText,
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
</script>

<template>
  <div class="group flex flex-col overflow-hidden rounded-md bg-surface-2/40 transition-all hover:bg-surface-2">
    <!-- Header: Tool Identity & Status -->
    <div 
      class="flex min-h-[28px] items-center justify-between gap-2 px-2.5 py-1.5 cursor-pointer select-none"
      @click="hasChangePreview ? (isExpanded = !isExpanded) : null"
    >
      <div class="flex min-w-0 items-center gap-2 text-text-secondary">
        <component :is="toolMeta.icon" :size="12" class="shrink-0" />
        <span class="truncate text-[11px] font-medium text-text-primary">{{ tr(item.title || toolMeta.label) }}</span>
        <span class="truncate text-[10px] text-text-muted hidden sm:inline">{{ tr(item.description || toolMeta.description) }}</span>
      </div>

      <div class="flex items-center gap-1.5 shrink-0">
        <div 
          v-if="item.detail" 
          class="hidden max-w-[100px] truncate rounded bg-surface-3 px-1.5 py-0.5 text-[9px] text-text-muted md:block"
        >
          {{ item.detail }}
        </div>
        <component :is="statusConfig.icon" :size="12" :class="statusConfig.class" stroke-width="2.5" />
        <button 
          v-if="hasChangePreview"
          class="flex h-4 w-4 items-center justify-center text-text-muted transition-colors hover:text-text-primary"
        >
          <ChevronDown v-if="isExpanded" :size="12" />
          <ChevronRight v-else :size="12" />
        </button>
      </div>
    </div>

    <!-- Error/Warning Detail (Auto-expanded) -->
    <div v-if="item.status === 'error' || (item.status === 'warning' && item.detail)" class="border-t border-surface-4 bg-danger/5 px-2.5 py-2">
      <div class="flex items-start gap-1.5">
        <AlertTriangle v-if="item.status === 'warning'" :size="12" class="mt-0.5 shrink-0 text-warning" />
        <X v-else :size="12" class="mt-0.5 shrink-0 text-danger" />
        <p class="min-w-0 whitespace-pre-wrap break-words text-[10px] leading-relaxed [overflow-wrap:anywhere]" :class="item.status === 'error' ? 'text-danger' : 'text-text-secondary'">
          {{ item.detail }}
        </p>
      </div>
    </div>

    <!-- Diff Preview (Collapsible) -->
    <div v-if="hasChangePreview && isExpanded" class="border-t border-surface-4 bg-surface-1/50">
      <div class="flex items-center justify-between border-b border-surface-4 px-2.5 py-1">
        <span class="text-[9px] font-bold uppercase tracking-widest text-text-muted">{{ tr('Changes') }}</span>
        <div class="flex items-center gap-2 text-[9px] font-bold">
          <span v-if="removedLines.length" class="text-danger">-{{ removedLines.length }}</span>
          <span v-if="addedLines.length" class="text-success">+{{ addedLines.length }}</span>
        </div>
      </div>
      
      <div class="max-h-64 overflow-y-auto font-mono text-[10px] custom-scrollbar">
        <!-- Removed Content -->
        <div v-if="removedLines.length">
          <div
            v-for="(line, index) in removedLines"
            :key="`removed-${index}`"
            class="flex items-start gap-2 bg-danger/5 px-2.5 py-0.5"
          >
            <span class="w-3 shrink-0 select-none text-center font-bold text-danger/60">-</span>
            <span class="min-w-0 flex-1 whitespace-pre-wrap break-words text-text-secondary opacity-80">{{ line }}</span>
          </div>
        </div>
        
        <!-- Added Content -->
        <div v-if="addedLines.length">
          <div
            v-for="(line, index) in addedLines"
            :key="`added-${index}`"
            class="flex items-start gap-2 bg-success/5 px-2.5 py-0.5"
          >
            <span class="w-3 shrink-0 select-none text-center font-bold text-success/60">+</span>
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
  background: var(--surface-4);
  border-radius: 4px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--surface-5);
}
</style>
