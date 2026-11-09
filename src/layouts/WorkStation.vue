<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useStoryProject, useWorkspaceUi } from '@/app'
import AppHeader from '@/components/layout/AppHeader.vue'
import CommandMenu from '@/components/layout/CommandMenu.vue'
import KnowledgeDrawer from '@/components/layout/KnowledgeDrawer.vue'
import StyleDrawer from '@/components/layout/StyleDrawer.vue'
import ModelDrawer from '@/components/layout/ModelDrawer.vue'
import SettingsDrawer from '@/components/layout/SettingsDrawer.vue'
import NewStoryDialog from '@/components/studio/NewStoryDialog.vue'
import ToastContainer from '@/components/ui/ToastContainer.vue'

const ui = useWorkspaceUi()
const projectStore = useStoryProject()
const route = useRoute()
const router = useRouter()

const projectId = computed(() => projectStore.activeProject?.id ?? (route.params.id as string) ?? '')

const drawer = computed(() => typeof route.query.drawer === 'string' ? route.query.drawer : '')

function applyDrawer(name: string) {
  if (name === 'knowledge' || name === 'styles' || name === 'models' || name === 'settings') {
    ui.openDrawer(name)
  }
}

onMounted(() => {
  void projectStore.loadProjects()
  applyDrawer(drawer.value)
})

watch(drawer, applyDrawer)

function openProject(id: string) {
  projectStore.setActiveProject(id)
  void router.push(`/workspace/${id}`)
}

function handleCreated(id: string) {
  openProject(id)
}

function launchToProjects() {
  void router.push('/')
}
</script>

<template>
  <div class="flex h-screen w-screen flex-col overflow-hidden bg-surface-0">
    <AppHeader
      :project-id="projectId"
      @open-project="openProject"
      @new-project="ui.commandMenu = 'new-project'"
      @open-home="launchToProjects"
    />

    <main class="min-h-0 flex-1 overflow-hidden">
      <router-view v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" />
        </Transition>
      </router-view>
    </main>

    <CommandMenu
      :project-id="projectStore.activeProject?.id ?? null"
      @open-project="openProject"
      @new-project="ui.commandMenu = 'new-project'"
    />

    <KnowledgeDrawer v-model="ui.knowledgeOpen" />
    <StyleDrawer v-model="ui.styleOpen" />
    <ModelDrawer v-model="ui.modelsOpen" />
    <SettingsDrawer v-model="ui.settingsOpen" />
    <NewStoryDialog
      :model-value="ui.commandMenu === 'new-project'"
      @update:model-value="ui.commandMenu = $event ? 'new-project' : null"
      @created="handleCreated"
    />

    <ToastContainer />
  </div>
</template>
