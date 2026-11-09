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
  <div class="flex flex-col items-center justify-center px-5 py-14 text-center">
    <div
      v-if="icon"
      class="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-text-muted"
    >
      <component :is="icon" :size="24" />
    </div>
    <h3 v-if="title" class="text-body font-semibold text-text-primary">{{ translatedTitle }}</h3>
    <p v-if="description" class="mt-1.5 max-w-sm text-caption leading-relaxed text-text-muted">{{ translatedDescription }}</p>
    <div v-if="$slots.action" class="mt-5">
      <slot name="action" />
    </div>
  </div>
</template>
