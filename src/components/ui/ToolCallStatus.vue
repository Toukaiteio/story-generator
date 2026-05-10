<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, CheckCircle2, CircleDashed, FileText, ListChecks, Search, Wrench, XCircle } from 'lucide-vue-next'
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
  }

  return map[props.item.name] ?? {
    label: props.item.name.replace(/_/g, ' '),
    description: 'Using tool',
    icon: Wrench,
    tone: 'default',
  }
})

const statusIcon = computed(() => {
  if (props.item.status === 'success') return CheckCircle2
  if (props.item.status === 'warning') return AlertTriangle
  if (props.item.status === 'error') return XCircle
  return CircleDashed
})

const classes = computed(() => {
  if (props.item.status === 'error') return 'border-danger/30 bg-danger-subtle/40 text-danger'
  if (props.item.status === 'warning') return 'border-warning/30 bg-warning/10 text-warning'
  if (props.item.status === 'success') return 'border-success/30 bg-success-subtle/30 text-success'
  if (toolMeta.value.tone === 'warning') return 'border-warning/30 bg-warning/10 text-warning'
  if (toolMeta.value.tone === 'accent') return 'border-accent/30 bg-accent/10 text-accent'
  return 'border-surface-4 bg-surface-2 text-text-secondary'
})

const hasChangePreview = computed(() =>
  typeof props.item.before === 'string'
  && typeof props.item.after === 'string'
  && (props.item.before.trim() || props.item.after.trim())
)

function previewLines(value?: string) {
  const text = value?.trim() || ''
  if (!text) return []
  const lines = text.split(/\r?\n/).filter(line => line.trim())
  const compact = lines.length ? lines : [text]
  return compact.slice(0, 8)
}

const removedLines = computed(() => previewLines(props.item.before))
const addedLines = computed(() => previewLines(props.item.after))
</script>

<template>
  <div v-if="hasChangePreview" class="overflow-hidden rounded-md border border-surface-4 bg-surface-0/70 font-mono text-[10px] shadow-inner">
    <div class="flex items-center justify-between border-b border-surface-4 bg-surface-2/80 px-2 py-1 text-[9px] uppercase tracking-wide text-text-muted">
      <span>{{ tr('Diff preview') }}</span>
      <span>{{ tr('Replacement') }}</span>
    </div>
    <div class="max-h-44 overflow-y-auto custom-scrollbar">
      <div v-if="removedLines.length" class="border-b border-surface-4/70">
        <div
          v-for="(line, index) in removedLines"
          :key="`removed-${index}`"
          class="grid grid-cols-[1.25rem_1fr] border-l-2 border-danger/70 bg-danger/10 text-text-secondary"
        >
          <span class="select-none px-1.5 py-0.5 text-center text-danger">-</span>
          <span class="min-w-0 whitespace-pre-wrap break-words py-0.5 pr-2">{{ line }}</span>
        </div>
      </div>
      <div v-else class="grid grid-cols-[1.25rem_1fr] border-l-2 border-danger/50 bg-danger/5 text-text-muted">
        <span class="select-none px-1.5 py-0.5 text-center text-danger">-</span>
        <span class="py-0.5 pr-2">{{ tr('No previous content') }}</span>
      </div>
      <div v-if="addedLines.length">
        <div
          v-for="(line, index) in addedLines"
          :key="`added-${index}`"
          class="grid grid-cols-[1.25rem_1fr] border-l-2 border-success/70 bg-success/10 text-text-secondary"
        >
          <span class="select-none px-1.5 py-0.5 text-center text-success">+</span>
          <span class="min-w-0 whitespace-pre-wrap break-words py-0.5 pr-2">{{ line }}</span>
        </div>
      </div>
      <div v-else class="grid grid-cols-[1.25rem_1fr] border-l-2 border-success/50 bg-success/5 text-text-muted">
        <span class="select-none px-1.5 py-0.5 text-center text-success">+</span>
        <span class="py-0.5 pr-2">{{ tr('No replacement content') }}</span>
      </div>
    </div>
  </div>

  <div v-else class="rounded-lg border px-3 py-2 shadow-sm" :class="classes">
    <div class="flex items-start gap-2">
      <div class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-1/70">
        <component :is="toolMeta.icon" :size="13" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-between gap-2">
          <p class="truncate text-xs font-semibold text-text-primary">
            {{ tr(item.title || toolMeta.label) }}
          </p>
          <component
            :is="statusIcon"
            :size="13"
            class="shrink-0"
            :class="item.status === 'running' ? 'animate-spin' : ''"
          />
        </div>
        <p class="mt-0.5 text-[11px] leading-relaxed text-text-secondary">
          {{ tr(item.description || toolMeta.description) }}
        </p>
        <p v-if="item.detail" class="mt-1 line-clamp-2 text-[10px] leading-relaxed text-text-muted">
          {{ item.detail }}
        </p>
      </div>
    </div>
  </div>
</template>
