<script lang="ts">
import type { InjectionKey } from 'vue'

export interface MarkHoverContext {
  activeElementId: string | null
  activeAlias: string
}

export const MARK_HOVER_KEY: InjectionKey<MarkHoverContext> = Symbol('element-mark-hover')
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowUpRight } from 'lucide-vue-next'
import BaseTag from '@/components/ui/BaseTag.vue'
import { translatePhrase, formatChapterLabel } from '@/i18n'
import { elementStateAt, latestElementState, isStatusValidForKind } from '@/app'
import type { StoryElement } from '@/types/element'

const props = defineProps<{
  element: StoryElement
  chapterIndex: number
  anchorRect: DOMRect | null
  aliasedText?: string
  containerRect?: DOMRect | null
  onHoverChange?: (active: boolean) => void
}>()

const emit = defineEmits<{
  close: []
  openElement: [elementId: string]
}>()

const tr = translatePhrase
const popover = ref<HTMLElement | null>(null)
const position = ref({ top: 0, left: 0, placement: 'bottom' as 'top' | 'bottom' })
const WIDTH = 304
const GAP = 8
const MARGIN = 8

const state = computed(() =>
  elementStateAt(props.element, props.chapterIndex) ?? latestElementState(props.element),
)
const stateIsFromThisChapter = computed(() =>
  Boolean(elementStateAt(props.element, props.chapterIndex)),
)
const stateStatus = computed(() => {
  const status = state.value?.status
  if (!status) return ''
  return isStatusValidForKind(props.element.kind, status) ? tr(status) : `${tr(status)} · ${tr('not valid for this kind')}`
})

function computePosition() {
  const anchor = props.anchorRect
  if (!anchor) return
  const viewportHeight = window.innerHeight
  const box = props.containerRect
  const minTop = Math.max(MARGIN, box?.top ?? MARGIN)
  const maxBottom = Math.min(viewportHeight - MARGIN, box?.bottom ?? viewportHeight - MARGIN)
  const estimatedHeight = 196
  const below = anchor.bottom + GAP
  const above = anchor.top - GAP - estimatedHeight
  const placeAbove = below + estimatedHeight > maxBottom && above >= minTop
  const top = placeAbove ? above : Math.min(below, maxBottom - estimatedHeight)
  const minLeft = Math.max(MARGIN, box?.left ?? MARGIN)
  const maxLeft = Math.max(minLeft, Math.min(window.innerWidth - MARGIN, box?.right ?? window.innerWidth - MARGIN) - WIDTH)
  const left = Math.max(minLeft, Math.min(anchor.left, maxLeft))
  position.value = {
    top: Math.max(minTop, top),
    left,
    placement: placeAbove ? 'top' : 'bottom',
  }
}

function handleEnter() {
  props.onHoverChange?.(true)
}

function handleLeave() {
  props.onHoverChange?.(false)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

computePosition()

watch(() => [props.anchorRect, props.containerRect] as const, () => {
  void nextTick(computePosition)
})

onMounted(() => {
  computePosition()
  document.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => document.removeEventListener('keydown', handleKeydown))

function onOpenElement() {
  emit('openElement', props.element.id)
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      ref="popover"
      class="element-mark-popover fixed z-[320] w-[304px] rounded-ios border border-line bg-surface-1 p-4 shadow-ios-lg"
      :style="{ top: `${position.top}px`, left: `${position.left}px` }"
      :data-placement="position.placement"
      role="dialog"
      :aria-label="element.name"
      @mouseenter="handleEnter"
      @mouseleave="handleLeave"
      @mousedown.stop
    >
      <div class="flex items-start justify-between gap-2">
        <p class="min-w-0 truncate text-caption font-semibold text-text-primary">{{ element.name }}</p>
        <BaseTag variant="accent" size="sm">{{ tr(element.kind) }}</BaseTag>
      </div>

      <p v-if="aliasedText" class="mt-1 text-meta text-text-muted">{{ tr('Alias') }}: {{ aliasedText }}</p>

      <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
        <BaseTag v-if="stateStatus" variant="default" size="sm">{{ stateStatus }}</BaseTag>
        <span class="text-meta text-text-muted">
          {{ stateIsFromThisChapter ? formatChapterLabel(chapterIndex) : tr('Latest state') }}
        </span>
      </div>

      <p class="mt-2 text-meta leading-relaxed text-text-secondary">
        {{ state?.summary || tr('No state recorded at this chapter yet') }}
      </p>

      <div class="mt-3 flex justify-end">
        <button class="app-key-action h-8 gap-1 px-3 text-meta" @click="onOpenElement">
          <ArrowUpRight :size="14" />
          {{ tr('Open details') }}
        </button>
      </div>
    </div>
  </Teleport>
</template>
