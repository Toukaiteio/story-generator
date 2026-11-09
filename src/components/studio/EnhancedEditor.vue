<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Sparkles, X } from 'lucide-vue-next'
import {
  buildMarkDictionary,
  splicePlainText,
  type MarkDictionary,
} from '@/app'
import {
  readEditorText,
  readSelectionOffsets,
  renderEditorContent,
  renderInlineDiff,
  restoreSelectionOffsets,
  type EditorSelection,
} from './editorDom'
import ElementMarkPopover from './ElementMarkPopover.vue'
import ElementCompletion from './ElementCompletion.vue'
import { useElementMarkHover } from '@/composables/useElementMarkHover'
import { useInlineReview, type InlineReviewRange } from '@/composables/useInlineReview'
import {
  applyCompletion,
  resolveCompletion,
  type CompletionContext,
  type CompletionItem,
  type CompletionTrigger,
} from '@/app'
import type { StoryElement } from '@/types/element'
import type { ReviewSession } from '@/stores/chapterReview'
import { buildInlineDiffLayout } from '@/app'
import { translatePhrase } from '@/i18n'

const props = defineProps<{
  modelValue: string
  elements?: StoryElement[]
  chapterIndex: number
  placeholder?: string
  /** Live review for the current chapter, rendered inline in the prose. */
  inlineReview?: ReviewSession | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:selection': [start: number, end: number]
  openElement: [elementId: string]
  'inline-decide': [hunkId: string, decision: 'accepted' | 'rejected']
  'inline-decide-all': [decision: 'accepted' | 'rejected']
  'inline-dismiss': []
  'inline-open': []
  'inline-request': [payload: {
    instruction: string
    original: string
    range: InlineReviewRange
    context: { chapterTitle: string; chapterNumber: number; before: string; after: string }
  }]
}>()

const tr = translatePhrase
const root = ref<HTMLElement | null>(null)
const dictionary = ref<MarkDictionary>(buildMarkDictionary(props.elements))
const composing = ref(false)
const completionItems = ref<CompletionItem[]>([])
const completionContext = ref<CompletionContext | null>(null)
const completionIndex = ref(0)
const completionAnchor = ref<{ top: number; bottom: number; left: number; right: number } | null>(null)
const completionContainer = ref<{ top: number; bottom: number; left: number; right: number } | null>(null)
let lastValue = props.modelValue
let renderQueued = false
let lastSelection: EditorSelection | null = null
const undoStack: Array<{ text: string; selection: EditorSelection | null }> = []
const redoStack: Array<{ text: string; selection: EditorSelection | null }> = []
const HISTORY_LIMIT = 100

const inline = useInlineReview({
  root,
  busy: () => composing.value,
  chapterNumber: () => props.chapterIndex + 1,
  onSubmit: payload => emit('inline-request', payload),
})

const dictionaryKey = computed(() => (props.elements ?? [])
  .map(element => `${element.id}\u0000${element.name}\u0000${(element.aliases ?? []).join('\u0001')}`)
  .join('\u0002'))

const reviewLayout = computed(() => {
  const review = props.inlineReview
  if (!review) return null
  return buildInlineDiffLayout({ base: review.base, start: review.start, end: review.end, review })
})
const pendingIds = computed(() => reviewLayout.value?.pendingIds ?? [])
const activeHunkId = ref<string | null>(null)
const activeIndex = computed(() => Math.max(0, pendingIds.value.indexOf(activeHunkId.value ?? '')))
const positionLabel = computed(() => tr('Change {n} of {m}')
  .replace('{n}', String(activeIndex.value + 1))
  .replace('{m}', String(pendingIds.value.length)))
const toolbarPos = ref<{ left: number; top: number } | null>(null)
const toolbar = ref<HTMLElement | null>(null)
let remeasureQueued = false

watch(pendingIds, ids => {
  if (!ids.length) {
    activeHunkId.value = null
    toolbarPos.value = null
    return
  }
  if (!activeHunkId.value || !ids.includes(activeHunkId.value)) activeHunkId.value = ids[0]
}, { immediate: true })

