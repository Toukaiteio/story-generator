<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectStore } from '@/stores/project'
import { useUiStore } from '@/stores/ui'
import { useToast } from '@/composables/useToast'
import { Plus, FolderOpen, Upload } from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ProjectCard from '@/components/project/ProjectCard.vue'
import ProjectCreateDialog from '@/components/project/ProjectCreateDialog.vue'
import { buildProjectFileName, parseProjectFile, serializeProjectFile } from '@/services/projectFile'
import type { ProjectExportBinding } from '@/services/projectExportSync'

const router = useRouter()
const projectStore = useProjectStore()
const ui = useUiStore()
const toast = useToast()

const showCreateDialog = ref(false)
const showDeleteConfirm = ref(false)
const pendingDeleteId = ref<string | null>(null)
const importInputRef = ref<HTMLInputElement | null>(null)

onMounted(() => {
  ui.navigateTo('projects')
  projectStore.loadProjects()
})

async function handleCreate(data: any) {
  try {
    const project = await projectStore.createProject(data)
    toast.success(`Project "${project.name}" created`)
    router.push(`/workspace/${project.id}`)
  } catch (error: any) {
    toast.error(error?.message || 'Failed to create project')
  }
}

function handleOpen(id: string) {
  projectStore.setActiveProject(id)
  router.push(`/workspace/${id}`)
}

async function handleReveal(path: string) {
  if (!path) {
    toast.error('Project directory not found')
    return
  }
  
  if (window.electronAPI?.shell?.reveal) {
    const success = await window.electronAPI.shell.reveal(path)
    if (!success) {
      toast.error('Failed to reveal directory')
    }
  } else {
    toast.error('Reveal in Explorer is only available in the Electron desktop app')
  }
}

function getProjectExportBinding(projectId: string): ProjectExportBinding | null {
  return projectStore.getProjectExportBinding(projectId)
}

function handleDeleteRequest(id: string) {
  pendingDeleteId.value = id
  showDeleteConfirm.value = true
}

async function performDeleteProject(deleteFiles: boolean) {
  if (pendingDeleteId.value) {
    const project = projectStore.projects.find(p => p.id === pendingDeleteId.value)
    const deleted = await projectStore.deleteProject(pendingDeleteId.value, { deleteFiles })
    if (!deleted) {
      toast.error('Failed to delete project')
      return
    }
    toast.success(deleteFiles
      ? `${ui.text('Project and files deleted')}: "${project?.name}"`
      : `${ui.text('Project removed')}: "${project?.name}"`)
    pendingDeleteId.value = null
    showDeleteConfirm.value = false
  }
}

