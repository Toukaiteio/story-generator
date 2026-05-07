<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectStore } from '@/stores/project'
import { useUiStore } from '@/stores/ui'
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
import { PenTool, ArrowLeft } from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()
const ui = useUiStore()

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
</script>

<template>
  <div v-if="projectStore.activeProject" class="h-full flex flex-col overflow-hidden">
    <div class="shrink-0">
      <GenerationControls />
    </div>

    <div class="shrink-0 px-4">
      <StreamPreview />
    </div>

    <div class="flex-1 min-h-0 overflow-hidden">
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
    </div>
  </div>

  <div v-else class="h-full flex items-center justify-center">
    <EmptyState
      :icon="PenTool"
      title="No project selected"
      description="Select a project from the Projects page to start working."
    >
      <template #action>
        <BaseButton variant="secondary" size="sm" @click="router.push('/')">
          <ArrowLeft :size="14" />
          <span>Back to Projects</span>
        </BaseButton>
      </template>
    </EmptyState>
  </div>
</template>