function updateToolbarPosition(remeasure = false) {
  const node = root.value
  const review = props.inlineReview
  const hunkId = activeHunkId.value
  if (!node || !review || !hunkId) {
    toolbarPos.value = null
    return
  }
  const run = node.querySelector<HTMLElement>(`[data-inline-diff-run="${hunkId}"]`)
  const block = run?.closest<HTMLElement>('.editor-paragraph') ?? null
  const surface = node.getBoundingClientRect()
  if (!run || !block) {
    toolbarPos.value = null
    return
  }
  const rect = block.getBoundingClientRect()
  if (rect.bottom < surface.top + 4 || rect.top > surface.bottom - 4) {
    toolbarPos.value = null
    return
  }
  const runRect = run.getBoundingClientRect()
  const wrapper = node.parentElement?.getBoundingClientRect() ?? surface
  const measured = toolbar.value?.offsetWidth ?? 0
  if (!remeasure && !measured && !remeasureQueued) {
    remeasureQueued = true
    void nextTick(() => {
      remeasureQueued = false
      updateToolbarPosition(true)
    })
  }
  const width = measured || 340
  const top = rect.top - wrapper.top - 22
  const center = runRect.left - wrapper.left + runRect.width / 2 - width / 2
  toolbarPos.value = {
    left: width + 16 > wrapper.width
      ? Math.max(8, (wrapper.width - width) / 2)
      : Math.max(8, Math.min(center, wrapper.width - width - 8)),
    top: top >= 8 ? top : Math.max(8, rect.bottom - wrapper.top + 4),
  }
}

function scrollHunkIntoView(hunkId: string | null) {
  const node = root.value
  if (!node || !hunkId) return
  const block = node.querySelector<HTMLElement>(`[data-inline-diff-run="${hunkId}"]`)?.closest<HTMLElement>('.editor-paragraph')
  if (!block) return
  const placement = reviewLayout.value?.placements[hunkId]
  const paragraphs = [...node.querySelectorAll<HTMLElement>('.editor-paragraph')]
  const first = placement ? paragraphs[placement.contextStart] ?? block : block
  const last = placement ? paragraphs[placement.contextEnd] ?? block : block
  const surface = node.getBoundingClientRect()
  const top = first.getBoundingClientRect().top
  const bottom = last.getBoundingClientRect().bottom
  if (top < surface.top + 8) {
    node.scrollTop += top - surface.top - 8
  } else if (bottom > surface.bottom - 8) {
    node.scrollTop += bottom - surface.bottom + 8
  }
}

function decideHunk(hunkId: string, decision: 'accepted' | 'rejected') {
  const ids = pendingIds.value
  const index = ids.indexOf(hunkId)
  const remaining = ids.filter(id => id !== hunkId)
  const next = remaining.find(id => ids.indexOf(id) > index) ?? remaining[0] ?? null
  activeHunkId.value = next
  emit('inline-decide', hunkId, decision)
  void nextTick(() => scrollHunkIntoView(next))
}

function decideEveryHunk(decision: 'accepted' | 'rejected') {
  emit('inline-decide-all', decision)
}

function rejectEveryHunk() {
  emit('inline-decide-all', 'rejected')
}

function stepHunk(delta: number) {
  const ids = pendingIds.value
  if (!ids.length) return
  const index = Math.max(0, ids.indexOf(activeHunkId.value ?? ''))
  activeHunkId.value = ids[(index + delta + ids.length) % ids.length]
  void nextTick(() => {
    scrollHunkIntoView(activeHunkId.value)
    updateToolbarPosition()
  })
}

const hover = useElementMarkHover(computed(() => props.elements))
const activeMark = hover.active

const inlineOpen = inline.open
const instruction = inline.instruction
const generating = inline.generating
const inlineError = inline.error
const instructionInput = inline.input
const waitingBox = computed(() => {
  if (!generating.value) return null
  const anchor = inline.anchor.value
  const container = root.value?.parentElement?.getBoundingClientRect() ?? null
  const left = Math.max(8, Math.min(anchor?.left ?? 24, window.innerWidth - 240))
  const containerBottom = container ? container.bottom - 12 : window.innerHeight - 12
  const top = Math.max(8, Math.min((anchor?.bottom ?? 80) + 6, containerBottom - 40))
  return { left, top }
})

