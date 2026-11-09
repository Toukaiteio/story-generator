<script setup lang="ts">
import { BookOpen, PenLine } from 'lucide-vue-next'

withDefaults(defineProps<{
  size?: number
}>(), {
  size: 32,
})
</script>

<template>
  <span
    class="relative inline-flex shrink-0 items-center justify-center rounded-full bg-accent-subtle"
    :style="{ width: `${size}px`, height: `${size}px` }"
  >
    <BookOpen
      :size="Math.round(size * 0.5)"
      class="text-accent"
      :stroke-width="2"
    />
    <PenLine
      :size="Math.round(size * 0.3)"
      class="absolute -bottom-0.5 -right-0.5 rounded-full bg-surface-1 p-0.5 text-accent"
      :stroke-width="2.4"
    />
  </span>
</template>
