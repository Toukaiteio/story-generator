<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Eye, Loader2, MessageCircleQuestion, Pause, Play, Sparkles, Wand2 } from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'
import SuggestionCard from './SuggestionCard.vue'
import { useStoryProject, useStudioActions, countWords, markdownToHtml, detectMarkdown, type SelectionAction } from '@/app'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'

const props = defineProps<{ chapterId: string }>()
const tr = translatePhrase

const projectStore = useStoryProject()
const actions = useStudioActions()
const toast = useToast()

const chapter = computed(() =>
  projectStore.activeProject?.chapters.find(item => item.id === props.chapterId),
)

const title = ref('')
const content = ref('')
const savedContent = ref('')
const saving = ref(false)
const dirty = computed(() => content.value !== savedContent.value)

const selStart = ref(0)
const selEnd = ref(0)
const hasSelection = computed(() => selEnd.value > selStart.value)

const suggestion = ref<{ kind: 'rewrite' | 'append'; original: string; revised: string; start: number; end: number } | null>(null)
const working = ref(false)
const humanizing = ref(false)
const streaming = ref(false)
const recapText = ref('')
const askOpen = ref(false)
const askDraft = ref('')
const action = ref<SelectionAction>('deepen')
const textarea = ref<HTMLTextAreaElement | null>(null)
let saveTimer: ReturnType<typeof setTimeout> | null = null
let continueController: AbortController | null = null

watch(
  () => props.chapterId,
  () => {
    flushSave()
    hydrate()
    suggestion.value = null
    recapText.value = ''
  },
  { immediate: true },
)

watch(chapter, target => {
  if (target && !content.value && !savedContent.value && target.content) {
    hydrate()
  }
})

function hydrate() {
  title.value = chapter.value?.title ?? ''
  content.value = chapter.value?.content ?? ''
  savedContent.value = content.value
}

watch([title, content], () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void save(), 900)
})

async function save() {
  const project = projectStore.activeProject
  const target = chapter.value
  if (!project || !target) return
  if (title.value === target.title && content.value === target.content) return

  saving.value = true
  try {
    const chapters = project.chapters.map(item => item.id === target.id
      ? {
          ...item,
          title: title.value.trim() || item.title,
          content: content.value,
          status: item.status === 'outline' && content.value.trim() ? ('draft' as const) : item.status,
          proofreadingIssuesStale: item.content !== content.value ? true : item.proofreadingIssuesStale,
          updatedAt: new Date().toISOString(),
        }
      : item)
    const saved = await projectStore.updateProject(project.id, { chapters })
    if (saved) savedContent.value = content.value
  } finally {
    saving.value = false
  }
}

function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    void save()
  }
}

function syncSelection() {
  const node = textarea.value
  if (!node) return
  selStart.value = node.selectionStart
  selEnd.value = node.selectionEnd
}

function selectionText() {
  return content.value.slice(selStart.value, selEnd.value)
}

function selectionContext() {
  return {
    chapterTitle: title.value || chapter.value?.title || '',
    chapterNumber: (chapter.value?.index ?? 0) + 1,
    before: content.value.slice(Math.max(0, selStart.value - 600), selStart.value),
    after: content.value.slice(selEnd.value, selEnd.value + 600),
  }
}

async function runSelection(next: SelectionAction) {
  const selected = selectionText()
  if (!selected || working.value) return
  action.value = next
  working.value = true
  try {
    const instruction = next === 'custom' ? askDraft.value : undefined
    const revised = await actions.improveSelection(next, selected, selectionContext(), { instruction })
    if (revised) {
      suggestion.value = { kind: 'rewrite', original: selected, revised, start: selStart.value, end: selEnd.value }
    }
  } catch (error: any) {
    toast.error(error?.message || 'Rewrite failed')
  } finally {
    working.value = false
    askOpen.value = false
    askDraft.value = ''
  }
}