const inlineBox = computed(() => {
  if (!inlineOpen.value) return null
  const anchor = inline.anchor.value
  const container = root.value?.parentElement?.getBoundingClientRect() ?? null
  const width = Math.min(420, window.innerWidth - 24)
  const left = Math.max(8, Math.min(anchor?.left ?? 24, window.innerWidth - width - 8))
  const containerBottom = container ? container.bottom - 8 : window.innerHeight - 8
  const top = Math.min((anchor?.bottom ?? 80) + 8, containerBottom - 150)
  return { left, top: Math.max(8, top), width }
})

function emitSelection() {
  const node = root.value
  if (!node) return
  const selection = readSelectionOffsets(node) ?? { start: 0, end: 0 }
  lastSelection = selection
  emit('update:selection', selection.start, selection.end)
}

function recordHistory(text: string, selection: EditorSelection | null) {
  const previous = undoStack[undoStack.length - 1]
  if (previous && previous.text === text) return
  undoStack.push({ text, selection })
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
  redoStack.length = 0
}

function applyHistory(snapshot: { text: string; selection: EditorSelection | null }) {
  const node = root.value
  if (!node) return
  closeCompletion()
  emit('update:modelValue', snapshot.text)
  lastValue = snapshot.text
  renderEditorContent(node, snapshot.text, dictionary.value)
  if (snapshot.selection) restoreSelectionOffsets(node, snapshot.selection)
  emitSelection()
}

function undo() {
  const snapshot = undoStack.pop()
  if (!snapshot) return
  if (root.value) {
    redoStack.push({ text: props.modelValue, selection: readSelectionOffsets(root.value) })
  }
  applyHistory(snapshot)
}

function redo() {
  const snapshot = redoStack.pop()
  if (!snapshot) return
  if (root.value) {
    undoStack.push({ text: props.modelValue, selection: readSelectionOffsets(root.value) })
  }
  applyHistory(snapshot)
}

function closeCompletion() {
  completionItems.value = []
  completionContext.value = null
  completionIndex.value = 0
  completionAnchor.value = null
}

function selectionAnchorRect(): { top: number; bottom: number; left: number; right: number } | null {
  const selection = window.getSelection()
  if (!selection || !selection.rangeCount) return null
  const range = selection.getRangeAt(0).cloneRange()
  let rect = range.getBoundingClientRect()
  if (!rect || (!rect.width && !rect.height)) {
    const rects = range.getClientRects()
    rect = rects[rects.length - 1] ?? rect
  }
  if (!rect) return null
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
}

/**
 * Recomputes the popup from the live caret. Composing input bails out before
 * reading the DOM, so an IME candidate window never rebuilds the list.
 */
function refreshCompletion(trigger: CompletionTrigger = 'auto') {
  const node = root.value
  if (!node || composing.value) return
  const selection = readSelectionOffsets(node)
  if (!selection || selection.start !== selection.end) {
    closeCompletion()
    return
  }
  const result = resolveCompletion({
    text: readEditorText(node),
    caret: selection.end,
    trigger,
    composing: composing.value,
    elementList: props.elements,
    dictionary: dictionary.value,
    chapterIndex: props.chapterIndex,
  })
  if (!result.context || !result.items.length) {
    closeCompletion()
    return
  }
  const anchor = selectionAnchorRect()
  if (!anchor) {
    closeCompletion()
    return
  }
  const keepIndex = completionItems.value.length > 0
    && completionContext.value?.start === result.context.start
    && completionContext.value?.end === result.context.end
  completionContext.value = result.context
  completionItems.value = result.items
  if (!keepIndex) completionIndex.value = 0
  completionAnchor.value = anchor
  completionContainer.value = node.parentElement?.getBoundingClientRect() ?? node.getBoundingClientRect()
}

function acceptCompletion(item: CompletionItem) {
  const node = root.value
  const context = completionContext.value
  if (!node || !context) return
  const current = readEditorText(node)
  recordHistory(current, readSelectionOffsets(node))
  const next = applyCompletion(current, context, item)
  closeCompletion()
  emit('update:modelValue', next.text)
  lastValue = next.text
  renderEditorContent(node, next.text, dictionary.value)
  restoreSelectionOffsets(node, { start: next.caret, end: next.caret })
  node.focus()
  emitSelection()
}

function pickCompletion(item: CompletionItem) {
  acceptCompletion(item)
}

