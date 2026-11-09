<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  AlignLeft,
  Eye,
  MessageSquare,
  Pause,
  PenLine,
  Play,
  Shapes as ShapesIcon,
  Sparkles,
  Wand2,
  X,
} from 'lucide-vue-next'
import BaseDropdown from '@/components/ui/BaseDropdown.vue'
import type { DropdownItem } from '@/components/ui/dropdown'
import EnhancedEditor from './EnhancedEditor.vue'
import StudioViewHeader from './StudioViewHeader.vue'
import ElementMarkPopover from './ElementMarkPopover.vue'
import ProofreadingReview from './ProofreadingReview.vue'
import ContextCapsules from './ContextCapsules.vue'
import {
  useStoryProject,
  useStudioActions,
  countWords,
  elementContextCapsules,
  detectMarkdown,
  markdownToHtml,
  buildMarkDictionary,
  markPreviewHtml,
  type SelectionAction,
} from '@/app'
import { useChapterEditor } from '@/composables/useChapterEditor'
import { useChapterReviewCommit } from '@/composables/useChapterReviewCommit'
import { useElementMarkHover } from '@/composables/useElementMarkHover'
import { useChapterReview } from '@/stores/chapterReview'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'
import type { StudioView } from './StudioViewHeader.vue'

const props = defineProps<{ chapterId: string | null }>()
const emit = defineEmits<{
  openElement: [elementId: string]
  switchView: [view: StudioView]
}>()

const tr = translatePhrase
const projectStore = useStoryProject()
const actions = useStudioActions()
const toast = useToast()

const chapter = computed(() =>
  props.chapterId
    ? projectStore.activeProject?.chapters.find(item => item.id === props.chapterId) ?? null
    : null,
)

const editor = useChapterEditor(() => chapter.value)
const {
  title,
  content,
  saving,
  dirty,
  hasSelection,
  working,
  humanizing,
  streaming,
  recapText,
  askOpen,
  askDraft,
  reviewOpen,
  textarea,
  syncSelectionFromOffsets,
  runSelection,
  runContinue,
  stopContinue,
  runHumanizeSelection,
  runHumanizeChapter,
  runRecap,
  runProofread,
  polishAll,
  applyIssueFix,
  ignoreIssue,
} = editor

const reviewStore = useChapterReview()
const inlineReview = computed(() =>
  chapter.value ? reviewStore.reviewFor(chapter.value.id) : null,
)
const committing = useChapterReviewCommit({
  chapterId: () => chapter.value?.id ?? null,
  content,
})
const editorComponent = ref<InstanceType<typeof EnhancedEditor> | null>(null)

function onInlineDecide(hunkId: string, decision: 'accepted' | 'rejected') {
  committing.decide(hunkId, decision)
}

function onInlineDecideAll(decision: 'accepted' | 'rejected') {
  committing.decideAll(decision)
}

function onInlineRequest(payload: {
  instruction: string
  original: string
  range: { start: number; end: number }
  context: { chapterTitle: string; chapterNumber: number; before: string; after: string }
}) {
  void runInlineRequest(payload)
}

async function runInlineRequest(payload: {
  instruction: string
  original: string
  range: { start: number; end: number }
  context: { chapterTitle: string; chapterNumber: number; before: string; after: string }
}) {
  const target = chapter.value
  const editorRef = editorComponent.value
  if (!target) return
  try {
    const revised = await actions.inlineRewrite(payload.instruction, payload.original, payload.context)
    editorRef?.finishInline()
    if (!revised.trim()) {
      editorRef?.failInline('The rewrite returned the same text')
      return
    }
    const changed = reviewStore.propose({
      chapterId: target.id,
      label: 'Inline edit',
      base: content.value,
      original: payload.original,
      revised,
      start: payload.range.start,
      end: payload.range.end,
      inline: true,
    })
    if (!changed) editorRef?.failInline('The rewrite returned the same text')
  } catch (error: any) {
    editorRef?.failInline(error?.message || 'Inline rewrite failed')
    toast.error(error?.message || 'Inline rewrite failed')
  }
}

const selectionActions: Array<{ key: SelectionAction; label: string }> = [
  { key: 'deepen', label: 'Deepen' },
  { key: 'trim', label: 'Trim' },
  { key: 'show', label: 'Show' },
  { key: 'dialogue', label: 'Dialogue' },
  { key: 'fix', label: 'Fix' },
]

const viewMode = ref<'write' | 'preview'>('write')
const contextOpen = ref(false)

watch(inlineReview, review => {
  if (review) viewMode.value = 'write'
})

const viewItems = computed<DropdownItem[]>(() => [
  { heading: 'Chapter' },
  { label: 'Preview', icon: Eye, checked: viewMode.value === 'preview', action: () => { viewMode.value = 'preview' } },
  { label: 'Write', icon: PenLine, checked: viewMode.value === 'write', action: () => { viewMode.value = 'write' } },
])

