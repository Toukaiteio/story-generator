<script setup lang="ts">
import { computed } from 'vue'
import { CheckCircle2, Circle, CircleDashed, ListChecks, Lock } from 'lucide-vue-next'
import { translatePhrase } from '@/i18n'
import type { AgentTodoItem } from '@/services/agent/todolist'

const props = withDefaults(defineProps<{
  items: AgentTodoItem[]
  title?: string
  agent?: string
  compact?: boolean
}>(), {
  title: 'Todo List',
  agent: '',
  compact: false,
})

const tr = translatePhrase

const completed = computed(() => props.items.filter(item => item.status === 'done').length)

function statusIcon(status: AgentTodoItem['status']) {
  if (status === 'done') return CheckCircle2
  if (status === 'in_progress') return CircleDashed
  if (status === 'blocked') return Lock
  return Circle
}

function itemClasses(status: AgentTodoItem['status']) {
  if (status === 'done') return 'text-success'
  if (status === 'in_progress') return 'text-accent'
  if (status === 'blocked') return 'text-warning'
  return 'text-text-muted'
}
</script>

<template>
  <div v-if="items.length" class="rounded-lg border border-surface-4 bg-surface-1 shadow-sm">
    <div class="flex items-center justify-between gap-3 border-b border-surface-4 px-3 py-2">
      <div class="flex min-w-0 items-center gap-2">
        <ListChecks :size="14" class="shrink-0 text-accent" />
        <div class="min-w-0">
          <p class="truncate text-xs font-semibold text-text-primary">{{ tr(title) }}</p>
          <p v-if="agent && !compact" class="truncate text-[10px] text-text-muted">{{ agent }}</p>
        </div>
      </div>
      <span class="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
        {{ completed }}/{{ items.length }}
      </span>
    </div>

    <div class="space-y-1 px-3 py-2">
      <div
        v-for="item in items"
        :key="item.id"
        class="flex items-start gap-2 rounded-md px-1 py-1"
      >
        <component
          :is="statusIcon(item.status)"
          :size="13"
          class="mt-0.5 shrink-0"
          :class="[itemClasses(item.status), item.status === 'in_progress' ? 'animate-spin' : '']"
        />
        <div class="min-w-0 flex-1">
          <p class="text-[11px] leading-snug text-text-primary" :class="item.status === 'done' ? 'line-through opacity-70' : ''">
            {{ item.title }}
          </p>
          <p v-if="item.notes && !compact" class="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-text-muted">
            {{ item.notes }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
