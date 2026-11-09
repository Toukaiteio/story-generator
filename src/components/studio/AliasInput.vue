<script setup lang="ts">
import { ref } from 'vue'
import { X } from 'lucide-vue-next'
import { translatePhrase } from '@/i18n'
import { normalizeElementAliases } from '@/app'

const props = withDefaults(defineProps<{
  modelValue?: string[]
  name?: string
  placeholder?: string
}>(), {
  modelValue: () => [],
  name: '',
  placeholder: '',
})

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const tr = translatePhrase
const draft = ref('')

function commit() {
  const next = normalizeElementAliases([...props.modelValue, draft.value], props.name)
  draft.value = ''
  if (next.length !== props.modelValue.length) emit('update:modelValue', next)
}

function remove(alias: string) {
  emit('update:modelValue', props.modelValue.filter(item => item !== alias))
}

function onKeydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Enter') {
    event.preventDefault()
    commit()
  }
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5 rounded-ios bg-surface-2 px-3 py-2">
    <span
      v-for="alias in modelValue"
      :key="alias"
      class="inline-flex h-7 items-center gap-0.5 rounded-full bg-surface-1 pl-2.5 pr-1 text-meta text-text-secondary shadow-ios-pill"
    >
      {{ alias }}
      <button
        type="button"
        class="flex h-5 w-5 items-center justify-center rounded-full text-text-muted hover:bg-surface-2 hover:text-text-primary"
        :aria-label="`${tr('Remove alias')}: ${alias}`"
        @click="remove(alias)"
      >
        <X :size="12" />
      </button>
    </span>
    <input
      v-model="draft"
      class="h-7 min-w-[88px] flex-1 bg-transparent text-meta text-text-primary outline-none placeholder:text-text-muted"
      :placeholder="placeholder || tr('Add alias')"
      @keydown="onKeydown"
      @blur="commit"
    >
  </div>
</template>
