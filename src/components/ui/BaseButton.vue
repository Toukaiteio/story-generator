<script setup lang="ts">
import { computed } from 'vue'
import { Loader2 } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  disabled?: boolean
  icon?: boolean
}>(), {
  variant: 'primary',
  size: 'md',
  loading: false,
  disabled: false,
  icon: false,
})

const classes = computed(() => {
  const base = 'inline-flex items-center justify-center font-semibold rounded-full transition-colors duration-150 select-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

  const variants = {
    primary: 'bg-accent text-text-inverse hover:bg-accent-hover active:bg-accent-muted',
    secondary: 'border border-surface-4 bg-surface-2 text-text-primary hover:border-surface-5 hover:bg-surface-3 active:bg-surface-4',
    ghost: 'text-text-secondary hover:text-text-primary hover:bg-white/[0.05] active:bg-white/[0.08]',
    danger: 'bg-danger text-white hover:bg-danger/90 active:bg-danger/80',
    warning: 'bg-warning text-text-primary hover:bg-warning/90 active:bg-warning/80',
  }

  const sizes = {
    sm: props.icon ? 'h-7 w-7 text-xs' : 'h-7 px-2.5 text-xs gap-1.5',
    md: props.icon ? 'h-8 w-8 text-sm' : 'h-8 px-3 text-sm gap-2',
    lg: props.icon ? 'h-10 w-10 text-base' : 'h-10 px-4 text-base gap-2',
  }

  const disabledClass = (props.disabled || props.loading) ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer'

  return [base, variants[props.variant], sizes[props.size], disabledClass]
})
</script>

<template>
  <button
    :class="classes"
    :disabled="disabled || loading"
  >
    <Loader2 v-if="loading" class="animate-spin" :size="size === 'sm' ? 14 : size === 'lg' ? 18 : 16" />
    <slot />
  </button>
</template>
