import type { StoryProject } from '@/types/project'

export function exportToPlainText(project: StoryProject): string {
  const lines: string[] = []

  lines.push(project.name)
  lines.push('='.repeat(project.name.length))
  lines.push('')

  if (project.summary) {
    lines.push(project.summary)
    lines.push('')
  }

  lines.push(`Language: ${project.language || 'English'}`)
  lines.push('')

  for (const chapter of project.chapters) {
    lines.push(`Chapter ${chapter.index + 1}: ${chapter.title}`)
    lines.push('-'.repeat(40))
    lines.push('')
    const content = chapter.polishedContent || chapter.content
    lines.push(content || 'No content yet')
    lines.push('')
    lines.push('')
  }

  return lines.join('\n')
}
