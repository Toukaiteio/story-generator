<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PenTool } from 'lucide-vue-next'
import { useStoryProject, useWorkspaceUi } from '@/app'
import StudioShell from '@/components/studio/StudioShell.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import BaseButton from '@/components/ui/BaseButton.vue'

const route = useRoute()
const router = useRouter()
const projectStore = useStoryProject()
const ui = useWorkspaceUi()

onMounted(async () => {
  ui.navigateTo('workspace')
  if (!projectStore.projects.length) {
    await projectStore.loadProjects()
  }
  const id = route.params.id as string
  if (id) {
    projectStore.setActiveProject(id)
  }
})
</script>

<template>
  <StudioShell v-if="projectStore.activeProject" />

  <div v-else class="flex h-full items-center justify-center">
    <EmptyState
      :icon="PenTool"
      :title="ui.text('No project selected')"
      :description="ui.text('Select a project from the Projects page to start working.')"
    >
      <template #action>
        <BaseButton variant="secondary" size="sm" @click="router.push('/')">
          {{ ui.text('Back to Projects') }}
        </BaseButton>
      </template>
    </EmptyState>
  </div>
</template>
