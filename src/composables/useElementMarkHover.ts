import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { closestMark } from '@/components/studio/editorDom'
import { MARK_POPOVER_DELAY_MS } from '@/app'
import type { StoryElement } from '@/types/element'

export interface ActiveElementMark {
  element: StoryElement
  anchorRect: DOMRect
  containerRect: DOMRect | null
  aliasedText: string
}

const POPOVER_SELECTOR = '.element-mark-popover'
const CLOSE_GRACE_MS = 120

/** One shared 500ms hover timer per editor surface; hovering a bubble keeps it open. */
export function useElementMarkHover(elements: Ref<StoryElement[] | undefined>) {
  const active = ref<ActiveElementMark | null>(null) as Ref<ActiveElementMark | null>
  let openTimer: ReturnType<typeof setTimeout> | null = null
  let closeTimer: ReturnType<typeof setTimeout> | null = null
  let pendingMark: HTMLElement | null = null

  function cancelOpen() {
    if (openTimer) clearTimeout(openTimer)
    openTimer = null
    pendingMark = null
  }

  function cancelClose() {
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = null
  }

  function close() {
    cancelOpen()
    cancelClose()
    active.value = null
  }

  function scheduleClose() {
    cancelClose()
    closeTimer = setTimeout(() => {
      closeTimer = null
      active.value = null
    }, CLOSE_GRACE_MS)
  }

  function show() {
    openTimer = null
    const mark = pendingMark
    pendingMark = null
    if (!mark?.isConnected) return
    const element = (elements.value ?? []).find(item => item.id === mark.dataset.elementId)
    if (!element) return
    active.value = {
      element,
      anchorRect: mark.getBoundingClientRect(),
      containerRect: mark.closest('[data-mark-container]')?.getBoundingClientRect() ?? null,
      aliasedText: mark.dataset.alias === 'true' ? mark.textContent ?? '' : '',
    }
    closeTimer = null
  }

  function schedule(mark: HTMLElement) {
    const current = active.value
    if (current
      && current.element.id === mark.dataset.elementId
      && current.anchorRect.top === mark.getBoundingClientRect().top) return
    cancelOpen()
    cancelClose()
    pendingMark = mark
    openTimer = setTimeout(show, MARK_POPOVER_DELAY_MS)
  }

  function handleMouseOver(event: MouseEvent) {
    const mark = closestMark(event.target as Node)
    if (mark) schedule(mark)
  }

  function handleMouseOut(event: MouseEvent) {
    const mark = closestMark(event.target as Node)
    if (!mark) return
    const related = event.relatedTarget as Node | null
    if (related && (mark.contains(related) || closestMark(related) === mark)) return
    if (related && (related as Element).closest?.(POPOVER_SELECTOR)) return
    const nextMark = related ? closestMark(related) : null
    if (nextMark) {
      close()
      return
    }
    if (pendingMark) cancelOpen()
    if (active.value) scheduleClose()
  }

  function handleFocusIn(event: FocusEvent) {
    const mark = closestMark(event.target as Node)
    if (mark) schedule(mark)
  }

  function handleFocusOut(event: FocusEvent) {
    const mark = closestMark(event.target as Node)
    if (!mark) return
    const related = event.relatedTarget as Node | null
    if (related && (related as Element).closest?.(POPOVER_SELECTOR)) return
    cancelOpen()
    if (active.value) active.value = null
  }

  function handlePointerDown(event: MouseEvent) {
    if (!active.value) return
    const target = event.target as Node | null
    if (target && ((target as Element).closest?.(POPOVER_SELECTOR) || closestMark(target))) return
    close()
  }

  function handleScroll() {
    if (active.value || pendingMark) close()
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && active.value) close()
  }

  onMounted(() => {
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeydown)
    window.addEventListener('scroll', handleScroll, true)
  })

  onBeforeUnmount(() => {
    close()
    document.removeEventListener('mousedown', handlePointerDown)
    document.removeEventListener('keydown', handleKeydown)
    window.removeEventListener('scroll', handleScroll, true)
  })

  return {
    active,
    close,
    cancelOpen,
    scheduleClose,
    popoverEnter: cancelClose,
    popoverLeave: scheduleClose,
    handleMouseOver,
    handleMouseOut,
    handleFocusIn,
    handleFocusOut,
  }
}
