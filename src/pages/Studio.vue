<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FolderOpen } from 'lucide-vue-next'
import { useStoryProject, useWorkspaceUi } from '@/app'
import StudioShell from '@/components/studio/StudioShell.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { translatePhrase } from '@/i18n'

const tr = translatePhrase
const route = useRoute()
const router = useRouter()
const projectStore = useStoryProject()
const ui = useWorkspaceUi()

onMounted(async () => {
  ui.navigateTo('workspace')
  if (!projectStore.projects.length) await projectStore.loadProjects()
  const id = route.params.id as string | undefined
  if (id) projectStore.setActiveProject(id)

  const view = route.query.view
  if (view === 'story' || view === 'board' || view === 'manuscript' || view === 'elements') {
    ui.workspaceView = view
  }
  const chapter = route.query.chapter
  if (typeof chapter === 'string' && chapter) ui.workspaceChapterId = chapter
  const element = route.query.element
  if (typeof element === 'string' && element) ui.workspaceElementId = element
})
</script>

<template>
  <StudioShell v-if="projectStore.activeProject" />

  <div v-else class="flex h-full items-center justify-center">
    <EmptyState
      :icon="FolderOpen"
      :title="tr('Open a project')"
      :description="tr('Pick a project from the library to start writing.')"
    >
      <template #action>
        <BaseButton variant="primary" size="sm" @click="router.push('/')">
          {{ tr('All projects') }}
        </BaseButton>
      </template>
    </EmptyState>
  </div>
</template>
