<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectStore } from '@/stores/project'
import { useUiStore } from '@/stores/ui'
import { buildUnsavedChapterLocations, type UnsavedChapterLocation } from '@/services/unsaved'
import PanelGroup from '@/components/layout/PanelGroup.vue'
import WorkspaceSidebar from '@/components/workspace/WorkspaceSidebar.vue'
import StoryConfigPanel from '@/components/workspace/StoryConfigPanel.vue'
import GenerationStudio from '@/components/workspace/GenerationStudio.vue'
import OutlinePanel from '@/components/workspace/OutlinePanel.vue'
import ChapterEditor from '@/components/workspace/ChapterEditor.vue'
import CharacterDetail from '@/components/character/CharacterDetail.vue'
import StoryPreviewPanel from '@/components/workspace/StoryPreviewPanel.vue'
import GenerationControls from '@/components/workspace/GenerationControls.vue'
import KnowledgeBaseSidebar from '@/components/workspace/KnowledgeBaseSidebar.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import { PenTool, ArrowLeft, AlertTriangle, LocateFixed } from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()
const ui = useUiStore()
const showUnsavedCloseDialog = ref(false)
let removeCloseRequestListener: (() => void) | null = null
const generationStudioRef = ref<InstanceType<typeof GenerationStudio> | null>(null)
const storyConfigPanelRef = ref<InstanceType<typeof StoryConfigPanel> | null>(null)
const outlinePanelRef = ref<InstanceType<typeof OutlinePanel> | null>(null)
const characterDetailRef = ref<InstanceType<typeof CharacterDetail> | null>(null)
const chapterEditorRefs = ref<Record<string, InstanceType<typeof ChapterEditor> | null>>({})

const unsavedScan = computed(() =>
  buildUnsavedChapterLocations(projectStore.projects, ui.unsavedWorkspaceNodes, ui.chapterEditorDrafts)
)
const unsavedEntries = computed(() => unsavedScan.value.entries)
const staleUnsavedChapterIds = computed(() => unsavedScan.value.staleChapterIds)
const hasUnsavedWorkspaceFlags = computed(() =>
  Object.values(ui.unsavedWorkspaceNodes).some(Boolean)
)
const hasUnsavedWork = computed(() => unsavedEntries.value.length > 0 || hasUnsavedWorkspaceFlags.value)

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasUnsavedWork.value) return
  event.preventDefault()
  event.returnValue = ''
}

function formatUnsavedLocation(entry: UnsavedChapterLocation) {
  const chapterLabel = `${ui.text('Ch')} ${entry.chapterIndex + 1}`
  const chapterTitle = entry.chapterTitle || ui.text('Untitled')
  return `${entry.projectName} / ${chapterLabel}: ${chapterTitle}`
}

async function locateUnsavedEntry(entry: UnsavedChapterLocation) {
  showUnsavedCloseDialog.value = false
  if (route.params.id !== entry.projectId) {
    await router.push({ name: 'Workspace', params: { id: entry.projectId } })
  }
  projectStore.setActiveProject(entry.projectId)
  ui.setWorkspaceNode(entry.workspaceNode)
}

async function locateFirstUnsavedEntry() {
  const first = unsavedEntries.value[0]
  if (!first) return
  await locateUnsavedEntry(first)
}

function discardUnsavedAndClose() {
  showUnsavedCloseDialog.value = false
  window.electronAPI?.window?.confirmCloseHandled?.('discard')
}

async function handleGlobalSaveShortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
  event.preventDefault()
  if (activeView.value === 'generation') {
    await generationStudioRef.value?.saveFromShortcut?.()
    return
  }
  if (activeView.value === 'config') {
    await storyConfigPanelRef.value?.saveFromShortcut?.()
    return
  }
  if (activeView.value === 'outline') {
    await outlinePanelRef.value?.saveFromShortcut?.()
    return
  }
  if (activeView.value === 'character') {
    await characterDetailRef.value?.saveFromShortcut?.()
    return
  }
  if (activeView.value === 'chapter' && activeChapterId.value) {
    await chapterEditorRefs.value[activeChapterId.value]?.saveFromShortcut?.()
  }
}

