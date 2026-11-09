<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  AlignLeft,
  ArrowUp,
  MessageSquare,
  Sparkles,
  Square,
  Wand2,
  X,
} from 'lucide-vue-next'
import TodoListStatus from '@/components/ui/TodoListStatus.vue'
import BaseDropdown from '@/components/ui/BaseDropdown.vue'
import type { DropdownItem } from '@/components/ui/dropdown'
import ToolCallStatus, { type ToolCallStatusItem } from '@/components/ui/ToolCallStatus.vue'
import ElementProposalList from './ElementProposalList.vue'
import { useStoryProject, useStudioActions, useStoryEngine } from '@/app'
import { useChapterReview } from '@/stores/chapterReview'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'
import type { ChapterPlanDraft, ElementStateProposal } from '@/app'

const props = defineProps<{ open: boolean; chapterId: string | null }>()
const emit = defineEmits<{
  close: []
  openChapter: [chapterId: string]
  planNext: []
}>()

const tr = translatePhrase
const projectStore = useStoryProject()
const actions = useStudioActions()
const engine = useStoryEngine()
const reviewStore = useChapterReview()
const toast = useToast()

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

const messages = ref<Message[]>([])
const draft = ref('')
const busy = ref(false)
const streaming = ref('')
const elementProposals = ref<ElementStateProposal[]>([])
const toolStatuses = ref<ToolCallStatusItem[]>([])
let toolCounter = 0
const list = ref<HTMLElement | null>(null)
const input = ref<HTMLTextAreaElement | null>(null)
let controller: AbortController | null = null

const chapter = computed(() =>
  projectStore.activeProject?.chapters.find(item => item.id === props.chapterId) ?? null,
)

const todoList = computed(() => engine.todoList)

const overflowItems = computed<DropdownItem[]>(() => [
  { heading: 'Actions' },
  { label: 'Plan next', icon: Sparkles, disabled: busy.value, action: () => emit('planNext') },
  { label: 'Catch me up', icon: AlignLeft, disabled: busy.value, action: () => void runRecap() },
  { label: 'Sync elements', icon: Wand2, disabled: busy.value || !chapter.value?.content.trim(), action: () => void syncElements() },
  { label: 'Proofread', icon: MessageSquare, disabled: busy.value || !chapter.value?.content.trim(), action: () => void proofread() },
  { label: 'Polish', icon: Wand2, disabled: busy.value || !chapter.value?.content.trim(), action: () => void polish() },
])

watch(
  () => props.open,
  open => {
    if (!open) {
      controller?.abort()
      streaming.value = ''
    }
  },
)

function scrollToBottom() {
  requestAnimationFrame(() => list.value?.scrollTo({ top: list.value.scrollHeight, behavior: 'smooth' }))
}

async function send() {
  const prompt = draft.value.trim()
  if (!prompt || busy.value) return
  draft.value = ''
  messages.value.push({ id: `m-${Date.now()}-u`, role: 'user', content: prompt })
  scrollToBottom()

  busy.value = true
  controller = new AbortController()
  streaming.value = ''
  try {
    const reply = await actions.askCopilot(prompt, {
      chapterId: props.chapterId,
      signal: controller.signal,
      history: messages.value.slice(-9, -1).map(message => ({
        role: message.role,
        content: message.content,
      })),
      onToken: token => {
        streaming.value += token
        scrollToBottom()
      },
    })
    messages.value.push({ id: `m-${Date.now()}-a`, role: 'assistant', content: reply })
  } catch (error: any) {
    if (error?.name !== 'AbortError') toast.error(error?.message || 'Copilot failed')
    if (streaming.value) messages.value.push({ id: `m-${Date.now()}-p`, role: 'assistant', content: streaming.value })
  } finally {
    streaming.value = ''
    busy.value = false
    controller = null
    scrollToBottom()
  }
}

async function runRecap() {
  if (busy.value) return
  busy.value = true
  try {
    messages.value.push({
      id: `m-${Date.now()}-r`,
      role: 'assistant',
      content: await actions.recap(undefined, props.chapterId ?? undefined),
    })
    scrollToBottom()
  } catch (error: any) {
    toast.error(error?.message || 'Recap failed')
  } finally {
    busy.value = false
  }
}

async function planNext() {
  if (busy.value) return
  emit('planNext')
}

async function syncElements() {
  const target = chapter.value
  if (!target?.content.trim() || busy.value) return
  busy.value = true
  elementProposals.value = []
  try {
    elementProposals.value = await actions.proposeElementStates(target.id)
    if (!elementProposals.value.length) toast.info('No element changes found')
  } catch (error: any) {
    toast.error(error?.message || 'Element sync failed')
  } finally {
    busy.value = false
  }
}

async function applyProposals(selected: ElementStateProposal[]) {
  if (!selected.length) return
  try {
    await actions.applyElementProposals(selected)
    elementProposals.value = []
    toast.success(`Applied ${selected.length} element updates`)
  } catch (error: any) {
    toast.error(error?.message || 'Apply failed')
  }
}

async function proofread() {
  const target = chapter.value
  if (!target || busy.value) return
  busy.value = true
  toolStatuses.value = [
    ...toolStatuses.value,
    { id: `proofread-${++toolCounter}`, name: 'proofread_chapter', status: 'running', title: 'Proofread chapter' },
  ]
  try {
    await actions.proofreadChapter(target.id)
    toolStatuses.value = toolStatuses.value.map(item =>
      item.status === 'running' ? { ...item, status: 'success' as const, detail: 'Proofreading finished' } : item)
    toast.success('Proofreading finished')
  } catch (error: any) {
    toolStatuses.value = toolStatuses.value.map(item =>
      item.status === 'running' ? { ...item, status: 'error' as const, detail: error?.message } : item)
    toast.error(error?.message || 'Proofreading failed')
  } finally {
    busy.value = false
  }
}

