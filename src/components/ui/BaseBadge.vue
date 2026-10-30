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
      'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border px-1.5 text-2xs font-bold leading-none',
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
