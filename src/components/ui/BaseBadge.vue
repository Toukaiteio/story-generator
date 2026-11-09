<script setup lang="ts">
withDefaults(defineProps<{
  variant?: 'default' | 'accent' | 'success' | 'warning' | 'danger'
  dot?: boolean
}>(), {
  variant: 'default',
  dot: false,
})
</script>

<template>
  <span
    :class="[
      'inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded-full px-2 text-meta font-semibold leading-none',
      {
        'bg-surface-2 text-text-secondary': variant === 'default',
        'bg-accent-subtle text-accent': variant === 'accent',
        'bg-success-subtle text-success': variant === 'success',
        'bg-warning-subtle text-warning': variant === 'warning',
        'bg-danger-subtle text-danger': variant === 'danger',
      },
    ]"
  >
    <span v-if="dot" class="h-1.5 w-1.5 rounded-full bg-current" />
    <slot />
  </span>
</template>