async function polish() {
  const target = chapter.value
  if (!target || busy.value) return
  busy.value = true
  toolStatuses.value = [
    ...toolStatuses.value,
    { id: `polish-${++toolCounter}`, name: 'polish_chapter', status: 'running', title: 'Polish chapter' },
  ]
  const before = target.content
  try {
    const polished = await actions.polishChapter(target.id)
    const current = projectStore.activeProject?.chapters.find(item => item.id === target.id)?.content
    if (current !== before) {
      toolStatuses.value = toolStatuses.value.map(item =>
        item.status === 'running'
          ? { ...item, status: 'warning' as const, detail: 'Chapter changed while polishing; run it again' }
          : item)
      toast.info('Chapter changed while polishing; run it again')
      return
    }
    const changed = Boolean(polished.trim()) && polished !== before
    if (changed) {
      reviewStore.propose({
        chapterId: target.id,
        label: 'Polish',
        base: before,
        original: before,
        revised: polished,
        start: 0,
        end: before.length,
        inline: true,
      })
      emit('openChapter', target.id)
    }
    toolStatuses.value = toolStatuses.value.map(item =>
      item.status === 'running'
        ? { ...item, status: changed ? 'success' as const : 'warning' as const, detail: changed ? 'Polish ready for review' : 'Polish produced no changes' }
        : item)
    if (!changed) toast.info('Polish produced no changes')
  } catch (error: any) {
    toolStatuses.value = toolStatuses.value.map(item =>
      item.status === 'running' ? { ...item, status: 'error' as const, detail: error?.message } : item)
    toast.error(error?.message || 'Polishing failed')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Transition name="slide-right">
    <aside
      v-if="open"
      class="flex w-[360px] max-w-full shrink-0 flex-col overflow-hidden rounded-ios-lg bg-surface-2/60"
    >
      <header class="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-3">
        <div class="flex min-w-0 items-center gap-2">
          <span class="flex h-8 w-8 items-center justify-center rounded-full bg-surface-1 text-accent shadow-ios-pill">
            <Sparkles :size="16" />
          </span>
          <div class="min-w-0">
            <p class="truncate text-caption font-semibold text-text-primary">{{ tr('Copilot') }}</p>
            <p class="truncate text-meta text-text-muted">{{ chapter?.title || tr('Whole project') }}</p>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <BaseDropdown :items="overflowItems" :width="200">
            <template #trigger>
              <div class="app-icon-button" :aria-label="tr('More actions')">
                <span class="text-body leading-none">⋯</span>
              </div>
            </template>
          </BaseDropdown>
          <button class="app-icon-button" :aria-label="tr('Close copilot')" @click="emit('close')">
            <X :size="18" />
          </button>
        </div>
      </header>

      <div ref="list" class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-6 pt-4">
        <TodoListStatus v-if="todoList.items.length" :items="todoList.items" :agent="todoList.agent" compact />

        <div v-if="toolStatuses.length" class="space-y-1">
          <ToolCallStatus
            v-for="status in toolStatuses"
            :key="status.id"
            :item="status"
          />
        </div>

        <div
          v-for="message in messages"
          :key="message.id"
          class="max-w-[94%] whitespace-pre-wrap rounded-ios px-3.5 py-2.5 text-caption leading-relaxed"
          :class="message.role === 'user'
            ? 'ml-auto bg-accent text-text-inverse'
            : 'bg-surface-1 text-text-secondary shadow-ios-pill'"
        >
          {{ message.content }}
        </div>

        <p v-if="streaming" class="max-w-[94%] whitespace-pre-wrap rounded-ios bg-surface-1 px-3.5 py-2.5 text-caption leading-relaxed text-text-secondary shadow-ios-pill">
          {{ streaming }}
        </p>

        <ElementProposalList
          v-if="elementProposals.length"
          :proposals="elementProposals"
          @apply="applyProposals"
          @discard="elementProposals = []"
        />

        <p v-if="!messages.length && !streaming && !todoList.items.length && !elementProposals.length" class="rounded-ios bg-surface-1 px-4 py-3 text-caption leading-relaxed text-text-secondary shadow-ios-pill">
          {{ tr('Ask about the chapter, or run one of the actions below.') }}
        </p>
      </div>

      <div class="shrink-0 px-4 pb-3">
        <div class="composer flex items-end gap-2 px-3 py-2">
          <textarea
            ref="input"
            v-model="draft"
            rows="1"
            class="max-h-32 min-h-6 flex-1 resize-none bg-transparent text-caption leading-6 text-text-primary outline-none placeholder:text-text-muted"
            :placeholder="tr('Ask, or say what to change')"
            @keydown.enter.exact.prevent="send"
          />
          <button
            v-if="busy"
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-secondary"
            @click="controller?.abort()"
          >
            <Square :size="14" />
          </button>
          <button
            v-else
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-text-inverse disabled:opacity-40"
            :disabled="!draft.trim()"
            @click="send"
          >
            <ArrowUp :size="15" />
          </button>
        </div>
      </div>
    </aside>
  </Transition>
</template>
