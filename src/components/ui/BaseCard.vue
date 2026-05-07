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
      'rounded-lg border border-surface-4 bg-surface-2 transition-all duration-100',
      hoverable ? 'cursor-pointer hover:border-surface-5 hover:bg-surface-3 active:scale-[0.99]' : '',
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
