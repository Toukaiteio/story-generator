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
      'inline-flex items-center rounded border font-semibold whitespace-nowrap',
      size === 'sm' ? 'px-1.5 py-0.5 text-2xs' : 'px-2 py-1 text-xs',
      {
        'border-surface-4 bg-surface-2 text-text-secondary': variant === 'default',
        'border-accent/30 bg-accent-subtle text-accent': variant === 'accent',
        'border-success/30 bg-success-subtle text-success': variant === 'success',
        'border-warning/30 bg-warning-subtle text-warning': variant === 'warning',
        'border-danger/30 bg-danger-subtle text-danger': variant === 'danger',
      },
    ]"
  >
    <slot />
  </span>
</template>
