import type { StoryProject } from '@/types/project'

export const PROJECT_FILE_TYPE = 'story-generator-project'
export const PROJECT_FILE_VERSION = 1
export const PROJECT_FILE_EXTENSION = '.storyproject.json'

export interface StoryProjectFileV1 {
  type: typeof PROJECT_FILE_TYPE
  version: typeof PROJECT_FILE_VERSION
  exportedAt: string
  project: StoryProject
}

export function sanitizeFileName(name: string) {
  const trimmed = name.trim()
  return trimmed ? trimmed.replace(/[^a-zA-Z0-9_\-]+/g, '_') : 'story_project'
}

export function buildProjectFileName(project: Pick<StoryProject, 'name'>) {
  return `${sanitizeFileName(project.name)}${PROJECT_FILE_EXTENSION}`
}

export function serializeProjectFile(project: StoryProject) {
  const payload: StoryProjectFileV1 = {
    type: PROJECT_FILE_TYPE,
    version: PROJECT_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    project,
  }

  return JSON.stringify(payload, null, 2)
}

export function parseProjectFile(content: string): any {
  const raw = JSON.parse(content)
  if (raw && typeof raw === 'object' && raw.type === PROJECT_FILE_TYPE && raw.project) {
    return raw.project
  }
  return raw
}