function handleDeleteCancel() {
  pendingDeleteId.value = null
  showDeleteConfirm.value = false
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function handleExportProjectFile(projectId: string) {
  const project = projectStore.projects.find(item => item.id === projectId)
  if (!project) return

  const filename = buildProjectFileName(project)
  const content = serializeProjectFile(project)

  const savedPath = await window.electronAPI?.dialog?.saveFile?.({
    defaultPath: filename,
    filters: [
      { name: 'Story Project File', extensions: ['json'] },
    ],
  })

  if (savedPath && window.electronAPI?.file?.write) {
    await window.electronAPI.file.write(savedPath, content)
    toast.success(`Exported "${project.name}"`)
    return
  }

  downloadTextFile(filename, content)
  toast.success(`Exported "${project.name}"`)
}

async function handleBindExportDirectory(projectId: string) {
  const project = projectStore.getProjectById(projectId)
  if (!project) return

  if (!window.electronAPI?.dialog?.openDirectory) {
    toast.error('Binding an export directory requires the Electron desktop app')
    return
  }

  const directoryPath = await window.electronAPI.dialog.openDirectory({
    title: `Select export directory for ${project.name}`,
  })

  if (!directoryPath) return

  try {
    const binding = projectStore.bindProjectExportDirectory(projectId, directoryPath)
    if (!binding) {
      toast.error('Failed to bind export directory')
      return
    }
    await projectStore.syncProjectExportNow(projectId)
    toast.success(`Export directory linked for "${project.name}"`)
  } catch (error: any) {
    toast.error(error?.message || 'Failed to bind export directory')
  }
}

async function handleSyncExport(projectId: string) {
  try {
    const binding = await projectStore.syncProjectExportNow(projectId)
    if (!binding) {
      toast.error('Export sync failed')
      return
    }
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
  let filePath: string | null = null
  let content: string | null = null

  if (window.electronAPI?.dialog?.openFile && window.electronAPI?.file?.read) {
    filePath = await window.electronAPI.dialog.openFile({
      filters: [
        { name: 'Story Project File', extensions: ['json'] },
      ],
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
    const existing = projectStore.projects.find(project =>
      (typeof raw?.id === 'string' && raw.id.trim() && project.id === raw.id.trim())
      || (
        typeof raw?.directoryPath === 'string'
        && raw.directoryPath.trim()
        && project.directoryPath.trim().replace(/[\\/]+$/, '').toLowerCase() === raw.directoryPath.trim().replace(/[\\/]+$/, '').toLowerCase()
      )
    )
    const project = await projectStore.importProject(raw)
    projectStore.setActiveProject(project.id)
    toast.success(existing ? `Project "${project.name}" already exists` : `Imported project "${project.name}"`)
    router.push(`/workspace/${project.id}`)
  } catch (error: any) {
    toast.error(error?.message || 'Import failed')
  }
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <div class="flex items-center justify-between px-6 py-4 border-b border-surface-4 shrink-0">
      <div>
        <h1 class="text-lg font-semibold text-text-primary">{{ ui.text('Story Projects') }}</h1>
        <p class="text-xs text-text-secondary mt-0.5">{{ projectStore.sortedProjects.length }} {{ ui.text('projects') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <BaseButton variant="secondary" size="sm" @click="openImportDialog">
          <Upload :size="14" />
          <span>{{ ui.text('Import Project') }}</span>
        </BaseButton>
        <BaseButton variant="primary" size="sm" @click="showCreateDialog = true">
          <Plus :size="14" />
          <span>{{ ui.text('New Project') }}</span>
        </BaseButton>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-6">
      <EmptyState
        v-if="!projectStore.sortedProjects.length && !projectStore.isLoading"
        :icon="FolderOpen"
        :title="ui.text('No projects yet')"
        :description="ui.text('Create your first story project to get started with AI-powered story generation.')"
      >
        <template #action>
          <BaseButton variant="primary" size="sm" @click="showCreateDialog = true">
            <Plus :size="14" />
            <span>{{ ui.text('Create Project') }}</span>
          </BaseButton>
        </template>
      </EmptyState>

      <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <TransitionGroup name="list">
          <ProjectCard
            v-for="project in projectStore.sortedProjects"
            :key="project.id"
            :project="project"
            :export-binding="getProjectExportBinding(project.id)"
            :is-export-syncing="projectStore.exportSyncingProjectIds.includes(project.id)"
            @open="handleOpen"
            @reveal="handleReveal"
            @bind-export-directory="handleBindExportDirectory"
            @sync-export="handleSyncExport"
            @unbind-export-directory="handleUnbindExportDirectory"
            @export="handleExportProjectFile"
            @delete="handleDeleteRequest"
          />
        </TransitionGroup>
      </div>
    </div>

    <ProjectCreateDialog v-model="showCreateDialog" @create="handleCreate" />

    <input
      ref="importInputRef"
      type="file"
      accept=".json,application/json"
      class="hidden"
      @change="handleImportProjectFile"
    />

    <BaseDialog
      v-model="showDeleteConfirm"
      title="Delete Project"
      width="520px"
      @close="handleDeleteCancel"
    >
      <div class="space-y-3 text-sm text-text-secondary">
        <p>
          {{ ui.text('Choose how to delete this project. Removing the project only will hide it from the project list but keep its local files on disk.') }}
        </p>
        <p v-if="pendingDeleteId" class="rounded-lg border border-surface-4 bg-surface-2 px-3 py-2 text-xs text-text-muted break-all">
          {{ projectStore.projects.find(project => project.id === pendingDeleteId)?.directoryPath || ui.text('Project files are not linked to a local folder.') }}
        </p>
      </div>

      <template #footer>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <BaseButton variant="ghost" size="sm" @click="handleDeleteCancel">
            {{ ui.text('Cancel') }}
          </BaseButton>
          <BaseButton variant="secondary" size="sm" @click="performDeleteProject(false)">
            {{ ui.text('Remove Project Only') }}
          </BaseButton>
          <BaseButton variant="danger" size="sm" @click="performDeleteProject(true)">
            {{ ui.text('Delete Project and Files') }}
          </BaseButton>
        </div>
      </template>
    </BaseDialog>
  </div>
</template>
