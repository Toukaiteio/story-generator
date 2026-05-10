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
  <div class="flex flex-col items-center justify-center py-16 px-4 text-center">
    <component :is="icon" v-if="icon" :size="48" class="text-text-muted mb-4" />
    <h3 v-if="title" class="text-base font-medium text-text-secondary mb-1">{{ translatedTitle }}</h3>
    <p v-if="description" class="text-sm text-text-muted max-w-xs">{{ translatedDescription }}</p>
    <div v-if="$slots.action" class="mt-4">
      <slot name="action" />
    </div>
  </div>
</template>
