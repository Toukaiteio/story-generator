<script setup lang="ts">
import type { Component } from 'vue'
import { BookOpen, LayoutGrid, PenLine, Shapes } from 'lucide-vue-next'

export type StudioView = 'story' | 'board' | 'manuscript' | 'elements'

const items: Array<{ key: StudioView; label: string; icon: Component }> = [
  { key: 'story', label: 'Story', icon: BookOpen },
  { key: 'board', label: 'Board', icon: LayoutGrid },
  { key: 'manuscript', label: 'Write', icon: PenLine },
  { key: 'elements', label: 'Elements', icon: Shapes },
]

defineProps<{ modelValue: StudioView }>()
defineEmits<{ 'update:modelValue': [value: StudioView] }>()
</script>

<template>
  <nav class="flex h-full w-14 flex-col items-center gap-1 border-r border-surface-3 bg-surface-1 py-3">
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      class="group relative flex h-10 w-10 items-center justify-center rounded-full transition-colors"
      :class="modelValue === item.key
        ? 'bg-accent-subtle text-accent'
        : 'text-text-secondary hover:bg-surface-3 hover:text-text-primary'"
      @click="$emit('update:modelValue', item.key)"
    >
      <component :is="item.icon" :size="18" />
      <span class="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-full bg-surface-4 px-2.5 py-1 text-2xs font-semibold text-text-primary shadow-lg group-hover:block">
        {{ item.label }}
      </span>
    </button>
  </nav>
</template>
