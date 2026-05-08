import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { generateId } from '@/lib/id'
import { readJsonStorage, writeJsonStorage } from '@/lib/storage'
import {
  buildBoundProjectFileName,
  buildBoundProjectFilePath,
  readProjectExportBindings,
  readProjectExportBuffers,
  serializeProjectExport,
  writeProjectExportBindings,
  writeProjectExportBuffers,
  type ProjectExportBinding,
  type ProjectExportBuffer,
  PROJECT_EXPORT_SYNC_DELAY_MS,
} from '@/services/projectExportSync'
import type { StoryProject, StoryLength } from '@/types/project'

const PROJECT_STORAGE_KEY = 'story-generator.projects.v1'
const ACTIVE_PROJECT_STORAGE_KEY = 'story-generator.active-project.v1'

function migrateProjectStyle(project: any): StoryProject {
  if (!('styleId' in project)) {
    project.styleId = 'default'
    project.style = ''
  }
  if (!('language' in project) || typeof project.language !== 'string' || !project.language.trim()) {
    project.language = 'English'
  }
  if (!Array.isArray(project.knowledgeBaseIds)) {
    project.knowledgeBaseIds = []
  }
  if (!Array.isArray(project.relationshipEvents)) {
    project.relationshipEvents = []
  }
  return project as StoryProject
}

function migrateProjects(raw: any[]): StoryProject[] {
  return raw.map(p => migrateProjectStyle(p))
}

function normalizeStringList(value: any): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item).trim()).filter(Boolean)
    : []
}

function normalizeIdList(value: any): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item).trim()).filter(Boolean)
    : []
}

function normalizeImportedProject(data: any): StoryProject {
  const now = new Date().toISOString()
  const migrated = migrateProjectStyle(data ?? {})

  return {
    id: generateId(),
    name: typeof migrated.name === 'string' && migrated.name.trim() ? migrated.name.trim() : 'Imported Project',
    directoryPath: typeof migrated.directoryPath === 'string' ? migrated.directoryPath : '',
    theme: typeof migrated.theme === 'string' ? migrated.theme : '',
    genre: typeof migrated.genre === 'string' ? migrated.genre : '',
    targetReader: typeof migrated.targetReader === 'string' ? migrated.targetReader : '',
    language: typeof migrated.language === 'string' && migrated.language.trim() ? migrated.language.trim() : 'English',
    style: typeof migrated.style === 'string' ? migrated.style : '',
    styleId: typeof migrated.styleId === 'string' && migrated.styleId.trim() ? migrated.styleId : 'default',
    writingFormat: migrated.writingFormat === 'markdown' ? 'markdown' : 'plaintext',
    length: migrated.length === 'short' || migrated.length === 'medium' || migrated.length === 'long'
      ? migrated.length
      : 'medium',
    constraints: {
      required: normalizeStringList(migrated.constraints?.required),
      forbidden: normalizeStringList(migrated.constraints?.forbidden),
    },
    customRequirements: typeof migrated.customRequirements === 'string' ? migrated.customRequirements : '',
    chapters: Array.isArray(migrated.chapters) ? migrated.chapters : [],
    characters: Array.isArray(migrated.characters) ? migrated.characters : [],
    relationshipEvents: Array.isArray(migrated.relationshipEvents) ? migrated.relationshipEvents : [],
    knowledgeBaseIds: normalizeIdList(migrated.knowledgeBaseIds),
    status: migrated.status === 'generating' || migrated.status === 'completed' || migrated.status === 'error'
      ? migrated.status
      : 'draft',
    generationStage: migrated.generationStage || 'idle',
    outline: typeof migrated.outline === 'string' ? migrated.outline : '',
    summary: typeof migrated.summary === 'string' ? migrated.summary : '',
    createdAt: typeof migrated.createdAt === 'string' ? migrated.createdAt : now,
    updatedAt: now,
  }
}

