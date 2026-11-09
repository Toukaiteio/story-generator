<script setup lang="ts">
import { computed } from 'vue'
import { Shapes } from 'lucide-vue-next'
import { elementContextCapsules } from '@/app'
import { translatePhrase } from '@/i18n'
import type { StoryProject } from '@/types/project'

const props = withDefaults(defineProps<{
  project: StoryProject
  chapterIndex: number
  limit?: number
  showLabel?: boolean
}>(), {
  showLabel: true,
})

const emit = defineEmits<{ open: [elementId: string] }>()
const tr = translatePhrase

const slice = computed(() => elementContextCapsules(props.project.elements, props.chapterIndex, props.limit ?? 8))
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <span v-if="showLabel" class="inline-flex items-center gap-1 text-meta font-medium text-text-muted">
      <Shapes :size="13" />
      {{ tr('In context') }}
    </span>
    <button
      v-for="item in slice.items"
      :key="item.element.id"
      type="button"
      class="capsule h-8 gap-1 bg-surface-2 px-2.5 text-meta"
      :title="item.state.summary"
      @click="emit('open', item.element.id)"
    >
      <span class="font-medium text-text-primary">{{ item.element.name }}</span>
      <span v-if="item.state.status" class="text-text-muted">{{ tr(item.state.status) }}</span>
    </button>
    <span v-if="slice.hiddenCount" class="text-meta text-text-muted">+{{ slice.hiddenCount }}</span>
    <span v-if="!slice.items.length" class="text-meta text-text-muted">{{ tr('No element state at this chapter') }}</span>
  </div>
</template>
