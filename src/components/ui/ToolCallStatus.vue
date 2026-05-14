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
  <div class="group flex flex-col overflow-hidden rounded-xl border border-surface-4 bg-surface-1 transition-all hover:border-surface-5 hover:shadow-sm">
    <!-- Header: Tool Identity & Status -->
    <div 
      class="flex min-h-[44px] items-center justify-between gap-3 px-4 py-2 cursor-pointer select-none"
      @click="hasChangePreview ? (isExpanded = !isExpanded) : null"
    >
      <div class="flex min-w-0 items-center gap-3">
        <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-surface-4 bg-surface-2 transition-colors group-hover:bg-surface-3">
          <component :is="toolMeta.icon" :size="14" class="text-text-secondary" />
        </div>
        <div class="min-w-0">
          <p class="truncate text-[13px] font-bold tracking-tight text-text-primary">
            {{ tr(item.title || toolMeta.label) }}
          </p>
          <p class="truncate text-[11px] font-medium text-text-muted">
            {{ tr(item.description || toolMeta.description) }}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <div 
          v-if="item.detail" 
          class="hidden max-w-[120px] truncate rounded-full bg-surface-2 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-text-muted md:block"
        >
          {{ item.detail }}
        </div>
        <div class="flex h-6 w-6 items-center justify-center">
          <component :is="statusConfig.icon" :size="14" :class="statusConfig.class" stroke-width="2.5" />
        </div>
        <button 
          v-if="hasChangePreview"
          class="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary"
        >
          <ChevronDown v-if="isExpanded" :size="16" />
          <ChevronRight v-else :size="16" />
        </button>
      </div>
    </div>

    <!-- Error/Warning Detail (Auto-expanded) -->
    <div v-if="item.status === 'error' || (item.status === 'warning' && item.detail)" class="border-t border-surface-4 bg-danger/5 px-4 py-3">
      <div class="flex items-start gap-2">
        <AlertTriangle v-if="item.status === 'warning'" :size="14" class="mt-0.5 shrink-0 text-warning" />
        <X v-else :size="14" class="mt-0.5 shrink-0 text-danger" />
        <p class="text-[11px] leading-relaxed" :class="item.status === 'error' ? 'text-danger' : 'text-text-secondary'">
          {{ item.detail }}
        </p>
      </div>
    </div>

    <!-- Diff Preview (Collapsible) -->
    <div v-if="hasChangePreview && isExpanded" class="border-t border-surface-4 bg-surface-0/50">
      <div class="flex items-center justify-between border-b border-surface-4 bg-surface-2/50 px-4 py-1.5">
        <span class="text-[10px] font-bold uppercase tracking-widest text-text-muted">{{ tr('Changes') }}</span>
        <div class="flex items-center gap-3 text-[10px] font-bold">
          <span v-if="removedLines.length" class="text-danger">-{{ removedLines.length }}</span>
          <span v-if="addedLines.length" class="text-success">+{{ addedLines.length }}</span>
        </div>
      </div>
      
      <div class="max-h-64 overflow-y-auto font-mono text-[11px] custom-scrollbar">
        <!-- Removed Content -->
        <div v-if="removedLines.length">
          <div
            v-for="(line, index) in removedLines"
            :key="`removed-${index}`"
            class="group/line flex items-start gap-3 bg-danger/5 px-4 py-0.5 transition-colors hover:bg-danger/10"
          >
            <span class="w-4 shrink-0 select-none text-center font-bold text-danger/60">-</span>
            <span class="min-w-0 flex-1 whitespace-pre-wrap break-words text-text-secondary opacity-80">{{ line }}</span>
          </div>
        </div>
        
        <!-- Added Content -->
        <div v-if="addedLines.length">
          <div
            v-for="(line, index) in addedLines"
            :key="`added-${index}`"
            class="group/line flex items-start gap-3 bg-success/5 px-4 py-0.5 transition-colors hover:bg-success/10"
          >
            <span class="w-4 shrink-0 select-none text-center font-bold text-success/60">+</span>
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