function moveCompletion(delta: number) {
  if (!completionItems.value.length) return
  const last = completionItems.value.length - 1
  completionIndex.value = Math.max(0, Math.min(last, completionIndex.value + delta))
}

function onCompletionKeydown(event: KeyboardEvent): boolean {
  if (!completionItems.value.length) return false
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    moveCompletion(event.key === 'ArrowDown' ? 1 : -1)
    return true
  }
  if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault()
    acceptCompletion(completionItems.value[completionIndex.value])
    return true
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    closeCompletion()
    return true
  }
  return false
}

function paint(preserveSelection = true) {
  const node = root.value
  if (!node || composing.value) return
  const selection = preserveSelection ? readSelectionOffsets(node) : null
  if (reviewLayout.value && props.inlineReview) {
    renderInlineDiff(node, reviewLayout.value, dictionary.value)
    lastValue = props.modelValue
    toolbarPos.value = null
    void nextTick(updateToolbarPosition)
    return
  }
  renderEditorContent(node, props.modelValue, dictionary.value)
  lastValue = props.modelValue
  if (selection) restoreSelectionOffsets(node, selection)
  emitSelection()
}

function paintFromDom() {
  const node = root.value
  if (!node || composing.value) return
  if (inlineOpen.value) return
  const text = readEditorText(node)
  const selection = readSelectionOffsets(node)
  if (text !== lastValue) recordHistory(lastValue, lastSelection)
  emit('update:modelValue', text)
  lastValue = text
  renderEditorContent(node, text, dictionary.value)
  if (selection) restoreSelectionOffsets(node, selection)
  emitSelection()
}

function schedulePaint() {
  if (renderQueued) return
  closeCompletion()
  renderQueued = true
  void nextTick(() => {
    renderQueued = false
    paint()
  })
}

function onInput(event: Event) {
  const node = root.value
  if (!node) return
  const inputEvent = event as InputEvent
  if (composing.value || inputEvent.isComposing) {
    closeCompletion()
    emit('update:modelValue', readEditorText(node))
    emitSelection()
    return
  }
  paintFromDom()
  refreshCompletion()
}

function onCompositionStart() {
  composing.value = true
  closeCompletion()
}

function onCompositionEnd() {
  composing.value = false
  void nextTick(() => {
    paintFromDom()
    refreshCompletion()
  })
}

function insertPlainText(text: string) {
  const node = root.value
  if (!node) return
  closeCompletion()
  const current = readEditorText(node)
  const selection = readSelectionOffsets(node) ?? { start: current.length, end: current.length }
  recordHistory(current, selection)
  const next = splicePlainText(current, selection.start, selection.end, text)
  emit('update:modelValue', next.text)
  lastValue = next.text
  renderEditorContent(node, next.text, dictionary.value)
  restoreSelectionOffsets(node, { start: next.caret, end: next.caret })
  emitSelection()
}

function onPaste(event: ClipboardEvent) {
  event.preventDefault()
  if (composing.value) return
  const text = event.clipboardData?.getData('text/plain') ?? ''
  if (text) insertPlainText(text)
}

function onBeforeInput(event: InputEvent) {
  if (composing.value) return
  if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
    event.preventDefault()
    insertPlainText('\n')
    return
  }
  if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop') {
    event.preventDefault()
  }
}

function openInline() {
  closeCompletion()
  inline.openBox()
  emit('inline-open')
}

function onKeydown(event: KeyboardEvent) {
  if (event.isComposing || composing.value) return
  if (props.inlineReview) {
    if (event.key === 'Escape') emit('inline-dismiss')
    return
  }
  const modifier = event.metaKey || event.ctrlKey
  if (modifier && (event.key === 'i' || event.key === 'I')) {
    event.preventDefault()
    openInline()
    return
  }
  if (inlineOpen.value) return
  if (modifier && event.key === ' ') {
    event.preventDefault()
    refreshCompletion('manual')
    return
  }
  if (onCompletionKeydown(event)) return
  if (modifier && (event.key === 'z' || event.key === 'Z')) {
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
    return
  }
  if (modifier && (event.key === 'y' || event.key === 'Y')) {
    event.preventDefault()
    redo()
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    insertPlainText('\n')
  }
}

