import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { readEditorText, readSelectionOffsets } from '@/components/studio/editorDom'
import { paragraphRangeAt, type InlineTextRange } from '@/services/diff/inlineRange'

export type InlineReviewRange = InlineTextRange

export interface InlineReviewPayload {
  instruction: string
  original: string
  range: InlineReviewRange
  context: { chapterTitle: string; chapterNumber: number; before: string; after: string }
}

/**
 * Owns the Ctrl+I instruction box. It reads the target range, captures one
 * instruction, and hands the request to the view; the AI call and the diff
 * review live outside the editor, so no provider config is duplicated here.
 */
export { paragraphRangeAt }

export function useInlineReview(options: {
  root: ReturnType<typeof ref<HTMLElement | null>>
  busy: () => boolean
  onSubmit: (payload: InlineReviewPayload) => void
  chapterNumber: () => number
}) {
  const open = ref(false)
  const instruction = ref('')
  const range = ref<InlineReviewRange>({ start: 0, end: 0 })
  const generating = ref(false)
  const error = ref('')
  const anchor = ref<{ top: number; bottom: number; left: number; right: number } | null>(null)
  const input = ref<HTMLTextAreaElement | null>(null)

  const target = computed(() => range.value)

  function readRange(): InlineReviewRange | null {
    const node = options.root.value
    if (!node) return null
    const selection = readSelectionOffsets(node)
    if (!selection) return null
    if (selection.start !== selection.end) return { start: selection.start, end: selection.end }
    return paragraphRangeAt(readEditorText(node), selection.end)
  }

  function anchorRect(): typeof anchor.value {
    const node = options.root.value
    const selection = window.getSelection()
    let box: { top: number; bottom: number; left: number; right: number } | null = null
    if (selection?.rangeCount) {
      const live = selection.getRangeAt(0)
      const rect = live.getBoundingClientRect()
      if (rect.width || rect.height) {
        box = { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
      } else {
        // A collapsed range has no paint box in Chromium. Measure a throwaway
        // marker at the caret, then restore the selection untouched.
        const marker = document.createElement('span')
        marker.textContent = '\u200b'
        const probe = live.cloneRange()
        probe.insertNode(marker)
        const measured = marker.getBoundingClientRect()
        if (measured.width || measured.height) {
          box = { top: measured.top, bottom: measured.bottom, left: measured.left, right: measured.right }
        }
        marker.remove()
        if (selection?.rangeCount) {
          selection.removeAllRanges()
          selection.addRange(live)
        }
      }
    }
    if (!box) {
      const fallback = node?.getBoundingClientRect() ?? null
      if (fallback) box = { top: fallback.top, bottom: fallback.bottom, left: fallback.left, right: fallback.right }
    }
    return box
  }

  function openBox() {
    if (options.busy() || generating.value) return
    const next = readRange()
    if (!next || next.start === next.end) {
      error.value = 'Nothing selected and no paragraph at the cursor'
      return
    }
    anchor.value = anchorRect()
    range.value = next
    instruction.value = ''
    error.value = ''
    open.value = true
    void nextTick(() => input.value?.focus())
  }

  function close() {
    open.value = false
    instruction.value = ''
    error.value = ''
  }

  function fail(message: string) {
    generating.value = false
    error.value = message || 'Inline rewrite failed'
    open.value = true
    void nextTick(() => input.value?.focus())
  }

  function finish() {
    generating.value = false
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  function submit() {
    const directive = instruction.value.trim()
    if (!directive || generating.value) return
    const node = options.root.value
    if (!node) return
    const text = readEditorText(node)
    const area = range.value
    const original = text.slice(area.start, area.end)
    if (!original.trim()) {
      error.value = 'Nothing selected and no paragraph at the cursor'
      return
    }
    generating.value = true
    open.value = false
    options.onSubmit({
      instruction: directive,
      original,
      range: { ...area },
      context: {
        chapterTitle: '',
        chapterNumber: options.chapterNumber(),
        before: text.slice(Math.max(0, area.start - 600), area.start),
        after: text.slice(area.end, area.end + 600),
      },
    })
  }

  watch(open, value => {
    if (!value) instruction.value = ''
  })

  onBeforeUnmount(() => close())

  return {
    open,
    instruction,
    range,
    target,
    generating,
    error,
    anchor,
    input,
    openBox,
    close,
    fail,
    finish,
    submit,
    onKeydown,
    paragraphRangeAt,
  }
}
