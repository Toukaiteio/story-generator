import { readJsonStorage, writeJsonStorage } from '@/lib/storage'
import { sanitizeFileName, PROJECT_FILE_EXTENSION, serializeProjectFile } from '@/services/projectFile'
import type { StoryProject } from '@/types/project'

export const PROJECT_EXPORT_BINDINGS_STORAGE_KEY = 'story-generator.project-export-bindings.v1'
export const PROJECT_EXPORT_BUFFERS_STORAGE_KEY = 'story-generator.project-export-buffers.v1'
export const PROJECT_EXPORT_SYNC_DELAY_MS = 900

export interface ProjectExportBinding {
  directoryPath: string
  fileName: string
  filePath?: string
  linkedAt: string
  lastSyncedAt: string | null
  lastSyncedProjectUpdatedAt: string | null
  lastError: string | null
}

export interface ProjectExportBuffer {
  serialized: string
  projectUpdatedAt: string
  bufferedAt: string
}

function normalizeDirectoryPath(directoryPath: string) {
  return directoryPath.trim().replace(/[\\/]+$/, '')
}

export function buildBoundProjectFileName(project: Pick<StoryProject, 'name' | 'id'>) {
  const safeName = sanitizeFileName(project.name)
  return `${safeName}_${project.id}${PROJECT_FILE_EXTENSION}`
}

export function buildBoundProjectFilePath(binding: Pick<ProjectExportBinding, 'directoryPath' | 'fileName'>) {
  const directoryPath = normalizeDirectoryPath(binding.directoryPath)
  if (!directoryPath) return binding.fileName
  const separator = directoryPath.includes('\\') ? '\\' : '/'
  return `${directoryPath}${separator}${binding.fileName}`
}

export function readProjectExportBindings() {
  return readJsonStorage<Record<string, ProjectExportBinding>>(PROJECT_EXPORT_BINDINGS_STORAGE_KEY, {})
}

export function writeProjectExportBindings(value: Record<string, ProjectExportBinding>) {
  writeJsonStorage(PROJECT_EXPORT_BINDINGS_STORAGE_KEY, value)
}

export function readProjectExportBuffers() {
  return readJsonStorage<Record<string, ProjectExportBuffer>>(PROJECT_EXPORT_BUFFERS_STORAGE_KEY, {})
}

export function writeProjectExportBuffers(value: Record<string, ProjectExportBuffer>) {
  writeJsonStorage(PROJECT_EXPORT_BUFFERS_STORAGE_KEY, value)
}

export function serializeProjectExport(project: StoryProject) {
  return serializeProjectFile(project)
}