function dismissInline() {
  inline.close()
  emit('inline-dismiss')
}

function closePopoverOnScroll() {
  hover.close()
  closeCompletion()
}

function onWindowResize() {
  closePopoverOnScroll()
  updateToolbarPosition()
}

function onDocumentSelectionChange() {
  const node = root.value
  const context = completionContext.value
  if (!node || !context) return
  const selection = window.getSelection()
  if (!selection || !selection.rangeCount || !node.contains(selection.anchorNode)) {
    closeCompletion()
    return
  }
  const offsets = readSelectionOffsets(node)
  if (!offsets || offsets.start !== offsets.end || offsets.start !== context.end) closeCompletion()
}

function clearSelection() {
  const selection = window.getSelection()
  selection?.removeAllRanges()
}

defineExpose({
  insertPlainText,
  openInline,
  finishInline: () => inline.finish(),
  failInline: (message: string) => inline.fail(message),
})

watch(
  () => props.modelValue,
  value => {
    if (value === lastValue) return
    lastValue = value
    if (composing.value) return
    schedulePaint()
  },
)

watch(() => props.chapterIndex, () => {
  if (composing.value) return
  void nextTick(() => {
    clearSelection()
    paint(false)
  })
})

watch(dictionaryKey, () => {
  dictionary.value = buildMarkDictionary(props.elements)
  if (composing.value) return
  schedulePaint()
})

onMounted(() => {
  paint(false)
  const node = root.value
  if (!node) return
  node.addEventListener('mouseover', hover.handleMouseOver)
  node.addEventListener('mouseout', hover.handleMouseOut)
  node.addEventListener('focusin', hover.handleFocusIn)
  node.addEventListener('focusout', hover.handleFocusOut)
  node.addEventListener('scroll', closePopoverOnScroll, true)
  node.addEventListener('blur', closeCompletion, true)
  window.addEventListener('resize', onWindowResize)
  document.addEventListener('selectionchange', onDocumentSelectionChange)
})

onBeforeUnmount(() => {
  const node = root.value
  if (node) {
    node.removeEventListener('mouseover', hover.handleMouseOver)
    node.removeEventListener('mouseout', hover.handleMouseOut)
    node.removeEventListener('focusin', hover.handleFocusIn)
    node.removeEventListener('focusout', hover.handleFocusOut)
    node.removeEventListener('scroll', closePopoverOnScroll, true)
    node.removeEventListener('blur', closeCompletion, true)
  }
  window.removeEventListener('resize', onWindowResize)
  document.removeEventListener('selectionchange', onDocumentSelectionChange)
})

const containerRect = computed(() => {
  const element = root.value
  return element ? element.parentElement?.getBoundingClientRect() ?? null : null
})

watch(() => props.inlineReview, review => {
  if (review) inline.close()
  void nextTick(() => {
    paint(false)
    updateToolbarPosition()
    void nextTick(() => {
      if (review) root.value?.parentElement?.querySelector<HTMLElement>('[data-diff-accept]')?.focus()
    })
  })
})

function onScroll() {
  closePopoverOnScroll()
  updateToolbarPosition()
}

watch([activeHunkId, reviewLayout], () => {
  void nextTick(updateToolbarPosition)
})
</script>

