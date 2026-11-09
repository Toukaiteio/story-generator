<script setup lang="ts">
import { computed } from 'vue'
import { Loader2 } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  disabled?: boolean
  icon?: boolean
  pill?: boolean
}>(), {
  variant: 'primary',
  size: 'md',
  loading: false,
  disabled: false,
  icon: false,
  pill: true,
})

const classes = computed(() => {
  const base = 'inline-flex items-center justify-center gap-2 font-medium transition-colors duration-150 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0'

  const variants = {
    primary: 'bg-accent text-text-inverse hover:bg-accent-hover active:bg-accent-muted shadow-ios-pill',
    secondary: 'bg-surface-2 text-text-primary hover:bg-surface-3 active:bg-surface-4',
    ghost: 'text-text-secondary hover:bg-surface-2 hover:text-text-primary active:bg-surface-3',
    danger: 'bg-danger text-text-inverse hover:brightness-95 active:brightness-90',
    warning: 'bg-warning text-text-inverse hover:brightness-95 active:brightness-90',
  }

  const sizes = {
    sm: props.icon ? 'h-9 w-9 text-caption' : 'h-9 px-3.5 text-caption',
    md: props.icon ? 'h-11 w-11 text-body' : 'h-11 px-5 text-caption',
    lg: props.icon ? 'h-12 w-12 text-body' : 'h-12 px-6 text-body',
  }

  const shape = props.pill ? 'rounded-full' : 'rounded-ios'
  const disabledClass = (props.disabled || props.loading) ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer'

  return [base, shape, variants[props.variant], sizes[props.size], disabledClass]
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
