import type { StoryProject } from '@/types/project'

export function exportToMarkdown(project: StoryProject): string {
  const lines: string[] = []

  lines.push(`# ${project.name}`)
  lines.push('')
  if (project.summary) {
    lines.push(`> ${project.summary}`)
    lines.push('')
  }

  lines.push('## Story Details')
  lines.push('')
  lines.push(`- **Genre:** ${project.genre}`)
  lines.push(`- **Theme:** ${project.theme}`)
  lines.push(`- **Target Reader:** ${project.targetReader}`)
  lines.push(`- **Language:** ${project.language || 'English'}`)
  if (project.style) {
    lines.push('## Writing Style Guide')
    lines.push('')
    lines.push(project.style)
    lines.push('')
  }
  lines.push(`- **Length:** ${project.length}`)
  lines.push('')

  if (project.outline) {
    lines.push('## Outline')
    lines.push('')
    lines.push(project.outline)
    lines.push('')
  }

  if (project.characters.length) {
    lines.push('## Characters')
    lines.push('')
    for (const char of project.characters) {
      lines.push(`### ${char.name}`)
      lines.push(`- **Role:** ${char.role}`)
      lines.push(`- **Personality:** ${char.personality.join(', ')}`)
      if (char.motivation) lines.push(`- **Motivation:** ${char.motivation}`)
      if (char.goals) lines.push(`- **Goals:** ${char.goals}`)
      if (char.backstory) lines.push(`- **Backstory:** ${char.backstory}`)
      lines.push('')
    }
  }

  if (project.chapters.length) {
    lines.push('## Chapters')
    lines.push('')
    for (const chapter of project.chapters) {
      lines.push(`---`)
      lines.push('')
      lines.push(`## Chapter ${chapter.index + 1}: ${chapter.title}`)
      lines.push('')
      const content = chapter.polishedContent || chapter.proofreadContent || chapter.content
      lines.push(content || '*No content yet*')
      lines.push('')
    }
  }

  return lines.join('\n')
}
