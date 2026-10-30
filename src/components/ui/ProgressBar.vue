<script setup lang="ts">
withDefaults(defineProps<{
  value?: number
  max?: number
  indeterminate?: boolean
  size?: 'sm' | 'md'
}>(), {
  value: 0,
  max: 100,
  indeterminate: false,
  size: 'sm',
})
</script>

<template>
  <div
    :class="[
      'w-full overflow-hidden rounded-full border border-surface-4 bg-surface-0',
      size === 'sm' ? 'h-1' : 'h-2',
    ]"
  >
    <div
      v-if="indeterminate"
      class="h-full rounded-full bg-accent animate-progress-indeterminate"
      style="width: 40%"
    />
    <div
      v-else
      class="h-full rounded-full bg-accent transition-all duration-300 ease-out"
      :style="{ width: `${Math.min(100, (value / max) * 100)}%` }"
    />
  </div>
</template>

<style scoped>
@keyframes progress-indeterminate {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}
.animate-progress-indeterminate {
  animation: progress-indeterminate 1.5s ease-in-out infinite;
}
</style>
