<script setup lang="ts">
import { ref, computed } from 'vue'

const props = withDefaults(defineProps<{
  text: string
  position?: 'top' | 'bottom' | 'left' | 'right'
}>(), {
  position: 'right',
})

const visible = ref(false)
const triggerRef = ref<HTMLElement>()

const tooltipStyle = computed(() => {
  if (!triggerRef.value) return {}
  const rect = triggerRef.value.getBoundingClientRect()
  const offset = 8

  switch (props.position) {
    case 'top':
      return { top: `${rect.top - offset}px`, left: `${rect.left + rect.width / 2}px`, transform: 'translate(-50%, -100%)' }
    case 'bottom':
      return { top: `${rect.bottom + offset}px`, left: `${rect.left + rect.width / 2}px`, transform: 'translate(-50%, 0)' }
    case 'left':
      return { top: `${rect.top + rect.height / 2}px`, left: `${rect.left - offset}px`, transform: 'translate(-100%, -50%)' }
    case 'right':
      return { top: `${rect.top + rect.height / 2}px`, left: `${rect.right + offset}px`, transform: 'translate(0, -50%)' }
  }
})
</script>

<template>
  <div
    ref="triggerRef"
    @mouseenter="visible = true"
    @mouseleave="visible = false"
    class="inline-flex"
  >
    <slot />
  </div>

  <Teleport to="body">
    <div
      v-if="visible && text"
      class="fixed z-[300] px-2 py-1 rounded-md bg-surface-4 text-text-primary text-xs font-medium whitespace-nowrap pointer-events-none shadow-lg"
      :style="tooltipStyle"
    >
      {{ text }}
    </div>
  </Teleport>
</template>
