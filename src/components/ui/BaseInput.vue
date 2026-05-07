<script setup lang="ts">
import { computed, ref } from 'vue'

const props = withDefaults(defineProps<{
  modelValue?: string
  label?: string
  placeholder?: string
  type?: 'text' | 'password' | 'number' | 'email'
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

const containerClass = computed(() => [
  'flex items-center h-9 px-3 rounded-md border transition-all duration-100',
  'bg-surface-1',
  focused.value ? 'border-accent ring-1 ring-accent/20' : 'border-surface-4 hover:border-surface-5',
  props.error ? 'border-danger' : '',
  props.disabled ? 'opacity-50 cursor-not-allowed' : '',
])
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" class="text-xs font-medium text-text-secondary">{{ label }}</label>
    <div :class="containerClass">
      <component :is="icon" v-if="icon" :size="16" class="text-text-muted mr-2 shrink-0" />
      <input
        :type="type"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        class="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none min-w-0"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @focus="focused = true"
        @blur="focused = false"
      />
    </div>
    <p v-if="error" class="text-xs text-danger">{{ error }}</p>
  </div>
</template>
