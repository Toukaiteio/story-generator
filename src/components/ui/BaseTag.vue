<script setup lang="ts">
withDefaults(defineProps<{
  variant?: 'default' | 'accent' | 'success' | 'warning' | 'danger'
  size?: 'sm' | 'md'
}>(), {
  variant: 'default',
  size: 'sm',
})
</script>

<template>
  <span
    :class="[
      'inline-flex items-center rounded-full font-medium whitespace-nowrap',
      size === 'sm' ? 'h-6 px-2.5 text-meta' : 'h-8 px-3.5 text-caption',
      {
        'bg-surface-2 text-text-secondary': variant === 'default',
        'bg-accent-subtle text-accent': variant === 'accent',
        'bg-success-subtle text-success': variant === 'success',
        'bg-warning-subtle text-warning': variant === 'warning',
        'bg-danger-subtle text-danger': variant === 'danger',
      },
    ]"
  >
    <slot />
  </span>
</template>
