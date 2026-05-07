<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

const props = withDefaults(defineProps<{
  direction?: 'horizontal' | 'vertical'
  initialSize?: number
  minSize?: number
  maxSize?: number
  limitSecond?: boolean
}>(), {
  direction: 'horizontal',
  initialSize: 260,
  minSize: 180,
  maxSize: 400,
  limitSecond: false,
})

const containerRef = ref<HTMLElement>()
const isDragging = ref(false)
const panelSize = ref(props.initialSize)

function onMouseDown(e: MouseEvent) {
  isDragging.value = true
  e.preventDefault()

  const onMove = (e: MouseEvent) => {
    if (!containerRef.value) return
    const rect = containerRef.value.getBoundingClientRect()
    if (props.direction === 'horizontal') {
      panelSize.value = Math.min(props.maxSize, Math.max(props.minSize, e.clientX - rect.left))
    } else {
      panelSize.value = Math.min(props.maxSize, Math.max(props.minSize, e.clientY - rect.top))
    }
  }

  const onUp = () => {
    isDragging.value = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
  document.body.style.cursor = props.direction === 'horizontal' ? 'col-resize' : 'row-resize'
  document.body.style.userSelect = 'none'
}
</script>

<template>
  <div
    ref="containerRef"
    :class="[
      'flex h-full',
      direction === 'horizontal' ? 'flex-row' : 'flex-col',
    ]"
  >
    <div
      v-if="!limitSecond"
      :style="direction === 'horizontal' ? { width: panelSize + 'px' } : { height: panelSize + 'px' }"
      class="shrink-0 overflow-hidden"
    >
      <slot name="first" />
    </div>

    <div
      v-else
      :class="[
        'flex-1 overflow-hidden',
        direction === 'horizontal' ? 'min-h-0' : 'min-w-0',
      ]"
    >
      <slot name="first" />
    </div>

    <div
      :class="[
        'shrink-0 group relative',
        direction === 'horizontal' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize',
      ]"
      @mousedown="onMouseDown"
    >
      <div
        :class="[
          'absolute transition-colors duration-100',
          direction === 'horizontal'
            ? 'inset-y-0 left-0 w-px'
            : 'inset-x-0 top-0 h-px',
          isDragging ? 'bg-accent' : 'bg-surface-4 group-hover:bg-accent/50',
        ]"
      />
    </div>

    <div
      v-if="!limitSecond"
      :class="[
        'flex-1 overflow-hidden',
        direction === 'horizontal' ? 'min-h-0' : 'min-w-0',
      ]"
    >
      <slot name="second" />
    </div>

    <div
      v-else
      :style="direction === 'horizontal' ? { width: panelSize + 'px' } : { height: panelSize + 'px' }"
      class="shrink-0 overflow-hidden"
    >
      <slot name="second" />
    </div>
  </div>
</template>
