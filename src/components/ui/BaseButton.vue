<script setup lang="ts">
import { computed } from 'vue'
import { Loader2 } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
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
  const base = 'inline-flex items-center justify-center font-medium rounded-md transition-all duration-100 select-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

  const variants = {
    primary: 'bg-accent text-text-inverse hover:bg-accent-hover active:bg-accent-muted',
    secondary: 'bg-surface-3 text-text-primary border border-surface-4 hover:bg-surface-4 active:bg-surface-5',
    ghost: 'text-text-secondary hover:text-text-primary hover:bg-surface-3 active:bg-surface-4',
    danger: 'bg-danger text-white hover:opacity-90 active:opacity-80',
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
