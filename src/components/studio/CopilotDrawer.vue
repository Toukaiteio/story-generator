<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowUp, Loader2, Sparkles, Square, X } from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'
import SuggestionCard from './SuggestionCard.vue'
import { useStoryProject, useStudioActions, type ChapterPlanDraft } from '@/app'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'

const props = defineProps<{ open: boolean; chapterId: string | null }>()
const emit = defineEmits<{ close: [] }>()
const tr = translatePhrase

const projectStore = useStoryProject()
const actions = useStudioActions()
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
const planDraft = ref<ChapterPlanDraft | null>(null)
const elementProposals = ref<Array<{ name: string; kind: string; summary: string; status?: string }>>([])
const list = ref<HTMLElement | null>(null)
const input = ref<HTMLTextAreaElement | null>(null)
let controller: AbortController | null = null

const chapter = computed(() =>
  projectStore.activeProject?.chapters.find(item => item.id === props.chapterId) ?? null,
)

watch(
  () => props.open,
  open => {
    if (!open) {
      controller?.abort()
      streaming.value = ''
    } else {
      nextTick(() => input.value?.focus())
    }
  },
)

function scrollToBottom() {
  nextTick(() => list.value?.scrollTo({ top: list.value.scrollHeight, behavior: 'smooth' }))
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
  busy.value = true
  try {
    planDraft.value = await actions.proposeChapterPlan({ afterChapterId: props.chapterId ?? undefined })
  } catch (error: any) {
    toast.error(error?.message || 'Planning failed')
  } finally {
    busy.value = false
  }
}

async function acceptPlan() {
  if (!planDraft.value) return
  try {
    await actions.acceptChapterPlan(planDraft.value)
    planDraft.value = null
    toast.success('Chapter planned')
  } catch (error: any) {
    toast.error(error?.message || 'Failed to save plan')
  }
}

async function syncElements() {
  const target = chapter.value ?? projectStore.activeProject?.chapters[projectStore.activeProject.chapters.length - 1]
  if (!target?.content.trim() || busy.value) return
  busy.value = true
  elementProposals.value = []
  try {
    const result = await actions.proposeElementStates(target.id)
    elementProposals.value = result.map(item => ({
      name: item.name,
      kind: item.kind,
      summary: item.state.summary,
      status: item.state.status,
    }))
    if (!elementProposals.value.length) toast.info('No element changes found.')
  } catch (error: any) {
    toast.error(error?.message || 'Sync failed')
  } finally {
    busy.value = false
  }
}

async function applyProposals() {
  if (!elementProposals.value.length) return
  try {
    await actions.applyElementProposals(elementProposals.value.map(item => ({
      name: item.name,
      kind: item.kind as any,
      state: {
        chapterIndex: chapter.value?.index ?? 0,
        summary: item.summary,
        status: item.status as any,
      },
    })))
    elementProposals.value = []
    toast.success('Elements updated')
  } catch (error: any) {
    toast.error(error?.message || 'Apply failed')
  }
}
</script>

<template>
  <aside
    class="flex h-full flex-col border-l border-surface-3 bg-surface-1 transition-[width] duration-200"
    :class="open ? 'w-[360px]' : 'w-0 overflow-hidden'"
  >
    <header class="flex items-center justify-between px-4 py-3">
      <h2 class="text-2xs font-bold uppercase tracking-wider text-text-secondary">{{ tr('Copilot') }}</h2>
      <BaseButton variant="ghost" size="sm" @click="emit('close')">
        <X :size="14" />
      </BaseButton>
    </header>

    <div ref="list" class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-3">
      <div
        v-for="message in messages"
        :key="message.id"
        class="max-w-[92%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap"
        :class="message.role === 'user'
          ? 'ml-auto bg-accent-subtle text-text-primary'
          : 'bg-surface-2 text-text-secondary'"
      >
        {{ message.content }}
      </div>
      <p v-if="streaming" class="max-w-[92%] whitespace-pre-wrap rounded-2xl bg-surface-2 px-3.5 py-2.5 text-xs leading-relaxed text-text-secondary">
        {{ streaming }}
      </p>

      <div v-if="planDraft" class="rounded-2xl border border-accent/25 bg-surface-2 p-3">
        <p class="text-sm font-semibold text-text-primary">{{ planDraft.title }}</p>
        <p class="mt-1 text-xs leading-relaxed text-text-secondary">{{ planDraft.outline.objective }}</p>
        <p class="mt-1 text-xs leading-relaxed text-text-muted">{{ planDraft.outline.endingHook }}</p>
        <div class="mt-2.5 flex justify-end gap-1.5">
          <BaseButton variant="ghost" size="sm" @click="planDraft = null">
            <X :size="13" />
          </BaseButton>
          <BaseButton variant="primary" size="sm" @click="acceptPlan">
            {{ tr('Add chapter') }}
          </BaseButton>
        </div>
      </div>

      <div v-if="elementProposals.length" class="rounded-2xl border border-accent/25 bg-surface-2 p-3">
        <p class="text-2xs font-bold uppercase tracking-wider text-accent">{{ tr('Element updates') }}</p>
        <p v-for="(item, index) in elementProposals" :key="index" class="mt-1.5 text-xs leading-relaxed text-text-primary">
          <span class="font-semibold">{{ item.name }}</span>
          <template v-if="item.status"> · {{ item.status }}</template>
          — {{ item.summary }}
        </p>
        <div class="mt-2.5 flex justify-end gap-1.5">
          <BaseButton variant="ghost" size="sm" @click="elementProposals = []">
            <X :size="13" />
          </BaseButton>
          <BaseButton variant="primary" size="sm" @click="applyProposals">
            {{ tr('Apply') }}
          </BaseButton>
        </div>
      </div>
    </div>

    <div class="border-t border-surface-3 p-3">
      <div class="mb-2 flex flex-wrap items-center gap-1.5">
        <BaseButton variant="secondary" size="sm" :disabled="busy" @click="runRecap">
          {{ tr('Catch me up') }}
        </BaseButton>
        <BaseButton variant="secondary" size="sm" :loading="busy" @click="planNext">
          <Sparkles :size="12" />
          <span>{{ tr('Plan next') }}</span>
        </BaseButton>
        <BaseButton variant="secondary" size="sm" :disabled="busy || !chapter?.content.trim()" @click="syncElements">
          {{ tr('Sync elements') }}
        </BaseButton>
      </div>
      <div class="flex items-end gap-2 rounded-2xl border border-surface-4 bg-surface-2 px-3 py-2 transition-colors focus-within:border-accent/60">
        <textarea
          ref="input"
          v-model="draft"
          rows="1"
          class="max-h-32 min-h-6 flex-1 resize-none bg-transparent text-xs leading-6 text-text-primary outline-none placeholder:text-text-muted"
          :placeholder="tr('Ask, or say what to change')"
          @keydown.enter.exact.prevent="send"
        />
        <BaseButton v-if="busy" variant="ghost" size="sm" @click="controller?.abort()">
          <Square :size="13" />
        </BaseButton>
        <BaseButton v-else variant="ghost" size="sm" :disabled="!draft.trim()" @click="send">
          <Loader2 v-if="busy" :size="13" class="animate-spin" />
          <ArrowUp v-else :size="13" />
        </BaseButton>
      </div>
    </div>
  </aside>
</template>
