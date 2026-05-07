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
      'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-2xs font-bold leading-none',
      {
        'bg-surface-4 text-text-secondary': variant === 'default',
        'bg-accent text-text-inverse': variant === 'accent',
        'bg-success text-text-inverse': variant === 'success',
        'bg-warning text-text-inverse': variant === 'warning',
        'bg-danger text-text-inverse': variant === 'danger',
      },
    ]"
  >
    <slot />
  </span>
</template>
