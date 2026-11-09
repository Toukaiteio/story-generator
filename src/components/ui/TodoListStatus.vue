<script setup lang="ts">
import { computed } from 'vue'
import { CheckCircle2, Circle, CircleDashed, ListChecks, Lock } from 'lucide-vue-next'
import { translatePhrase } from '@/i18n'
import type { AgentTodoItem } from '@/app'

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
  <div v-if="items.length" class="overflow-hidden rounded-ios bg-surface-1 shadow-ios-pill">
    <div class="flex items-center justify-between gap-3 px-4 py-3">
      <div class="flex min-w-0 items-center gap-2">
        <ListChecks :size="16" class="shrink-0 text-accent" />
        <div class="min-w-0">
          <p class="truncate text-caption font-semibold text-text-primary">{{ tr(title) }}</p>
          <p v-if="agent && !compact" class="truncate text-meta text-text-muted">{{ agent }}</p>
        </div>
      </div>
      <span class="shrink-0 rounded-full bg-surface-2 px-2.5 py-0.5 text-meta font-medium text-text-secondary">
        {{ completed }}/{{ items.length }}
      </span>
    </div>

    <div class="space-y-1 px-3 pb-3">
      <div
        v-for="item in items"
        :key="item.id"
        class="flex items-start gap-2.5 rounded-full px-2 py-1.5"
      >
        <component
          :is="statusIcon(item.status)"
          :size="15"
          class="mt-0.5 shrink-0"
          :class="[itemClasses(item.status), item.status === 'in_progress' ? 'animate-spin' : '']"
        />
        <div class="min-w-0 flex-1">
          <p class="text-caption leading-snug text-text-primary" :class="item.status === 'done' ? 'line-through opacity-70' : ''">
            {{ item.title }}
          </p>
          <p v-if="item.notes && !compact" class="mt-0.5 line-clamp-2 text-meta leading-relaxed text-text-muted">
            {{ item.notes }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
