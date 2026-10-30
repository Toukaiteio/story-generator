<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PanelRightOpen, PanelRightClose } from 'lucide-vue-next'
import StudioRail, { type StudioView } from './StudioRail.vue'
import StoryView from './StoryView.vue'
import BoardView from './BoardView.vue'
import ManuscriptView from './ManuscriptView.vue'
import ElementsView from './ElementsView.vue'
import CopilotDrawer from './CopilotDrawer.vue'
import CharacterDetail from '@/components/character/CharacterDetail.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useStoryProject, useStudioActions, useStoryEngine } from '@/app'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'
import type { ChapterPlanDraft } from '@/app'

const tr = translatePhrase

const projectStore = useStoryProject()
const actions = useStudioActions()
const engine = useStoryEngine()
const toast = useToast()

const view = ref<StudioView>('board')
const chapterId = ref<string | null>(null)
const copilotOpen = ref(true)
const characterDrawerId = ref<string | null>(null)
const planDraft = ref<{ chapterId: string | null; draft: ChapterPlanDraft } | null>(null)

const busy = computed(() => engine.isGenerating)

const chapters = computed(() => projectStore.activeProject?.chapters ?? [])

watch(chapters, list => {
  if (!list.length) {
    chapterId.value = null
    return
  }
  if (!chapterId.value || !list.some(item => item.id === chapterId.value)) {
    const firstDraft = list.find(item => ['writing', 'draft'].includes(item.status)) ?? list[list.length - 1]
    chapterId.value = firstDraft.id
  }
}, { immediate: true })

function openChapter(id: string) {
  chapterId.value = id
  view.value = 'manuscript'
}

async function planExisting(chapterId: string) {
  if (busy.value) return
  try {
    planDraft.value = { chapterId, draft: await actions.proposeChapterPlan({ chapterId }) }
  } catch (error: any) {
    toast.error(error?.message || 'Planning failed')
  }
}

async function planNext() {
  if (busy.value) return
  try {
    planDraft.value = { chapterId: null, draft: await actions.proposeChapterPlan({}) }
  } catch (error: any) {
    toast.error(error?.message || 'Planning failed')
  }
}

async function acceptPlan() {
  if (!planDraft.value) return
  try {
    if (planDraft.value.chapterId) {
      await actions.applyChapterPlan(planDraft.value.chapterId, planDraft.value.draft)
    } else {
      await actions.acceptChapterPlan(planDraft.value.draft)
    }
    planDraft.value = null
  } catch (error: any) {
    toast.error(error?.message || 'Failed to save plan')
  }
}

async function proofread(id: string) {
  if (busy.value) return
  try {
    await actions.proofreadChapter(id)
  } catch (error: any) {
    toast.error(error?.message || 'Proofreading failed')
  }
}

async function polish(id: string) {
  if (busy.value) return
  try {
    await actions.polishChapter(id)
  } catch (error: any) {
    toast.error(error?.message || 'Polishing failed')
  }
}
</script>

<template>
  <div v-if="projectStore.activeProject" class="flex h-full min-h-0">
    <StudioRail v-model="view" />

    <main class="relative flex min-w-0 flex-1 flex-col">
      <div class="absolute right-3 top-2.5 z-30">
        <BaseButton variant="ghost" size="sm" @click="copilotOpen = !copilotOpen">
          <PanelRightClose v-if="copilotOpen" :size="15" />
          <PanelRightOpen v-else :size="15" />
        </BaseButton>
      </div>

      <StoryView v-show="view === 'story'" class="min-h-0 flex-1" />
      <BoardView
        v-show="view === 'board'"
        class="min-h-0 flex-1"
        :chapters="chapters"
        :busy="busy"
        @open="openChapter"
        @write="openChapter"
        @proofread="proofread"
        @polish="polish"
        @plan="planExisting"
        @plan-next="planNext"
      />
      <ManuscriptView
        v-if="view === 'manuscript' && chapterId"
        class="min-h-0 flex-1"
        :chapter-id="chapterId"
      />
      <ElementsView
        v-show="view === 'elements'"
        class="min-h-0 flex-1"
        @open-character="characterDrawerId = $event"
      />

      <div
        v-if="planDraft"
        class="absolute inset-x-0 bottom-0 z-40 border-t border-accent/25 bg-surface-1/95 p-4 backdrop-blur"
      >
        <div class="mx-auto max-w-3xl">
          <p class="text-2xs font-bold uppercase tracking-wider text-accent">{{ tr('Proposed plan') }}</p>
          <p class="mt-1 text-sm font-semibold text-text-primary">{{ planDraft.draft.title }}</p>
          <p class="mt-1 text-xs leading-relaxed text-text-secondary">{{ planDraft.draft.outline.objective }} {{ planDraft.draft.outline.endingHook }}</p>
          <div class="mt-3 flex justify-end gap-1.5">
            <BaseButton variant="ghost" size="sm" @click="planDraft = null">{{ tr('Discard') }}</BaseButton>
            <BaseButton variant="primary" size="sm" @click="acceptPlan">{{ tr('Apply') }}</BaseButton>
          </div>
        </div>
      </div>
    </main>

    <CopilotDrawer :open="copilotOpen" :chapter-id="chapterId" @close="copilotOpen = false" />

    <div
      v-if="characterDrawerId"
      class="fixed inset-0 z-50 flex justify-end bg-black/40"
      @click.self="characterDrawerId = null"
    >
      <div class="h-full w-[560px] max-w-full border-l border-surface-4 bg-surface-0 shadow-2xl">
        <CharacterDetail :character-id="characterDrawerId" />
      </div>
    </div>
  </div>
</template>
