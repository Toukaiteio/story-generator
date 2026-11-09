<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-vue-next'
import StudioOutline from './StudioOutline.vue'
import StoryView from './StoryView.vue'
import BoardView from './BoardView.vue'
import ManuscriptView from './ManuscriptView.vue'
import ElementsView from './ElementsView.vue'
import CopilotDrawer from './CopilotDrawer.vue'
import PlanDiffCard from './PlanDiffCard.vue'
import StorySettingsDialog from './StorySettingsDialog.vue'
import { useStoryProject, useStudioActions, useStoryEngine, useWorkspaceUi } from '@/app'
import { useChapterReview } from '@/stores/chapterReview'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'
import type { ChapterPlanDraft } from '@/app'

const tr = translatePhrase

const projectStore = useStoryProject()
const actions = useStudioActions()
const engine = useStoryEngine()
const ui = useWorkspaceUi()
const reviewStore = useChapterReview()
const toast = useToast()

const outlineOpen = ref(true)
const copilotOpen = computed({
  get: () => ui.workspaceCopilotOpen,
  set: value => { ui.workspaceCopilotOpen = value },
})
const planDraft = ref<{ chapterId: string | null; draft: ChapterPlanDraft } | null>(null)
const planBusy = ref(false)

const busy = computed(() => engine.isGenerating)
const chapters = computed(() => projectStore.activeProject?.chapters ?? [])
const activeChapterId = computed(() => {
  const stored = ui.workspaceChapterId
  if (stored && chapters.value.some(item => item.id === stored)) return stored
  return chapters.value[0]?.id ?? null
})
const activeElementId = computed(() => ui.workspaceElementId)

watch(chapters, list => {
  if (!list.length) {
    ui.workspaceChapterId = null
    return
  }
  if (!ui.workspaceChapterId || !list.some(item => item.id === ui.workspaceChapterId)) {
    ui.workspaceChapterId = list[0].id
  }
}, { immediate: true })

function openChapter(id: string) {
  ui.workspaceChapterId = id
  ui.workspaceView = 'manuscript'
}

function openElement(id: string) {
  ui.workspaceElementId = id
  ui.workspaceCharacterId = null
  ui.workspaceView = 'elements'
}

function openCharacter(id: string) {
  ui.workspaceElementId = null
  ui.workspaceCharacterId = id
  ui.workspaceView = 'elements'
}

async function planExisting(chapterId: string) {
  if (busy.value || planBusy.value) return
  planBusy.value = true
  try {
    planDraft.value = { chapterId, draft: await actions.proposeChapterPlan({ chapterId }) }
  } catch (error: any) {
    toast.error(error?.message || 'Planning failed')
  } finally {
    planBusy.value = false
  }
}

async function planNext(afterChapterId?: string) {
  if (busy.value || planBusy.value) return
  planBusy.value = true
  try {
    planDraft.value = { chapterId: null, draft: await actions.proposeChapterPlan(afterChapterId ? { afterChapterId } : {}) }
  } catch (error: any) {
    toast.error(error?.message || 'Planning failed')
  } finally {
    planBusy.value = false
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
    toast.success('Chapter plan saved')
  } catch (error: any) {
    toast.error(error?.message || 'Failed to save plan')
  }
}

async function proofread(chapterId: string) {
  if (busy.value) return
  try {
    await actions.proofreadChapter(chapterId)
    toast.success('Proofreading finished')
    ui.workspaceChapterId = chapterId
    ui.workspaceView = 'manuscript'
  } catch (error: any) {
    toast.error(error?.message || 'Proofreading failed')
  }
}

async function polish(chapterId: string) {
  if (busy.value) return
  const chapter = chapters.value.find(item => item.id === chapterId)
  if (!chapter) return
  const before = chapter.content
  try {
    const polished = await actions.polishChapter(chapterId)
    const current = chapters.value.find(item => item.id === chapterId)?.content
    if (current !== before) {
      toast.info('Chapter changed while polishing; run it again')
      return
    }
    if (!polished.trim() || polished === before) {
      toast.info('Polish produced no changes')
      return
    }
    const changed = reviewStore.propose({
      chapterId,
      label: 'Polish',
      base: before,
      original: before,
      revised: polished,
      start: 0,
      end: before.length,
      inline: true,
    })
    if (!changed) {
      toast.info('Polish produced no changes')
      return
    }
    ui.workspaceChapterId = chapterId
    ui.workspaceView = 'manuscript'
  } catch (error: any) {
    toast.error(error?.message || 'Polishing failed')
  }
}