<template>
  <div class="relative flex min-h-0 flex-1 flex-col">
    <div
      ref="root"
      class="editor-surface min-h-0 w-full flex-1 overflow-y-auto rounded-ios bg-surface-1 px-8 py-6 text-base leading-[1.75] text-text-primary shadow-ios-pill outline-none transition-shadow focus:ring-2 focus:ring-inset focus:ring-accent/30"
      :contenteditable="inlineReview ? 'false' : 'true'"
      role="textbox"
      aria-multiline="true"
      data-mark-container
      :aria-label="placeholder"
      spellcheck="false"
      @input="onInput"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEnd"
      @paste="onPaste"
      @beforeinput="onBeforeInput"
      @keydown="onKeydown"
      @keyup="emitSelection"
      @mouseup="emitSelection"
      @select="emitSelection"
      @scroll.passive="onScroll"
      @drop.prevent
    />

    <span
      v-if="!modelValue.length"
      class="pointer-events-none absolute left-8 top-6 text-base leading-[1.75] text-text-muted"
    >{{ placeholder }}</span>

    <Teleport to="body">
      <div
        v-if="waitingBox && !inlineOpen"
        class="fixed z-[200] flex items-center gap-2 rounded-full border border-line bg-surface-1 px-3 py-1.5 shadow-ios-lg"
        :style="{ left: waitingBox.left + 'px', top: waitingBox.top + 'px' }"
        data-inline-waiting
      >
        <span class="h-3 w-3 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
        <span class="text-meta text-text-secondary">{{ tr('Generating rewrite') }}</span>
      </div>
      <div
        v-if="inlineBox"
        class="fixed z-[200] rounded-ios border border-line bg-surface-1 p-2.5 shadow-ios-lg"
        :style="{ left: inlineBox.left + 'px', top: inlineBox.top + 'px', width: inlineBox.width + 'px' }"
        data-inline-review
        @mousedown.stop
      >
        <div class="flex items-center gap-1.5 px-1 pb-1.5">
          <Sparkles :size="13" class="text-accent" />
          <p class="text-meta font-medium text-text-primary">{{ tr('Inline edit') }}</p>
          <button class="ml-auto app-icon-button h-6 w-6" :aria-label="tr('Cancel')" @click="inline.close()">
            <X :size="13" />
          </button>
        </div>
        <textarea
          ref="instructionInput"
          v-model="instruction"
          rows="2"
          class="w-full resize-none rounded-ios bg-surface-2 px-3 py-2 text-caption leading-relaxed text-text-primary outline-none ring-accent/40 placeholder:text-text-muted focus:ring-2 focus:ring-inset"
          :placeholder="tr('Quick instruction for the AI')"
          data-inline-input
          @keydown="inline.onKeydown"
        />
        <p v-if="inlineError" class="px-1 pt-1 text-meta text-danger">{{ tr(inlineError) }}</p>
        <p v-else class="px-1 pt-1 text-meta text-text-muted">{{ tr('Rewrite the selection, or the paragraph at the cursor') }}</p>
      </div>
    </Teleport>

    <ElementCompletion
      v-if="completionItems.length && completionContext"
      :items="completionItems"
      :active-index="completionIndex"
      :anchor-rect="completionAnchor"
      :container-rect="completionContainer"
      @pick="pickCompletion"
      @hover="completionIndex = $event"
    />

    <div
      v-if="inlineReview && pendingIds.length && toolbarPos"
      ref="toolbar"
      class="inline-diff-toolbar"
      :style="{ left: toolbarPos.left + 'px', top: toolbarPos.top + 'px' }"
      data-inline-diff-toolbar
      @mousedown.stop
    >
      <span class="text-meta text-text-muted" data-inline-diff-position>{{ positionLabel }}</span>
      <button type="button" class="inline-diff-action" data-diff-accept @click="decideHunk(activeHunkId!, 'accepted')">
        {{ tr('Accept') }}
      </button>
      <button type="button" class="inline-diff-action" data-diff-reject @click="decideHunk(activeHunkId!, 'rejected')">
        {{ tr('Reject') }}
      </button>
      <button type="button" class="inline-diff-action" data-diff-previous @click="stepHunk(-1)">
        {{ tr('Previous') }}
      </button>
      <button type="button" class="inline-diff-action" data-diff-next @click="stepHunk(1)">
        {{ tr('Next') }}
      </button>
      <button type="button" class="inline-diff-action" data-diff-accept-all @click="decideEveryHunk('accepted')">
        {{ tr('Accept all') }}
      </button>
      <button type="button" class="inline-diff-action" data-diff-reject-all @click="rejectEveryHunk">
        {{ tr('Reject all') }}
      </button>
      <button type="button" class="inline-diff-action" data-diff-close @click="dismissInline">
        {{ tr('Cancel') }}
      </button>
    </div>

    <ElementMarkPopover
      v-if="activeMark"
      :element="activeMark.element"
      :chapter-index="chapterIndex"
      :anchor-rect="activeMark.anchorRect"
      :container-rect="activeMark.containerRect ?? containerRect"
      :aliased-text="activeMark.aliasedText"
      @hover-change="active => active ? hover.popoverEnter() : hover.popoverLeave()"
      @close="hover.close()"
      @open-element="emit('openElement', $event)"
    />
  </div>
</template>
