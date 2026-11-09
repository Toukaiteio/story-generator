<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { translatePhrase } from '@/i18n'
import type { DropdownItem } from './dropdown'

export type { DropdownItem } from './dropdown'

const props = defineProps<{
  items: DropdownItem[]
  /** Default menu width in pixels. */
  width?: number
}>()

const menuWidth = computed(() => props.width ?? 216)
const ITEM_HEIGHT = 36

const open = ref(false)
const containerRef = ref<HTMLDivElement>()
const panelRef = ref<HTMLElement>()
const submenuRef = ref<HTMLElement>()
const position = ref({ top: 0, left: 0 })
const submenuTop = ref(0)
const activeIndex = ref(-1)
const openSubmenu = ref<number | null>(null)
const submenuItems = computed<DropdownItem[]>(() =>
  openSubmenu.value === null ? [] : props.items[openSubmenu.value]?.children ?? [])
const submenuVisible = computed(() => open.value && submenuItems.value.length > 0)
const submenuTopStyle = computed(() => openSubmenu.value === null ? 0 : childTop(openSubmenu.value))
const submenuLeft = computed(() => {
  const rightSide = position.value.left + menuWidth.value + 4
  if (rightSide + menuWidth.value <= window.innerWidth - 8) return rightSide
  const leftSide = position.value.left - menuWidth.value - 4
  return Math.max(8, leftSide)
})

function clampPosition(rect: DOMRect, height: number) {
  const left = Math.max(8, Math.min(rect.right - menuWidth.value, window.innerWidth - menuWidth.value - 8))
  const top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - height - 8))
  return { top, left }
}

function toggle(e: MouseEvent) {
  if (open.value) {
    close()
    return
  }
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const height = Math.min(props.items.length * ITEM_HEIGHT + 32, window.innerHeight - 24)
  position.value = clampPosition(rect, height)
  open.value = true
  activeIndex.value = -1
  openSubmenu.value = null
  void nextTick(() => panelRef.value?.focus())
}

function close() {
  open.value = false
  openSubmenu.value = null
  activeIndex.value = -1
}

function handleItemClick(item: DropdownItem) {
  if (item.disabled || item.divider || item.heading || item.children?.length) return
  item.action?.()
  close()
}

function openChild(index: number, anchorTop: number) {
  openSubmenu.value = index
  submenuTop.value = anchorTop
}

function toggleSubmenu(index: number, event?: MouseEvent) {
  const anchor = event ? (event.currentTarget as HTMLElement).getBoundingClientRect().top : submenuTop.value
  if (openSubmenu.value === index) {
    openSubmenu.value = null
    return
  }
  openChild(index, anchor - 6)
}

function childHeight(index: number) {
  const children = props.items[index]?.children ?? []
  return Math.min(children.length * ITEM_HEIGHT + 12, 360)
}

function childTop(index: number) {
  return Math.max(8, Math.min(submenuTop.value, window.innerHeight - childHeight(index) - 8))
}

function hoverItem(index: number, event?: MouseEvent) {
  if (index < 0) return
  activeIndex.value = index
  const item = props.items[index]
  if (item?.children?.length) {
    if (openSubmenu.value !== index) openChild(index, (event?.currentTarget as HTMLElement | undefined)?.getBoundingClientRect().top ?? 8)
  } else {
    openSubmenu.value = null
  }
}

function onKeydown(event: KeyboardEvent) {
  if (!open.value) return
  const nav = props.items
    .map((item, index) => ({ item, index }))
    .filter(entry => !entry.item.divider && !entry.item.heading)
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const current = nav.findIndex(entry => entry.index === activeIndex.value)
    const next = event.key === 'ArrowDown'
      ? Math.min(nav.length - 1, current + 1)
      : Math.max(0, current <= 0 ? 0 : current - 1)
    if (nav[next]) hoverItem(nav[next].index)
  }
  if (event.key === 'ArrowRight' || event.key === 'Enter') {
    const item = props.items[activeIndex.value]
    if (!item) return
    event.preventDefault()
    if (item.children?.length) {
      const button = panelRef.value?.querySelectorAll<HTMLElement>('[role="menuitem"]')[activeIndex.value]
      const anchorTop = button ? button.getBoundingClientRect().top : position.value.top
      if (openSubmenu.value === activeIndex.value) openSubmenu.value = null
      else openChild(activeIndex.value, anchorTop - 6)
    } else {
      handleItemClick(item)
    }
  }
}