async function runContinue() {
  if (working.value || !chapter.value) return
  flushSave()
  continueController = new AbortController()
  streaming.value = true
  const buffer = { text: '' }
  try {
    buffer.text = await actions.continueChapter(chapter.value.id, {
      signal: continueController.signal,
      onToken: token => {
        buffer.text += token
        suggestion.value = { kind: 'append', original: '', revised: buffer.text, start: content.value.length, end: content.value.length }
      },
    })
    suggestion.value = { kind: 'append', original: '', revised: buffer.text, start: content.value.length, end: content.value.length }
  } catch (error: any) {
    if (error?.name !== 'AbortError') toast.error(error?.message || 'Continue failed')
  } finally {
    streaming.value = false
    continueController = null
  }
}

function acceptSuggestion() {
  const active = suggestion.value
  if (!active) return
  if (active.kind === 'rewrite') {
    content.value = content.value.slice(0, active.start) + active.revised + content.value.slice(active.end)
  } else {
    const glue = content.value && !/\s$/.test(content.value) ? '\n\n' : ''
    content.value = content.value + glue + active.revised
  }
  suggestion.value = null
}

async function runHumanizeSelection() {
  const selected = selectionText()
  if (!selected || humanizing.value) return
  humanizing.value = true
  try {
    const result = await actions.humanizeText(selected, { chapterId: props.chapterId })
    suggestion.value = {
      kind: 'rewrite',
      original: selected,
      revised: result.text,
      start: selStart.value,
      end: selEnd.value,
    }
  } catch (error: any) {
    toast.error(error?.message || 'Humanize failed')
  } finally {
    humanizing.value = false
  }
}

async function runHumanizeChapter() {
  if (humanizing.value || !content.value.trim()) return
  flushSave()
  humanizing.value = true
  try {
    const result = await actions.humanizeChapter(props.chapterId)
    suggestion.value = {
      kind: 'rewrite',
      original: content.value,
      revised: result.text,
      start: 0,
      end: content.value.length,
    }
  } catch (error: any) {
    toast.error(error?.message || 'Humanize failed')
  } finally {
    humanizing.value = false
  }
}

async function runRecap() {
  if (working.value) return
  working.value = true
  try {
    recapText.value = await actions.recap(undefined, props.chapterId)
  } catch (error: any) {
    toast.error(error?.message || 'Recap failed')
  } finally {
    working.value = false
  }
}

onBeforeUnmount(() => {
  flushSave()
  continueController?.abort()
})

const previewHtml = computed(() =>
  content.value && detectMarkdown(content.value) ? markdownToHtml(content.value) : '',
)
</script>