function setChapterEditorRef(chapterId: string, instance: InstanceType<typeof ChapterEditor> | null) {
  chapterEditorRefs.value = {
    ...chapterEditorRefs.value,
    [chapterId]: instance,
  }
}

onMounted(async () => {
  ui.navigateTo('workspace')
  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('keydown', handleGlobalSaveShortcut)
  removeCloseRequestListener = window.electronAPI?.window?.onCloseRequested?.(() => {
    if (!hasUnsavedWork.value) {
      window.electronAPI?.window?.confirmCloseHandled?.('discard')
      return
    }
    showUnsavedCloseDialog.value = true
  }) ?? null
  // Ensure projects are loaded before setting active project
  if (projectStore.projects.length === 0) {
    await projectStore.loadProjects()
  }
  const id = route.params.id as string
  if (id) {
    projectStore.setActiveProject(id)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('keydown', handleGlobalSaveShortcut)
  removeCloseRequestListener?.()
  removeCloseRequestListener = null
})

watch(staleUnsavedChapterIds, chapterIds => {
  for (const chapterId of chapterIds) {
    ui.clearChapterEditorDraft(chapterId)
    ui.setWorkspaceNodeUnsaved(`chapter-${chapterId}`, false)
  }
}, { immediate: true })

watch(hasUnsavedWork, hasUnsaved => {
  window.electronAPI?.window?.setUnsavedChanges?.({
    hasUnsavedChanges: hasUnsaved,
    entries: unsavedEntries.value,
  })
}, { immediate: true })

watch(() => route.params.id, (id) => {
  if (id) projectStore.setActiveProject(id as string)
})

const activeNode = computed(() => ui.activeWorkspaceNode)

const activeChapterId = computed(() => {
  if (!activeNode.value?.startsWith('chapter-')) return null
  return activeNode.value.replace('chapter-', '')
})

const openedChapterIds = ref<string[]>([])

watch(activeChapterId, chapterId => {
  if (!chapterId || openedChapterIds.value.includes(chapterId)) return
  openedChapterIds.value = [...openedChapterIds.value, chapterId]
}, { immediate: true })

watch(() => projectStore.activeProject?.id, () => {
  openedChapterIds.value = activeChapterId.value ? [activeChapterId.value] : []
  chapterEditorRefs.value = {}
})

const activeCharacterId = computed(() => {
  if (!activeNode.value?.startsWith('character-')) return null
  return activeNode.value.replace('character-', '')
})

const activeView = computed(() => {
  if (!activeNode.value) return 'config'
  if (activeNode.value === 'config') return 'config'
  if (activeNode.value.startsWith('generation-')) return 'generation'
  if (activeNode.value === 'outline') return 'outline'
  if (activeNode.value.startsWith('chapter-')) return 'chapter'
  if (activeNode.value.startsWith('character-')) return 'character'
  if (activeNode.value === 'preview') return 'preview'
  return 'config'
})

</script>

<template>
  <div v-if="projectStore.activeProject" class="h-full flex flex-col overflow-hidden">
    <Transition name="controls-collapse">
      <div v-if="activeView !== 'chapter' && activeView !== 'generation'" class="shrink-0 overflow-hidden">
        <GenerationControls />
      </div>
    </Transition>

    <div class="relative flex-1 min-h-0 overflow-hidden">
      <PanelGroup direction="horizontal">
        <template #first>
          <WorkspaceSidebar />
        </template>
        <template #second>
          <div class="h-full min-h-0 overflow-hidden">
            <!-- Config view with Knowledge Base sidebar -->
            <template v-if="activeView === 'config'">
              <PanelGroup direction="horizontal" :initial-size="350" :min-size="280" :max-size="450" limit-second>
                <template #first>
                  <StoryConfigPanel ref="storyConfigPanelRef" />
                </template>
                <template #second>
                  <KnowledgeBaseSidebar />
                </template>
              </PanelGroup>
            </template>
            
            <!-- Other views -->
            <GenerationStudio v-if="activeView === 'generation'" ref="generationStudioRef" />
            <OutlinePanel v-else-if="activeView === 'outline'" ref="outlinePanelRef" />
            <CharacterDetail
              v-else-if="activeView === 'character' && activeCharacterId"
              ref="characterDetailRef"
              :character-id="activeCharacterId"
            />
            <StoryPreviewPanel v-else-if="activeView === 'preview'" />
            <StoryConfigPanel v-else-if="activeView !== 'chapter' && activeView !== 'config'" ref="storyConfigPanelRef" />

            <ChapterEditor
              v-for="chapterId in openedChapterIds"
              v-show="activeView === 'chapter' && activeChapterId === chapterId"
              :key="chapterId"
              :ref="(instance) => setChapterEditorRef(chapterId, instance as InstanceType<typeof ChapterEditor> | null)"
              :chapter-id="chapterId"
              :active="activeView === 'chapter' && activeChapterId === chapterId"
            />
          </div>
        </template>
      </PanelGroup>

    </div>

    <BaseDialog v-model="showUnsavedCloseDialog" :title="ui.text('Unsaved changes')" width="620px">
      <div class="space-y-4">
        <div class="flex gap-3 rounded-lg border border-warning/20 bg-warning/8 px-4 py-3">
          <AlertTriangle :size="18" class="mt-0.5 shrink-0 text-warning" />
          <div class="space-y-1">
            <p class="text-sm font-medium text-text-primary">{{ ui.text('You have unsaved changes.') }}</p>
            <p class="text-sm leading-relaxed text-text-secondary">{{ ui.text('Review the locations below before closing. You can jump to an unsaved location or close the app without saving those changes.') }}</p>
          </div>
        </div>

        <div v-if="unsavedEntries.length" class="space-y-2">
          <p class="text-xs font-semibold uppercase tracking-wider text-text-muted">{{ ui.text('Unsaved locations') }}</p>
          <button
            v-for="entry in unsavedEntries"
            :key="`${entry.projectId}:${entry.chapterId}`"
            class="flex w-full items-center justify-between gap-3 rounded-lg border border-surface-4 bg-surface-2 px-4 py-3 text-left transition-colors hover:border-accent/30 hover:bg-surface-3"
            @click="locateUnsavedEntry(entry)"
          >
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-text-primary">{{ formatUnsavedLocation(entry) }}</p>
              <p class="mt-1 text-xs text-text-secondary">
                {{ entry.hasDraftSnapshot ? ui.text('Draft snapshot cached locally and not saved to the project yet.') : ui.text('This chapter is still marked as unsaved.') }}
              </p>
            </div>
            <span class="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-1 text-xs font-semibold text-accent">
              <LocateFixed :size="12" />
              {{ ui.text('Locate') }}
            </span>
          </button>
        </div>

        <div v-else class="rounded-lg border border-surface-4 bg-surface-2 px-4 py-3 text-sm text-text-secondary">
          {{ ui.text('The current workspace has unsaved changes.') }}
        </div>
      </div>

      <template #footer>
        <div class="flex items-center justify-end gap-2">
          <BaseButton variant="ghost" size="sm" @click="showUnsavedCloseDialog = false">
            {{ ui.text('Cancel') }}
          </BaseButton>
          <BaseButton variant="secondary" size="sm" @click="locateFirstUnsavedEntry">
            <LocateFixed :size="14" />
            <span>{{ ui.text('Locate First Unsaved') }}</span>
          </BaseButton>
          <BaseButton variant="danger" size="sm" @click="discardUnsavedAndClose">
            {{ ui.text('Close Without Saving') }}
          </BaseButton>
        </div>
      </template>
    </BaseDialog>
  </div>

  <div v-else class="h-full flex items-center justify-center">
    <EmptyState
      :icon="PenTool"
      :title="ui.text('No project selected')"
      :description="ui.text('Select a project from the Projects page to start working.')"
    >
      <template #action>
        <BaseButton variant="secondary" size="sm" @click="router.push('/')">
          <ArrowLeft :size="14" />
          <span>{{ ui.text('Back to Projects') }}</span>
        </BaseButton>
      </template>
    </EmptyState>
  </div>
</template>

<style scoped>
.controls-collapse-enter-active,
.controls-collapse-leave-active {
  max-height: 72px;
  opacity: 1;
  transition: max-height 0.22s ease, opacity 0.18s ease;
}

.controls-collapse-enter-from,
.controls-collapse-leave-to {
  max-height: 0;
  opacity: 0;
}
</style>