function handleClickOutside(e: MouseEvent) {
  const target = e.target as Node
  if (containerRef.value?.contains(target)) return
  if (panelRef.value?.contains(target)) return
  if (submenuRef.value?.contains(target)) return
  close()
}

function handleWindowChange() {
  if (open.value) close()
}

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside)
  window.addEventListener('resize', handleWindowChange)
  window.addEventListener('scroll', handleWindowChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleClickOutside)
  window.removeEventListener('resize', handleWindowChange)
  window.removeEventListener('scroll', handleWindowChange)
})

watch(open, value => {
  if (!value) openSubmenu.value = null
})
</script>

<template>
  <div ref="containerRef" class="relative inline-flex">
    <div class="cursor-pointer" @click="toggle">
      <slot name="trigger" />
    </div>

    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="open"
          ref="panelRef"
          class="fixed z-[200] max-h-[calc(100vh-16px)] overflow-y-auto rounded-ios border border-line bg-surface-1 p-1.5 shadow-ios-lg outline-none ring-0"
          style="pointer-events: auto"
          :style="{ top: position.top + 'px', left: position.left + 'px', width: menuWidth + 'px' }"
          role="menu"
          tabindex="0"
          @keydown="onKeydown"
        >
          <template v-for="(item, i) in items" :key="i">
            <div v-if="item.heading" class="flex items-center gap-2 px-3 pb-0.5 pt-2">
              <span class="text-meta font-medium text-text-muted">{{ translatePhrase(item.heading) }}</span>
              <span class="h-px flex-1 bg-line" />
            </div>
            <div v-else-if="item.divider" class="my-1 h-px bg-line" />
            <button
              v-else
              type="button"
              role="menuitem"
              :class="[
                'flex min-h-9 w-full items-center gap-2.5 rounded-full px-3.5 text-left text-caption transition-colors duration-100',
                item.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
                activeIndex === i && !item.disabled ? 'bg-surface-2' : '',
                item.danger
                  ? 'text-danger hover:bg-danger-subtle'
                  : 'text-text-primary hover:bg-surface-2',
              ]"
              :aria-checked="item.checked"
              :aria-haspopup="item.children?.length ? 'menu' : undefined"
              :disabled="item.disabled"
              @mouseenter="hoverItem(i, $event)"
              @click="item.children?.length ? toggleSubmenu(i, $event) : handleItemClick(item)"
            >
              <component :is="item.icon" v-if="item.icon" :size="16" class="shrink-0" />
              <span class="min-w-0 flex-1 truncate">{{ item.label ? translatePhrase(item.label) : '' }}</span>
              <span v-if="item.checked" class="shrink-0 text-accent">✓</span>
              <ChevronRight v-if="item.children?.length" :size="14" class="shrink-0 text-text-muted" />
            </button>
          </template>

        </div>
      </Transition>

      <Transition name="fade">
        <div
          v-show="submenuVisible"
          ref="submenuRef"
          class="fixed z-[201] max-h-[calc(100vh-16px)] overflow-y-auto rounded-ios border border-line bg-surface-1 p-1.5 shadow-ios-lg"
          style="pointer-events: auto"
          :style="{
            top: submenuTopStyle + 'px',
            left: submenuLeft + 'px',
            width: menuWidth + 'px',
          }"
          role="menu"
          @mouseenter="activeIndex = openSubmenu ?? -1"
        >
          <template v-for="(child, ci) in submenuItems" :key="ci">
            <div v-if="child.heading" class="px-3 pb-0.5 pt-2 text-meta font-medium text-text-muted">
              {{ translatePhrase(child.heading) }}
            </div>
            <div v-else-if="child.divider" class="my-1 h-px bg-line" />
            <button
              v-else
              type="button"
              role="menuitem"
              class="flex min-h-9 w-full items-center gap-2.5 rounded-full px-3.5 text-left text-caption transition-colors"
              :class="[
                child.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer text-text-primary hover:bg-surface-2',
                child.danger ? 'text-danger hover:bg-danger-subtle' : '',
              ]"
              :disabled="child.disabled"
              @click="handleItemClick(child)"
            >
              <component :is="child.icon" v-if="child.icon" :size="16" class="shrink-0" />
              <span class="min-w-0 flex-1 truncate">{{ translatePhrase(child.label ?? '') }}</span>
              <span v-if="child.checked" class="shrink-0 text-accent">✓</span>
            </button>
          </template>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