<template>
  <div v-if="chapter" class="flex h-full min-h-0 flex-col">
    <header class="flex items-center gap-2 border-b border-surface-3 bg-surface-1 px-4 py-2.5">
      <input
        v-model="title"
        class="min-w-0 flex-1 bg-transparent text-base font-bold text-text-primary outline-none placeholder:text-text-muted"
        :placeholder="tr('Chapter title')"
      >
      <span class="text-2xs" :class="saving ? 'text-warning' : dirty ? 'text-accent' : 'text-text-muted'">
        {{ saving ? '…' : dirty ? '●' : '' }}
      </span>
      <div class="ml-auto flex items-center gap-1.5">
        <span class="text-2xs text-text-muted">{{ countWords(content) }} {{ tr('words') }}</span>
        <BaseButton variant="ghost" size="sm" :loading="humanizing" :disabled="streaming || working" @click="runHumanizeChapter">
          <Wand2 :size="13" />
          <span>{{ tr('Humanize') }}</span>
        </BaseButton>
        <BaseButton variant="ghost" size="sm" :disabled="working || humanizing" :loading="working && !streaming" @click="runRecap">
          <MessageCircleQuestion :size="13" />
          <span>{{ tr('Catch me up') }}</span>
        </BaseButton>
        <BaseButton variant="primary" size="sm" :loading="streaming" @click="streaming ? continueController?.abort() : runContinue()">
          <Pause v-if="streaming" :size="13" />
          <Play v-else :size="13" />
          <span>{{ streaming ? tr('Stop') : tr('Continue') }}</span>
        </BaseButton>
      </div>
    </header>

    <div v-if="recapText" class="mx-4 mt-3 rounded-2xl border border-surface-4 bg-surface-1 px-4 py-3">
      <div class="flex items-start justify-between gap-3">
        <p class="whitespace-pre-wrap text-xs leading-relaxed text-text-secondary">{{ recapText }}</p>
        <BaseButton variant="ghost" size="sm" @click="recapText = ''">
          <Eye :size="13" class="rotate-180" />
        </BaseButton>
      </div>
    </div>

    <div class="flex min-h-0 flex-1 gap-3 overflow-hidden p-4">
      <div class="relative flex min-w-0 flex-1 flex-col">
        <div
          v-if="hasSelection && !suggestion"
          class="absolute -top-1 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-surface-4 bg-surface-2/95 px-1.5 py-1 shadow-xl backdrop-blur"
        >
          <button
            v-for="item in [
              { key: 'deepen', label: 'Deepen' },
              { key: 'trim', label: 'Trim' },
              { key: 'show', label: 'Show' },
              { key: 'dialogue', label: 'Dialogue' },
              { key: 'fix', label: 'Fix' },
            ]"
            :key="item.key"
            type="button"
            class="rounded-full px-2.5 py-1 text-2xs font-semibold text-text-secondary transition-colors hover:bg-surface-4 hover:text-text-primary"
            :disabled="working"
            @click="runSelection(item.key as SelectionAction)"
          >
            {{ tr(item.label) }}
          </button>
          <button
            type="button"
            class="rounded-full px-2.5 py-1 text-2xs font-semibold text-accent transition-colors hover:bg-accent-subtle"
            :disabled="humanizing"
            @click="runHumanizeSelection"
          >
            {{ tr('Humanize') }}
          </button>
          <button
            type="button"
            class="flex items-center rounded-full px-2.5 py-1 text-2xs font-semibold text-accent transition-colors hover:bg-accent-subtle"
            :disabled="working"
            @click="askOpen = !askOpen"
          >
            <Sparkles :size="12" />
          </button>
        </div>

        <div v-if="askOpen" class="mb-2 flex items-center gap-2">
          <input
            v-model="askDraft"
            class="h-8 flex-1 rounded-full border border-surface-4 bg-surface-2 px-3.5 text-xs text-text-primary outline-none transition-colors focus:border-accent/60 placeholder:text-text-muted"
            :placeholder="tr('Tell the editor what to do with the selection')"
            @keydown.enter="runSelection('custom')"
          >
          <BaseButton variant="primary" size="sm" :loading="working" @click="runSelection('custom')">
            {{ tr('Rewrite') }}
          </BaseButton>
        </div>

        <textarea
          ref="textarea"
          v-model="content"
          class="min-h-0 flex-1 resize-none rounded-2xl border border-surface-4 bg-surface-1 p-5 text-sm leading-7 text-text-primary outline-none transition-colors focus:border-accent/60"
          :placeholder="tr('Start writing, or press Continue and edit what arrives.')"
          @select="syncSelection"
          @keyup="syncSelection"
          @mouseup="syncSelection"
        />
      </div>

      <aside v-if="suggestion" class="w-80 shrink-0 overflow-y-auto">
        <SuggestionCard
          :original="suggestion.original"
          :revised="suggestion.revised"
          :kind="suggestion.kind"
          :busy="streaming"
          @accept="acceptSuggestion"
          @discard="suggestion = null"
        />
      </aside>

      <aside v-else-if="previewHtml" class="w-80 shrink-0 overflow-y-auto rounded-2xl border border-surface-4 bg-surface-1 p-4">
        <div class="prose-sm" v-html="previewHtml"></div>
      </aside>
    </div>
  </div>

  <div v-else class="flex h-full items-center justify-center">
    <Loader2 class="animate-spin text-text-muted" :size="20" />
  </div>
</template>
