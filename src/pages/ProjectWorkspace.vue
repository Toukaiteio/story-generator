<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectStore } from '@/stores/project'
import { useUiStore } from '@/stores/ui'
import { useGenerationStore } from '@/stores/generation'
import PanelGroup from '@/components/layout/PanelGroup.vue'
import WorkspaceSidebar from '@/components/workspace/WorkspaceSidebar.vue'
import StoryConfigPanel from '@/components/workspace/StoryConfigPanel.vue'
import GenerationStudio from '@/components/workspace/GenerationStudio.vue'
import OutlinePanel from '@/components/workspace/OutlinePanel.vue'
import ChapterEditor from '@/components/workspace/ChapterEditor.vue'
import CharacterDetail from '@/components/character/CharacterDetail.vue'
import StoryPreviewPanel from '@/components/workspace/StoryPreviewPanel.vue'
import GenerationControls from '@/components/workspace/GenerationControls.vue'
import StreamPreview from '@/components/workspace/StreamPreview.vue'
import KnowledgeBaseSidebar from '@/components/workspace/KnowledgeBaseSidebar.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { PenTool, ArrowLeft, Lock, Loader2 } from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()
const ui = useUiStore()
const genStore = useGenerationStore()
const workspaceNodeBeforeFollowing = ref<string | null>(null)

onMounted(async () => {
  ui.navigateTo('workspace')
  // Ensure projects are loaded before setting active project
  if (projectStore.projects.length === 0) {
    await projectStore.loadProjects()
  }
  const id = route.params.id as string
  if (id) {
    projectStore.setActiveProject(id)
  }
})

watch(() => route.params.id, (id) => {
  if (id) projectStore.setActiveProject(id as string)
})

const activeNode = computed(() => ui.activeWorkspaceNode)

const activeChapterId = computed(() => {
  if (!activeNode.value?.startsWith('chapter-')) return null
  return activeNode.value.replace('chapter-', '')
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

const followingNode = computed(() => {
  const project = projectStore.activeProject
  if (!project || !genStore.isFollowingMode) return null

  if (
    (genStore.currentStage === 'writing' ||
      genStore.currentStage === 'proofreading' ||
      genStore.currentStage === 'polishing') &&
    genStore.currentChapterIndex != null
  ) {
    const chapter = project.chapters[genStore.currentChapterIndex]
    return chapter ? `chapter-${chapter.id}` : `generation-${genStore.currentStage}`
  }

  if (genStore.currentStage === 'planning' || genStore.currentStage === 'chapter-outline') {
    return `generation-${genStore.currentStage}`
  }

  return null
})

watch(followingNode, (node) => {
  if (node && ui.activeWorkspaceNode !== node) {
    ui.setWorkspaceNode(node)
  }
}, { immediate: true })

watch(() => genStore.isFollowingMode, (isFollowing, wasFollowing) => {
  if (isFollowing) {
    workspaceNodeBeforeFollowing.value = ui.activeWorkspaceNode
    return
  }

  if (wasFollowing && workspaceNodeBeforeFollowing.value) {
    ui.setWorkspaceNode(workspaceNodeBeforeFollowing.value)
    workspaceNodeBeforeFollowing.value = null
  }
})
</script>

<template>
  <div v-if="projectStore.activeProject" class="h-full flex flex-col overflow-hidden">
    <Transition name="controls-collapse">
      <div v-if="activeView !== 'chapter'" class="shrink-0 overflow-hidden">
        <GenerationControls />
      </div>
    </Transition>

    <div class="shrink-0 px-4">
      <StreamPreview />
    </div>

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
                  <StoryConfigPanel />
                </template>
                <template #second>
                  <KnowledgeBaseSidebar />
                </template>
              </PanelGroup>
            </template>
            
            <!-- Other views -->
            <GenerationStudio v-else-if="activeView === 'generation'" />
            <OutlinePanel v-else-if="activeView === 'outline'" />
            <ChapterEditor
              v-else-if="activeView === 'chapter' && activeChapterId"
              :chapter-id="activeChapterId"
            />
            <CharacterDetail
              v-else-if="activeView === 'character' && activeCharacterId"
              :character-id="activeCharacterId"
            />
            <StoryPreviewPanel v-else-if="activeView === 'preview'" />
            <StoryConfigPanel v-else />
          </div>
        </template>
      </PanelGroup>

      <div
        v-if="genStore.isFollowingMode"
        class="absolute inset-0 z-40 flex items-start justify-center bg-surface-0/15 backdrop-blur-[1px] pointer-events-auto"
      >
        <div class="mt-4 flex items-center gap-2 rounded-md border border-surface-4 bg-surface-1/95 px-3 py-2 text-xs text-text-secondary shadow-lg">
          <Lock :size="13" class="text-warning" />
          <span class="font-medium text-text-primary">{{ ui.text('Following Generate All') }}</span>
          <span>{{ ui.text(genStore.progressMessage || 'Workflow is running...') }}</span>
          <Loader2 :size="13" class="animate-spin text-accent" />
        </div>
      </div>
    </div>
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
