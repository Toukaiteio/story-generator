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
      'overflow-hidden rounded-ios bg-surface-1 shadow-ios transition-shadow duration-150',
      hoverable ? 'cursor-pointer hover:shadow-ios-lg' : '',
      {
        'p-0': padding === 'none',
        'p-4': padding === 'sm',
        'p-5': padding === 'md',
        'p-7': padding === 'lg',
      },
    ]"
  >
    <slot />
  </div>
</template>
