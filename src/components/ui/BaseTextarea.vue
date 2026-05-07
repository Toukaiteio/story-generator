<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'

const props = withDefaults(defineProps<{
  modelValue?: string
  label?: string
  placeholder?: string
  rows?: number
  autoResize?: boolean
  error?: string
  disabled?: boolean
}>(), {
  modelValue: '',
  rows: 3,
  autoResize: false,
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const textareaRef = ref<HTMLTextAreaElement>()
const focused = ref(false)

function adjustHeight() {
  if (!props.autoResize || !textareaRef.value) return
  textareaRef.value.style.height = 'auto'
  textareaRef.value.style.height = textareaRef.value.scrollHeight + 'px'
}

watch(() => props.modelValue, () => {
  nextTick(adjustHeight)
})
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" class="text-xs font-medium text-text-secondary">{{ label }}</label>
    <textarea
      ref="textareaRef"
      :value="modelValue"
      :placeholder="placeholder"
      :rows="rows"
      :disabled="disabled"
      :class="[
        'w-full px-3 py-2 rounded-md border text-sm bg-surface-1 text-text-primary placeholder:text-text-muted outline-none transition-all duration-100 resize-none',
        focused ? 'border-accent ring-1 ring-accent/20' : 'border-surface-4 hover:border-surface-5',
        error ? 'border-danger' : '',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
        autoResize ? 'overflow-hidden' : '',
      ]"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      @focus="focused = true"
      @blur="focused = false"
    />
    <p v-if="error" class="text-xs text-danger">{{ error }}</p>
  </div>
</template>
