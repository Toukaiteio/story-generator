<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { translatePhrase } from '@/i18n'
import { useUiStore } from '@/stores/ui'
import { useToast } from '@/composables/useToast'
import { Plus, FolderOpen, Upload } from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseDropdown from '@/components/ui/BaseDropdown.vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ProjectCard from '@/components/project/ProjectCard.vue'
import NewStoryDialog from '@/components/studio/NewStoryDialog.vue'
import { useStoryProject, parseProjectFile, type ExportFormat, type ProjectExportBinding } from '@/app'
import { useProjectExport } from '@/composables/useProjectExport'

const router = useRouter()
const projectStore = useStoryProject()
const ui = useUiStore()
const toast = useToast()
const { exportFormat, exportProjectFile } = useProjectExport()
const tr = translatePhrase

type ProjectSort = 'recent' | 'name' | 'chapters'
const sortOrder = ref<ProjectSort>('recent')

const sortedProjects = computed(() => {
  const list = [...projectStore.sortedProjects]
  if (sortOrder.value === 'name') {
    return list.sort((a, b) => a.name.localeCompare(b.name, document.documentElement.lang || 'zh-CN'))
  }
  if (sortOrder.value === 'chapters') {
    return list.sort((a, b) => b.chapters.length - a.chapters.length)
  }
  return list
})

const overflowItems = computed(() => [
  { heading: 'Sort by' },
  { label: 'Recent', checked: sortOrder.value === 'recent', action: () => { sortOrder.value = 'recent' } },
  { label: 'Name', checked: sortOrder.value === 'name', action: () => { sortOrder.value = 'name' } },
  { label: 'Chapters', checked: sortOrder.value === 'chapters', action: () => { sortOrder.value = 'chapters' } },
  { divider: true },
  { label: 'Import', icon: Upload, action: openImportDialog },
])

const showCreateDialog = ref(false)
const showDeleteConfirm = ref(false)
const pendingDeleteId = ref<string | null>(null)
const importInputRef = ref<HTMLInputElement | null>(null)

onMounted(() => {
  ui.navigateTo('projects')
  void projectStore.loadProjects()
})

function handleCreated(projectId: string) {
  handleOpen(projectId)
}

function handleOpen(id: string) {
  projectStore.setActiveProject(id)
  void router.push(`/workspace/${id}`)
}

async function handleReveal(path: string) {
  if (!path) {
    toast.error('Project directory not found')
    return
  }
  const revealed = await window.electronAPI?.shell?.reveal(path)
  if (!revealed) toast.error('Failed to reveal directory')
}

function getProjectExportBinding(projectId: string): ProjectExportBinding | null {
  return projectStore.getProjectExportBinding(projectId)
}

async function handleRemove(id: string) {
  const project = projectStore.projects.find(item => item.id === id)
  const removed = await projectStore.deleteProject(id, { deleteFiles: false })
  if (!removed) {
    toast.error('Failed to remove project')
    return
  }
  toast.success(`Removed "${project?.name}" from the library`)
}

async function handleExportFormat(id: string, format: ExportFormat) {
  const project = projectStore.getProjectById(id)
  if (!project) return
  try {
    await exportFormat(project, format)
  } catch (error: any) {
    toast.error(error?.message || 'Export failed')
  }
}

async function handleExportProjectFile(id: string) {
  const project = projectStore.getProjectById(id)
  if (!project) return
  try {
    await exportProjectFile(project)
  } catch (error: any) {
    toast.error(error?.message || 'Export failed')
  }
}

function handleDeleteRequest(id: string) {
  pendingDeleteId.value = id
  showDeleteConfirm.value = true
}

async function performDeleteProject(deleteFiles: boolean) {
  if (!pendingDeleteId.value) return
  const project = projectStore.projects.find(item => item.id === pendingDeleteId.value)
  const deleted = await projectStore.deleteProject(pendingDeleteId.value, { deleteFiles })
  if (!deleted) {
    toast.error('Failed to delete project')
    return
  }
  toast.success(deleteFiles ? `Deleted "${project?.name}" and its files` : `Removed "${project?.name}"`)
  pendingDeleteId.value = null
  showDeleteConfirm.value = false
}

function handleDeleteCancel() {
  pendingDeleteId.value = null
  showDeleteConfirm.value = false
}

async function handleBindExportDirectory(projectId: string) {
  const project = projectStore.getProjectById(projectId)
  if (!project) return
  if (!window.electronAPI?.dialog?.openDirectory) {
    toast.error('Binding an export directory requires the desktop app')
    return
  }
  const directoryPath = await window.electronAPI.dialog.openDirectory({ title: `Export directory for ${project.name}` })
  if (!directoryPath) return
  try {
    const binding = projectStore.bindProjectExportDirectory(projectId, directoryPath)
    if (!binding) throw new Error('Failed to bind export directory')
    await projectStore.syncProjectExportNow(projectId)
    toast.success('Export directory linked')
  } catch (error: any) {
    toast.error(error?.message || 'Failed to bind export directory')
  }
}

