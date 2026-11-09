<script setup lang="ts">
import { computed, ref } from 'vue'
import { translatePhrase } from '@/i18n'

const props = withDefaults(defineProps<{
  modelValue?: string
  label?: string
  placeholder?: string
  type?: 'text' | 'password' | 'number' | 'email'
  min?: string | number
  max?: string | number
  step?: string | number
  error?: string
  disabled?: boolean
  icon?: any
}>(), {
  modelValue: '',
  type: 'text',
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const focused = ref(false)

const translatedLabel = computed(() => props.label ? translatePhrase(props.label) : '')
const translatedPlaceholder = computed(() => props.placeholder ? translatePhrase(props.placeholder) : '')
const translatedError = computed(() => props.error ? translatePhrase(props.error) : '')

const containerClass = computed(() => [
  'flex min-h-11 items-center gap-2 rounded-full px-4 transition-all duration-150',
  'bg-surface-2',
  focused.value ? 'ring-2 ring-accent/40' : '',
  !focused.value && !props.error ? 'hover:bg-surface-3' : '',
  props.error ? 'ring-2 ring-danger/50' : '',
  props.disabled ? 'opacity-50 cursor-not-allowed' : '',
])
</script>

<template>
  <div class="flex min-w-0 flex-col gap-1.5">
    <label v-if="label" class="text-caption font-medium text-text-secondary">{{ translatedLabel }}</label>
    <div :class="containerClass">
      <component :is="icon" v-if="icon" :size="16" class="shrink-0 text-text-muted" />
      <input
        :type="type"
        :min="min"
        :max="max"
        :step="step"
        :value="modelValue"
        :placeholder="translatedPlaceholder"
        :disabled="disabled"
        class="min-w-0 flex-1 bg-transparent text-body text-text-primary placeholder:text-text-muted outline-none"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @focus="focused = true"
        @blur="focused = false"
      />
    </div>
    <p v-if="error" class="px-1 text-meta text-danger">{{ translatedError }}</p>
  </div>
</template>
