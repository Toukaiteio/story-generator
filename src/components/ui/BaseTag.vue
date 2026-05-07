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
      'inline-flex items-center font-medium rounded-full whitespace-nowrap',
      size === 'sm' ? 'px-2 py-0.5 text-2xs' : 'px-2.5 py-1 text-xs',
      {
        'bg-surface-3 text-text-secondary': variant === 'default',
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