async function handleSyncExport(projectId: string) {
  try {
    const binding = await projectStore.syncProjectExportNow(projectId)
    if (!binding) throw new Error('Export sync failed')
    toast.success('Export directory synced')
  } catch (error: any) {
    toast.error(error?.message || 'Export sync failed')
  }
}

function handleUnbindExportDirectory(projectId: string) {
  projectStore.unbindProjectExportDirectory(projectId)
  toast.success('Export directory unbound')
}

function openImportDialog() {
  if (window.electronAPI?.dialog?.openFile) {
    void handleImportProjectFile()
    return
  }
  importInputRef.value?.click()
}

async function handleImportProjectFile() {
  let content: string | null = null

  if (window.electronAPI?.dialog?.openFile && window.electronAPI?.file?.read) {
    const filePath = await window.electronAPI.dialog.openFile({
      filters: [{ name: 'Story project', extensions: ['json'] }],
    })
    if (!filePath) return
    content = await window.electronAPI.file.read(filePath)
  }

  if (!content) {
    const input = importInputRef.value
    const file = input?.files?.[0]
    if (!file) return
    content = await file.text()
    if (input) input.value = ''
  }

  if (!content) {
    toast.error('Unable to read project file')
    return
  }

  try {
    const raw = parseProjectFile(content)
    const project = await projectStore.importProject(raw)
    projectStore.setActiveProject(project.id)
    toast.success(`Imported "${project.name}"`)
    handleOpen(project.id)
  } catch (error: any) {
    toast.error(error?.message || 'Import failed')
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-surface-0">
    <header class="studio-row flex h-12 shrink-0 items-center gap-2 px-4">
      <h1 class="app-toolbar-title truncate">{{ ui.text('Story projects') }}</h1>
      <span class="text-meta text-text-muted">{{ projectStore.sortedProjects.length }}</span>
      <div class="ml-auto flex items-center gap-2">
        <BaseDropdown :items="overflowItems" :width="200">
          <template #trigger>
            <div class="capsule h-9 w-9 px-0" :aria-label="ui.text('More actions')">
              <span class="text-body leading-none">⋯</span>
            </div>
          </template>
        </BaseDropdown>
        <button class="app-key-action h-9 gap-1.5 px-3.5 text-caption" @click="showCreateDialog = true">
          <Plus :size="15" />
          <span>{{ ui.text('New story') }}</span>
        </button>
      </div>
    </header>

    <div class="app-content min-h-0 flex-1">
      <EmptyState
        v-if="!sortedProjects.length && !projectStore.isLoading"
        :icon="FolderOpen"
        :title="ui.text('No projects yet')"
        :description="ui.text('Describe the story you want to write and let the copilot draft the blueprint.')"
      >
        <template #action>
          <button class="app-key-action h-9 gap-1.5 px-3.5 text-caption" @click="showCreateDialog = true">
            <Plus :size="15" />
            <span>{{ ui.text('New story') }}</span>
          </button>
        </template>
      </EmptyState>

      <div v-else class="mx-auto grid max-w-[1600px] grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        <TransitionGroup name="list">
          <ProjectCard
            v-for="project in sortedProjects"
            :key="project.id"
            :project="project"
            :export-binding="getProjectExportBinding(project.id)"
            :is-export-syncing="projectStore.exportSyncingProjectIds.includes(project.id)"
            @open="handleOpen"
            @reveal="handleReveal"
            @bind-export-directory="handleBindExportDirectory"
            @sync-export="handleSyncExport"
            @unbind-export-directory="handleUnbindExportDirectory"
            @remove="handleRemove"
            @export-format="handleExportFormat"
            @export-project-file="handleExportProjectFile"
            @delete="handleDeleteRequest"
          />
        </TransitionGroup>
      </div>
    </div>

    <NewStoryDialog v-model="showCreateDialog" @created="handleCreated" />

    <input
      ref="importInputRef"
      type="file"
      accept=".json,application/json"
      class="hidden"
      @change="handleImportProjectFile"
    >

    <BaseDialog
      v-model="showDeleteConfirm"
      title="Delete project"
      width="480px"
      @close="handleDeleteCancel"
    >
      <div class="space-y-3 text-caption text-text-secondary">
        <p>{{ ui.text('Removing a project keeps its files on disk. Deleting it also removes the project folder.') }}</p>
        <p v-if="pendingDeleteId" class="break-all rounded-ios bg-surface-2 px-4 py-2.5 text-meta text-text-muted">
          {{ projectStore.projects.find(project => project.id === pendingDeleteId)?.directoryPath || ui.text('This project has no linked folder.') }}
        </p>
      </div>

      <template #footer>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <BaseButton variant="ghost" size="sm" @click="handleDeleteCancel">
            {{ ui.text('Cancel') }}
          </BaseButton>
          <BaseButton variant="secondary" size="sm" @click="performDeleteProject(false)">
            {{ ui.text('Remove project') }}
          </BaseButton>
          <BaseButton variant="danger" size="sm" @click="performDeleteProject(true)">
            {{ ui.text('Delete project and files') }}
          </BaseButton>
        </div>
      </template>
    </BaseDialog>
  </div>
</template>