const actionItems = computed<DropdownItem[]>(() => [
  { heading: 'AI tools' },
  { label: 'Catch me up', icon: AlignLeft, disabled: working.value, action: () => void runRecap() },
  { label: 'De-AI', icon: Wand2, disabled: humanizing.value || streaming.value || working.value, action: () => void runHumanizeChapter() },
  { label: 'Proofread', icon: MessageSquare, disabled: working.value, action: () => void runProofread() },
  { label: 'Polish', icon: Sparkles, disabled: working.value, action: () => void polishAll() },
  { divider: true },
  { heading: 'Context' },
  { label: 'Inject context', icon: ShapesIcon, checked: contextOpen.value, action: () => { contextOpen.value = !contextOpen.value } },
  { divider: true },
  { heading: 'View' },
  ...viewItems.value.filter(item => !item.heading) as DropdownItem[],
])

function onKeydown(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return
  if (event.key.toLowerCase() !== 'p') return
  event.preventDefault()
  viewMode.value = viewMode.value === 'preview' ? 'write' : 'preview'
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
const elements = computed(() => projectStore.activeProject?.elements)
const dictionary = computed(() => buildMarkDictionary(elements.value))
const previewRef = ref<HTMLElement | null>(null)
const previewHover = useElementMarkHover(elements)

const previewContainerRect = computed(() =>
  previewRef.value ? previewRef.value.getBoundingClientRect() : null,
)

const previewHtml = computed(() => {
  if (!content.value) return ''
  if (detectMarkdown(content.value)) return markinPreview(markdownToHtml(content.value))
  return markinPreview(plainParagraphHtml(content.value))
})

function plainParagraphHtml(text: string): string {
  return text.split('\n').map(line => {
    const escaped = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
    return `<p>${escaped || '<br>'}</p>`
  }).join('')
}

function markinPreview(html: string): string {
  return markPreviewHtml(html, dictionary.value)
}

const issues = computed(() => chapter.value?.proofreadingIssues ?? [])
const words = computed(() => countWords(content.value))
const contextCount = computed(() =>
  elementContextCapsules(projectStore.activeProject?.elements, chapter.value?.index ?? 0, 99).items.length,
)
const selectionMenu = computed<DropdownItem[]>(() => [
  ...selectionActions.map(item => ({
    label: item.label,
    disabled: working.value,
    action: () => void runSelection(item.key),
  })),
  { divider: true },
  { label: 'De-AI', icon: Wand2, disabled: humanizing.value, action: () => void runHumanizeSelection() },
  { label: 'Ask the editor', icon: Sparkles, disabled: working.value, action: () => { askOpen.value = !askOpen.value } },
])

const headerActions = computed<DropdownItem[]>(() => [
  ...actionItems.value,
])
</script>

<template>
  <div v-if="chapter" class="flex h-full min-h-0 flex-col">
    <StudioViewHeader
      view="manuscript"
          :meta="saving ? tr('Saving') : dirty ? tr('Unsaved') : tr('Saved')"
      :menu-items="headerActions"
      @update:view="emit('switchView', $event)"
    >
      <template #title>
        <input
          v-model="title"
          class="min-w-0 flex-1 bg-transparent text-title font-semibold text-text-primary outline-none placeholder:text-text-muted"
          :placeholder="tr('Chapter title')"
        >
      </template>
      <template #actions>
        <button
          class="capsule h-9 gap-1.5 bg-surface-2 px-3 text-meta"
          :aria-expanded="contextOpen"
          @click="contextOpen = !contextOpen"
        >
          <ShapesIcon :size="13" />
          <span>{{ tr('Chapter context') }}（{{ contextCount }}）</span>
        </button>
        <button
          class="app-key-action h-9 gap-1.5 px-3.5 text-caption"
          :disabled="working || Boolean(inlineReview)"
          @click="streaming ? stopContinue() : runContinue()"
        >
          <Pause v-if="streaming" :size="14" />
          <Play v-else :size="14" />
          <span>{{ streaming ? tr('Stop') : tr('Continue') }}</span>
        </button>
      </template>
    </StudioViewHeader>

    <div class="relative flex min-h-0 flex-1 flex-col px-4 pb-5 pt-3">
      <Transition name="fade">
        <div
          v-if="contextOpen"
          class="absolute right-4 top-2 z-30 w-[min(460px,calc(100%-2rem))] rounded-ios border border-line bg-surface-1 p-3 shadow-ios-lg"
        >
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="text-meta font-medium text-text-muted">{{ tr('In context') }} · {{ contextCount }}</p>
            <button class="app-icon-button h-7 w-7" :aria-label="tr('Close')" @click="contextOpen = false">
              <X :size="15" />
            </button>
          </div>
          <ContextCapsules
            :project="projectStore.activeProject!"
            :chapter-index="chapter.index"
            :limit="99"
            :show-label="false"
            @open="emit('openElement', $event)"
          />
        </div>
      </Transition>

      <div v-if="recapText" class="mb-2 shrink-0 rounded-ios bg-surface-2/70 px-4 py-3">
        <div class="flex items-start justify-between gap-3">
          <p class="whitespace-pre-wrap text-caption leading-relaxed text-text-secondary">{{ recapText }}</p>
          <button class="app-icon-button shrink-0" :aria-label="tr('Hide recap')" @click="recapText = ''">
            <Eye :size="16" />
          </button>
        </div>
      </div>

      <div class="flex min-h-0 flex-1 gap-2">
        <div class="relative flex min-w-0 flex-1 flex-col">
          <div
            v-if="hasSelection && !inlineReview"
            class="absolute left-1/2 top-2 z-20 -translate-x-1/2"
          >
            <BaseDropdown :items="selectionMenu" :width="200">
              <template #trigger>
                <div class="capsule h-8 gap-1.5 bg-surface-1 px-3 text-meta shadow-ios-lg">
                  <span>{{ tr('Selection actions') }} ▾</span>
                </div>
              </template>
            </BaseDropdown>
          </div>

          <div v-if="askOpen" class="mb-2 flex shrink-0 items-center gap-2">
            <input
              v-model="askDraft"
              class="h-9 flex-1 rounded-full bg-surface-2 px-4 text-caption text-text-primary outline-none ring-accent/40 placeholder:text-text-muted focus:ring-2 focus:ring-inset"
              :placeholder="tr('Tell the editor what to do with the selection')"
              @keydown.enter="runSelection('custom')"
            >
            <button class="app-key-action h-9 px-4 text-caption" :disabled="working" @click="runSelection('custom')">
              {{ tr('Rewrite') }}
            </button>
          </div>

          <div v-if="viewMode === 'preview'" class="relative min-h-0 flex-1 overflow-y-auto rounded-ios bg-surface-1 p-8 shadow-ios-pill">
            <div
              v-if="content"
              ref="previewRef"
              class="markdown-preview max-w-[78ch]"
              data-mark-container
              v-html="previewHtml"
              @mouseover="previewHover.handleMouseOver"
              @mouseout="previewHover.handleMouseOut"
              @focusin="previewHover.handleFocusIn"
              @focusout="previewHover.handleFocusOut"
            ></div>
            <p v-else class="text-base text-text-muted">{{ tr('Start writing, or press Continue and edit what arrives.') }}</p>
            <span class="pointer-events-none absolute bottom-2 right-4 text-meta text-text-muted">{{ words }} {{ tr('words') }}</span>

            <ElementMarkPopover
              v-if="previewHover.active.value"
              :element="previewHover.active.value.element"
              :chapter-index="chapter?.index ?? 0"
              :anchor-rect="previewHover.active.value.anchorRect"
              :container-rect="previewHover.active.value.containerRect ?? previewContainerRect"
              :aliased-text="previewHover.active.value.aliasedText"
              @hover-change="active => active ? previewHover.popoverEnter() : previewHover.popoverLeave()"
              @close="previewHover.close()"
              @open-element="emit('openElement', $event)"
            />
          </div>
          <template v-else>
            <EnhancedEditor
              ref="editorComponent"
              v-model="content"
              :elements="elements"
              :chapter-index="chapter?.index ?? 0"
              :placeholder="tr('Start writing, or press Continue and edit what arrives.')"
              :inline-review="inlineReview"
              @update:selection="syncSelectionFromOffsets"
              @open-element="emit('openElement', $event)"
              @inline-request="onInlineRequest"
              @inline-decide="onInlineDecide"
              @inline-decide-all="onInlineDecideAll"
              @inline-dismiss="committing.cancel()"
            />
            <span class="pointer-events-none absolute bottom-2 right-4 text-meta text-text-muted">{{ words }} {{ tr('words') }}</span>
          </template>
        </div>

        <aside v-if="reviewOpen" class="w-[340px] shrink-0 overflow-hidden rounded-ios bg-surface-2/60">
          <ProofreadingReview
            :issues="issues"
            :busy="working"
            :stale="chapter.proofreadingIssuesStale"
            @apply-fix="applyIssueFix"
            @ignore="ignoreIssue"
            @polish-all="polishAll"
            @close="reviewOpen = false"
          />
        </aside>
      </div>
    </div>
  </div>

  <div v-else class="flex h-full min-h-0 flex-col">
    <StudioViewHeader
      view="manuscript"
      :title="tr('Manuscript')"
      @update:view="emit('switchView', $event)"
    />
    <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-text-muted">
      <PenLine :size="24" />
      <p class="text-caption">{{ tr('Pick a chapter to write') }}</p>
    </div>
  </div>
</template>
