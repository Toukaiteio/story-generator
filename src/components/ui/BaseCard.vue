<script setup lang="ts">
withDefaults(defineProps<{
  hoverable?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
}>(), {
  hoverable: false,
  padding: 'md',
})
</script>

<template>
  <div
    :class="[
      'overflow-hidden rounded-md border border-surface-4 bg-surface-1 transition-colors duration-150',
      hoverable ? 'cursor-pointer hover:border-surface-5 hover:bg-surface-2' : '',
      {
        'p-0': padding === 'none',
        'p-3': padding === 'sm',
        'p-4': padding === 'md',
        'p-6': padding === 'lg',
      },
    ]"
  >
    <slot />
  </div>
</template>