export const useProjectStore = defineStore('project', () => {
  const projects = ref<StoryProject[]>(migrateProjects(readJsonStorage<any[]>(PROJECT_STORAGE_KEY, [])))
  const activeProjectId = ref<string | null>(readJsonStorage<string | null>(ACTIVE_PROJECT_STORAGE_KEY, null))
  const isLoading = ref(false)
  const exportBindings = ref<Record<string, ProjectExportBinding>>(readProjectExportBindings())
  const exportBuffers = ref<Record<string, ProjectExportBuffer>>(readProjectExportBuffers())
  const exportSyncingProjectIds = ref<string[]>([])
  const exportSyncTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const projectSaveQueues = new Map<string, Promise<StoryProject | null>>()

  const activeProject = computed(() =>
    projects.value.find(p => p.id === activeProjectId.value) ?? null
  )

  const sortedProjects = computed(() =>
    [...projects.value].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  )

  function persistLocalCache() {
    writeJsonStorage(PROJECT_STORAGE_KEY, projects.value)
    writeJsonStorage(ACTIVE_PROJECT_STORAGE_KEY, activeProjectId.value)
  }

  function persistExportBindings() {
    writeProjectExportBindings(exportBindings.value)
  }

  function persistExportBuffers() {
    writeProjectExportBuffers(exportBuffers.value)
  }

  function reconcileActiveProject() {
    if (activeProjectId.value && !projects.value.some(project => project.id === activeProjectId.value)) {
      activeProjectId.value = null
    }
  }

  function getProjectById(id: string) {
    return projects.value.find(project => project.id === id) ?? null
  }

  function cloneProjectSnapshot(project: StoryProject): StoryProject {
    try {
      return typeof structuredClone === 'function'
        ? structuredClone(project)
        : JSON.parse(JSON.stringify(project)) as StoryProject
    } catch {
      return JSON.parse(JSON.stringify(project)) as StoryProject
    }
  }

  function clearProjectExportSyncTimer(projectId: string) {
    const timer = exportSyncTimers.get(projectId)
    if (timer) {
      clearTimeout(timer)
      exportSyncTimers.delete(projectId)
    }
  }

  function setProjectExportBuffer(project: StoryProject) {
    exportBuffers.value[project.id] = {
      serialized: serializeProjectExport(project),
      projectUpdatedAt: project.updatedAt,
      bufferedAt: new Date().toISOString(),
    }
    persistExportBuffers()
  }

  function getProjectExportBinding(projectId: string) {
    const binding = exportBindings.value[projectId]
    if (!binding) return null
    return {
      ...binding,
      filePath: buildBoundProjectFilePath(binding),
    }
  }

  function buildExportBinding(project: StoryProject, directoryPath: string): ProjectExportBinding {
    return {
      directoryPath: directoryPath.trim(),
      fileName: buildBoundProjectFileName(project),
      linkedAt: new Date().toISOString(),
      lastSyncedAt: null,
      lastSyncedProjectUpdatedAt: null,
      lastError: null,
    }
  }

  function shouldSyncProjectExport(projectId: string) {
    const binding = exportBindings.value[projectId]
    const buffer = exportBuffers.value[projectId]
    if (!binding || !buffer) return false
    return binding.lastSyncedProjectUpdatedAt !== buffer.projectUpdatedAt
  }

  async function flushProjectExportBuffer(projectId: string) {
    const project = getProjectById(projectId)
    const binding = exportBindings.value[projectId]
    const buffer = exportBuffers.value[projectId]

    if (!project || !binding || !buffer) return false
    if (!shouldSyncProjectExport(projectId)) return false

    if (!window.electronAPI?.file?.write) {
      binding.lastError = 'Export sync is only available in the Electron desktop app'
      persistExportBindings()
      return false
    }

    const filePath = buildBoundProjectFilePath(binding)
    try {
      await window.electronAPI.file.write(filePath, buffer.serialized)
      binding.lastSyncedAt = new Date().toISOString()
      binding.lastSyncedProjectUpdatedAt = buffer.projectUpdatedAt
      binding.lastError = null
      delete exportBuffers.value[projectId]
      persistExportBindings()
      persistExportBuffers()
      return true
    } catch (error: any) {
      binding.lastError = error?.message || 'Failed to sync project export'
      persistExportBindings()
      return false
    }
  }

  function scheduleProjectExportSync(projectId: string, immediate = false) {
    if (!exportBindings.value[projectId] || !shouldSyncProjectExport(projectId)) return

    clearProjectExportSyncTimer(projectId)

    const run = () => {
      exportSyncingProjectIds.value = Array.from(new Set([...exportSyncingProjectIds.value, projectId]))
      void flushProjectExportBuffer(projectId).finally(() => {
        exportSyncingProjectIds.value = exportSyncingProjectIds.value.filter(id => id !== projectId)
      })
    }

    if (immediate) {
      run()
      return
    }

    const timer = setTimeout(run, PROJECT_EXPORT_SYNC_DELAY_MS)
    exportSyncTimers.set(projectId, timer)
  }

  function scheduleProjectExportSyncForProject(project: StoryProject, immediate = false) {
    if (!exportBindings.value[project.id]) return
    setProjectExportBuffer(project)
    scheduleProjectExportSync(project.id, immediate)
  }

  function flushPendingProjectExportSyncs() {
    for (const project of projects.value) {
      if (!exportBindings.value[project.id]) continue
      const buffer = exportBuffers.value[project.id]
      if (!buffer) continue
      scheduleProjectExportSync(project.id, true)
    }
  }

  function cleanupDanglingExportState() {
    const knownIds = new Set(projects.value.map(project => project.id))
    let changed = false

    for (const projectId of Object.keys(exportBindings.value)) {
      if (knownIds.has(projectId)) continue
      delete exportBindings.value[projectId]
      changed = true
    }

    for (const projectId of Object.keys(exportBuffers.value)) {
      if (knownIds.has(projectId)) continue
      delete exportBuffers.value[projectId]
      changed = true
    }

    if (changed) {
      persistExportBindings()
      persistExportBuffers()
    }
  }

  async function createProject(data: {
    name: string
    theme: string
    genre: string
    targetReader: string
    language: string
    style: string
    styleId: string
    writingFormat: WritingFormat
    length: StoryLength
    constraints: { required: string[]; forbidden: string[] }
    customRequirements: string
    directoryPath: string
  }): Promise<StoryProject> {
    const now = new Date().toISOString()
    const project: StoryProject = {
      id: generateId(),
      ...data,
      chapters: [],
      characters: [],
      relationshipEvents: [],
      knowledgeBaseIds: [],
      status: 'draft',
      generationStage: 'idle',
      outline: '',
      summary: '',
      createdAt: now,
      updatedAt: now,
    }
    projects.value.push(project)
    const saved = await saveToDisk(project, data.directoryPath)
    if (!saved) {
      projects.value = projects.value.filter(item => item.id !== project.id)
      persistLocalCache()
      throw new Error('Failed to persist project')
    }
    return project
  }

  async function importProject(data: any) {
    const project = normalizeImportedProject(data)
    projects.value.push(project)
    const saved = await saveToDisk(project)
    if (!saved) {
      projects.value = projects.value.filter(item => item.id !== project.id)
      persistLocalCache()
      throw new Error('Failed to persist imported project')
    }
    return project
  }

  async function updateProject(id: string, updates: Partial<StoryProject>) {
    const index = projects.value.findIndex(p => p.id === id)
    if (index === -1) return null
    projects.value[index] = {
      ...projects.value[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    }
    return saveToDisk(projects.value[index])
  }

  function deleteProject(id: string) {
    const index = projects.value.findIndex(p => p.id === id)
    if (index === -1) return
    clearProjectExportSyncTimer(id)
    delete exportBindings.value[id]
    delete exportBuffers.value[id]
    projects.value.splice(index, 1)
    if (activeProjectId.value === id) activeProjectId.value = null
    window.electronAPI?.project?.delete(id)
    persistExportBindings()
    persistExportBuffers()
    persistLocalCache()
  }

  function setActiveProject(id: string | null) {
    if (!id) {
      activeProjectId.value = null
      return
    }

    activeProjectId.value = projects.value.some(project => project.id === id) ? id : null
  }

  async function loadProjects() {
    isLoading.value = true
    try {
      const data = await window.electronAPI?.project?.list?.()
      if (Array.isArray(data)) {
        projects.value = migrateProjects(data)
        reconcileActiveProject()
        cleanupDanglingExportState()
        flushPendingProjectExportSyncs()
        persistLocalCache()
        return
      }

      projects.value = migrateProjects(readJsonStorage<any[]>(PROJECT_STORAGE_KEY, []))
      reconcileActiveProject()
      cleanupDanglingExportState()
      flushPendingProjectExportSyncs()
      persistLocalCache()
    } catch (e) {
      console.error('Failed to load projects:', e)
      projects.value = migrateProjects(readJsonStorage<any[]>(PROJECT_STORAGE_KEY, []))
      reconcileActiveProject()
      cleanupDanglingExportState()
      flushPendingProjectExportSyncs()
      persistLocalCache()
    } finally {
      isLoading.value = false
    }
  }

  async function saveToDisk(project: StoryProject, directoryPath?: string) {
    const snapshot = cloneProjectSnapshot(project)
    if (typeof directoryPath === 'string' && directoryPath.trim()) {
      snapshot.directoryPath = directoryPath.trim()
    }

    const previousSave = projectSaveQueues.get(snapshot.id) ?? Promise.resolve(null)
    const queuedSave = previousSave
      .catch(() => null)
      .then(async () => {
        try {
          if (window.electronAPI?.project?.save) {
            const savedProject = await window.electronAPI.project.save(snapshot, directoryPath)
            if (savedProject && typeof savedProject === 'object' && typeof savedProject.directoryPath === 'string' && savedProject.directoryPath.trim()) {
              project.directoryPath = savedProject.directoryPath.trim()
            }
          }
          scheduleProjectExportSyncForProject(project)
          persistLocalCache()
          return project
        } catch (e) {
          console.error('Failed to save project:', e)
          scheduleProjectExportSyncForProject(project)
          persistLocalCache()
          return null
        }
      })
      .finally(() => {
        if (projectSaveQueues.get(snapshot.id) === queuedSave) {
          projectSaveQueues.delete(snapshot.id)
        }
      })

    projectSaveQueues.set(snapshot.id, queuedSave)
    return queuedSave
  }

  function bindProjectExportDirectory(projectId: string, directoryPath: string) {
    const project = getProjectById(projectId)
    if (!project) throw new Error('Project not found')

    const trimmedDirectory = directoryPath.trim()
    if (!trimmedDirectory) throw new Error('Export directory is required')

    exportBindings.value[projectId] = buildExportBinding(project, trimmedDirectory)
    setProjectExportBuffer(project)
    persistExportBindings()
    return getProjectExportBinding(projectId)
  }

  function unbindProjectExportDirectory(projectId: string) {
    clearProjectExportSyncTimer(projectId)
    delete exportBindings.value[projectId]
    delete exportBuffers.value[projectId]
    persistExportBindings()
    persistExportBuffers()
  }

  async function syncProjectExportNow(projectId: string) {
    const project = getProjectById(projectId)
    if (!project) throw new Error('Project not found')
    if (!exportBindings.value[projectId]) throw new Error('Export directory is not linked')

    clearProjectExportSyncTimer(projectId)
    setProjectExportBuffer(project)
    exportSyncingProjectIds.value = Array.from(new Set([...exportSyncingProjectIds.value, projectId]))

    try {
      const synced = await flushProjectExportBuffer(projectId)
      if (!synced) {
        const binding = exportBindings.value[projectId]
        if (binding?.lastError) {
          throw new Error(binding.lastError)
        }
        throw new Error('Failed to sync project export')
      }
      return getProjectExportBinding(projectId)
    } finally {
      exportSyncingProjectIds.value = exportSyncingProjectIds.value.filter(id => id !== projectId)
    }
  }

  watch(projects, persistLocalCache, { deep: true })
  watch(activeProjectId, persistLocalCache)

  return {
    projects,
    activeProjectId,
    isLoading,
    exportSyncingProjectIds,
    activeProject,
    sortedProjects,
    createProject,
    importProject,
    updateProject,
    deleteProject,
    setActiveProject,
    loadProjects,
    getProjectById,
    getProjectExportBinding,
    bindProjectExportDirectory,
    unbindProjectExportDirectory,
    syncProjectExportNow,
  }
})
