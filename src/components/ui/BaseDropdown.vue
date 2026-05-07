<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

export interface DropdownItem {
  label?: string
  icon?: any
  danger?: boolean
  disabled?: boolean
  divider?: boolean
  action?: () => void
}

const props = defineProps<{
  items: DropdownItem[]
}>()

const open = ref(false)
const containerRef = ref<HTMLDivElement>()
const position = ref({ top: 0, left: 0 })

function toggle(e: MouseEvent) {
  if (open.value) {
    open.value = false
    return
  }
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  position.value = {
    top: rect.bottom + 4,
    left: rect.left,
  }
  open.value = true
}

function handleItemClick(item: DropdownItem) {
  if (item.disabled || item.divider) return
  item.action?.()
  open.value = false
}

function handleClickOutside(e: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(e.target as Node)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', handleClickOutside))
onBeforeUnmount(() => document.removeEventListener('mousedown', handleClickOutside))
</script>

<template>
  <div ref="containerRef" class="relative inline-flex">
    <div @click="toggle" class="cursor-pointer">
      <slot name="trigger" />
    </div>

    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="open"
          class="fixed z-[200] min-w-[160px] py-1 rounded-lg border border-surface-4 bg-surface-2 shadow-xl"
          :style="{ top: position.top + 'px', left: position.left + 'px' }"
        >
          <template v-for="(item, i) in items" :key="i">
            <div v-if="item.divider" class="h-px bg-surface-4 my-1" />
            <button
              v-else
              type="button"
              :class="[
                'flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors duration-100',
                item.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
                item.danger
                  ? 'text-danger hover:bg-danger-subtle'
                  : 'text-text-primary hover:bg-surface-3',
              ]"
              :disabled="item.disabled"
              @click="handleItemClick(item)"
            >
              <component :is="item.icon" v-if="item.icon" :size="14" class="shrink-0" />
              <span>{{ item.label }}</span>
            </button>
          </template>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
