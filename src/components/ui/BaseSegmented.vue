<script setup lang="ts">
withDefaults(defineProps<{
  options: Array<{ label: string; value: string }>
  modelValue: string
  size?: 'sm' | 'md'
  disabled?: boolean
}>(), {
  size: 'sm',
  disabled: false,
})

defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div
    class="inline-flex items-center rounded-full bg-surface-2 p-0.5"
    :class="disabled ? 'opacity-50 pointer-events-none' : ''"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="rounded-full font-semibold transition-colors duration-150"
      :class="[
        size === 'sm' ? 'h-6 px-2.5 text-2xs' : 'h-7 px-3 text-xs',
        option.value === modelValue
          ? 'bg-surface-4 text-text-primary shadow-sm'
          : 'text-text-secondary hover:text-text-primary',
      ]"
      @click="$emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
