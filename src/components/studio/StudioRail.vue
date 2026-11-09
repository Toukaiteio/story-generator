<script setup lang="ts">
import { computed } from 'vue'
import { LayoutGrid, PenLine, BookOpen, Shapes } from 'lucide-vue-next'
import { translatePhrase } from '@/i18n'

export type StudioView = 'story' | 'board' | 'manuscript' | 'elements'

const props = defineProps<{ modelValue: StudioView; expanded?: boolean }>()
const tr = translatePhrase
const emit = defineEmits<{
  'update:modelValue': [value: StudioView]
  'update:expanded': [value: boolean]
}>()

const items = computed<Array<{ key: StudioView; label: string; icon: any }>>(() => [
  { key: 'board', label: translatePhrase('Corkboard'), icon: LayoutGrid },
  { key: 'manuscript', label: translatePhrase('Manuscript'), icon: PenLine },
  { key: 'story', label: translatePhrase('Story bible'), icon: BookOpen },
  { key: 'elements', label: translatePhrase('Elements'), icon: Shapes },
])
</script>

<template>
  <div class="flex items-center gap-1">
    <nav class="capsule-group" aria-label="Studio views">
      <button
        v-for="item in items"
        :key="item.key"
        type="button"
        class="capsule h-8 gap-1.5 px-2.5"
        :class="props.modelValue === item.key ? 'capsule--active' : ''"
        :aria-current="props.modelValue === item.key ? 'page' : undefined"
        :title="item.label"
        :aria-label="item.label"
        @click="emit('update:modelValue', item.key)"
      >
        <component :is="item.icon" :size="15" />
        <span v-if="props.expanded" class="text-meta">{{ item.label }}</span>
      </button>
    </nav>
  </div>
</template>
