import type { StoryProject } from '@/types/project'

export function exportToJson(project: StoryProject): string {
  return JSON.stringify(project, null, 2)
}
