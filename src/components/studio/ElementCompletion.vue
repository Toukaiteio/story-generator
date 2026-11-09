<script setup lang="ts">
import { computed } from 'vue'
import { translatePhrase } from '@/i18n'
import type { CompletionItem } from '@/app'

const props = defineProps<{
  items: CompletionItem[]
  activeIndex: number
  anchorRect: { top: number; bottom: number; left: number; right: number } | null
  containerRect: { top: number; bottom: number; left: number; right: number } | null
}>()

const emit = defineEmits<{
  pick: [item: CompletionItem]
  hover: [index: number]
}>()

const tr = translatePhrase
const WIDTH = 236
const ROW = 34
const PADDING = 6
const GAP = 6

const height = computed(() => props.items.length * ROW + PADDING * 2)

const position = computed(() => {
  const anchor = props.anchorRect
  const container = props.containerRect
  if (!anchor) return null
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const minLeft = container ? container.left + 4 : 8
  const maxLeft = Math.min(
    (container ? container.right : viewportWidth) - WIDTH - 4,
    viewportWidth - WIDTH - 8,
  )
  const left = Math.max(8, minLeft, Math.min(anchor.left, Math.max(minLeft, maxLeft)))
  const bottomLimit = Math.min(container ? container.bottom - 4 : viewportHeight - 8, viewportHeight - 8)
  const spaceBelow = bottomLimit - anchor.bottom
  const top = spaceBelow >= height.value + GAP
    ? anchor.bottom + GAP
    : Math.max(8, anchor.top - height.value - GAP)
  return { left, top }
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="position"
      class="fixed z-[180] overflow-hidden rounded-ios border border-line bg-surface-1 p-1.5 shadow-ios-lg"
      :style="{ left: position.left + 'px', top: position.top + 'px', width: WIDTH + 'px' }"
      data-element-completion
      role="listbox"
      @mousedown.prevent
    >
      <button
        v-for="(item, index) in items"
        :key="item.elementId"
        type="button"
        role="option"
        :aria-selected="index === activeIndex"
        class="flex h-[34px] w-full items-center gap-2 rounded-full px-3 text-left transition-colors"
        :class="index === activeIndex ? 'bg-accent-subtle' : 'hover:bg-surface-2'"
        @mouseenter="emit('hover', index)"
        @click="emit('pick', item)"
      >
        <span class="min-w-0 flex-1 truncate text-caption" :class="index === activeIndex ? 'text-accent' : 'text-text-primary'">
          {{ item.label }}
        </span>
        <span class="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-meta text-text-secondary">{{ tr(item.kind) }}</span>
        <span v-if="item.status" class="shrink-0 text-meta text-text-muted">{{ tr(item.status) }}</span>
      </button>
    </div>
  </Teleport>
</template>
