<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { translatePhrase } from '@/i18n'

const props = withDefaults(defineProps<{
  modelValue?: string
  label?: string
  placeholder?: string
  rows?: number
  autoResize?: boolean
  maxHeight?: string
  error?: string
  disabled?: boolean
}>(), {
  modelValue: '',
  rows: 3,
  autoResize: false,
  maxHeight: '384px',
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const textareaRef = ref<HTMLTextAreaElement>()
const focused = ref(false)
const translatedLabel = computed(() => props.label ? translatePhrase(props.label) : '')
const translatedPlaceholder = computed(() => props.placeholder ? translatePhrase(props.placeholder) : '')
const translatedError = computed(() => props.error ? translatePhrase(props.error) : '')

function adjustHeight() {
  if (!props.autoResize || !textareaRef.value) return
  const maxHeightPx = parseInt(props.maxHeight || '384px')
  textareaRef.value.style.height = 'auto'
  const newHeight = textareaRef.value.scrollHeight
  textareaRef.value.style.height = Math.min(newHeight, maxHeightPx) + 'px'
}

watch(() => props.modelValue, () => {
  nextTick(adjustHeight)
})
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" class="text-xs font-medium text-text-secondary">{{ translatedLabel }}</label>
    <textarea
      ref="textareaRef"
      :value="modelValue"
      :placeholder="translatedPlaceholder"
      :rows="rows"
      :disabled="disabled"
      :class="[
        'w-full px-3 py-2 rounded-md border text-sm bg-surface-1 text-text-primary placeholder:text-text-muted outline-none transition-all duration-100 resize-none overflow-y-auto',
        focused ? 'border-accent ring-1 ring-accent/20' : 'border-surface-4 hover:border-surface-5',
        error ? 'border-danger' : '',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
      ]"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      @focus="focused = true"
      @blur="focused = false"
    />
    <p v-if="error" class="text-xs text-danger">{{ translatedError }}</p>
  </div>
</template>