async function syncElements(chapterId: string) {
  if (busy.value) return
  try {
    const proposals = await actions.proposeElementStates(chapterId)
    if (!proposals.length) {
      toast.info('No element changes found in that chapter')
      return
    }
    await actions.applyElementProposals(proposals)
    toast.success(`Applied ${proposals.length} element updates`)
  } catch (error: any) {
    toast.error(error?.message || 'Element sync failed')
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && planDraft.value) planDraft.value = null
}

function runPendingCommand() {
  const command = ui.consumeCommand()
  if (!command) return
  if (command.name === 'plan-next') void planNext(activeChapterId.value ?? undefined)
  if (command.name === 'proofread' && activeChapterId.value) void proofread(activeChapterId.value)
  if (command.name === 'polish' && activeChapterId.value) void polish(activeChapterId.value)
  if (command.name === 'sync-elements' && activeChapterId.value) void syncElements(activeChapterId.value)
  if (command.name === 'story-settings') ui.storyConfigOpen = true
  if (command.name === 'view:board') ui.workspaceView = 'board'
  if (command.name === 'view:manuscript') ui.workspaceView = 'manuscript'
  if (command.name === 'view:story') ui.workspaceView = 'story'
  if (command.name === 'view:elements') ui.workspaceView = 'elements'
}

watch(() => ui.pendingCommand?.nonce, runPendingCommand, { immediate: true })

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  runPendingCommand()
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div v-if="projectStore.activeProject" class="flex h-full min-h-0 gap-2 p-2">
    <aside class="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-ios-lg bg-surface-2/60 transition-[width] duration-200" :class="outlineOpen ? 'w-[268px]' : 'w-[60px]'">
      <div class="flex items-center justify-between px-4 pt-2">
        <button class="app-icon-button" :aria-label="tr(outlineOpen ? 'Collapse outline' : 'Expand outline')" @click="outlineOpen = !outlineOpen">
          <PanelLeftClose v-if="outlineOpen" :size="18" />
          <PanelLeftOpen v-else :size="18" />
        </button>
      </div>
      <StudioOutline
        v-if="outlineOpen"
        class="min-h-0 flex-1"
        :chapters="chapters"
        :active-chapter-id="activeChapterId"
        :busy="planBusy"
        @open="openChapter"
        @plan="planExisting"
        @plan-next="planNext(activeChapterId ?? undefined)"
      />
    </aside>

    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-ios-lg bg-surface-1 shadow-ios-pill">
      <div class="min-h-0 flex-1 overflow-hidden">
        <BoardView
          v-show="ui.workspaceView === 'board'"
          :inert="ui.workspaceView !== 'board'"
          :chapters="chapters"
          :active-chapter-id="activeChapterId"
          :busy="busy || planBusy"
          @open="openChapter"
          @plan="planExisting"
          @plan-next="planNext(activeChapterId ?? undefined)"
          @proofread="proofread"
          @polish="polish"
          @sync-elements="syncElements"
          @switch-view="ui.workspaceView = $event"
        />
        <ManuscriptView
          v-if="ui.workspaceView === 'manuscript'"
          :chapter-id="activeChapterId"
          @open-element="openElement"
          @switch-view="ui.workspaceView = $event"
        />
        <StoryView
          v-show="ui.workspaceView === 'story'"
          :inert="ui.workspaceView !== 'story'"
          @open-chapter="openChapter"
          @open-character="openCharacter"
          @switch-view="ui.workspaceView = $event"
        />
        <ElementsView
          v-show="ui.workspaceView === 'elements'"
          :inert="ui.workspaceView !== 'elements'"
          :active-element-id="activeElementId"
          @open-element="openElement"
          @open-chapter="openChapter"
          @switch-view="ui.workspaceView = $event"
        />
      </div>
    </div>

    <CopilotDrawer
      :open="copilotOpen"
      :chapter-id="activeChapterId"
      @close="copilotOpen = false"
      @open-chapter="openChapter"
      @plan-next="planNext(activeChapterId ?? undefined)"
      @plan-draft="planDraft = { chapterId: $event.chapterId, draft: $event.draft }"
    />

    <StorySettingsDialog v-model="ui.storyConfigOpen" />

    <Transition name="slide-up">
      <div v-if="planDraft" class="fixed bottom-8 left-1/2 z-[90] w-[min(680px,calc(100vw-2rem))] -translate-x-1/2">
        <PlanDiffCard
          :draft="planDraft.draft"
          :existing="!!planDraft.chapterId"
          :busy="planBusy"
          @accept="acceptPlan"
          @discard="planDraft = null"
        />
      </div>
    </Transition>
  </div>
</template>
