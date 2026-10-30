<script setup lang="ts">
import { computed } from 'vue'
import { translatePhrase } from '@/i18n'

const props = defineProps<{
  icon?: any
  title?: string
  description?: string
}>()

const translatedTitle = computed(() => props.title ? translatePhrase(props.title) : '')
const translatedDescription = computed(() => props.description ? translatePhrase(props.description) : '')
</script>

<template>
  <div class="flex flex-col items-center justify-center px-4 py-12 text-center">
    <div
      v-if="icon"
      class="mb-3 flex h-12 w-12 items-center justify-center rounded-md border border-surface-4 bg-surface-1 text-text-muted"
    >
      <component :is="icon" :size="24" />
    </div>
    <h3 v-if="title" class="mb-1 text-sm font-semibold text-text-secondary">{{ translatedTitle }}</h3>
    <p v-if="description" class="max-w-sm text-xs leading-relaxed text-text-muted">{{ translatedDescription }}</p>
    <div v-if="$slots.action" class="mt-4">
      <slot name="action" />
    </div>
  </div>
</template>
