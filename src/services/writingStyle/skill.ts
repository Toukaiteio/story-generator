import type { ProjectWritingStyleSnapshot, StoryProject } from '@/types/project'
import type { WritingStyle, WritingStyleSkill } from '@/types/writingStyle'

export function formatStyleSkill(skill: WritingStyleSkill | undefined, name?: string): string {
  if (!skill) return ''
  const lines: string[] = []
  if (name) lines.push(`Voice skill: ${name}`)
  if (skill.whenToUse) lines.push(`When to use: ${skill.whenToUse}`)
  if (skill.signature) lines.push(`Voice signature: ${skill.signature}`)
  if (skill.rules.length) lines.push(`Rules:\n${skill.rules.map(rule => `- ${rule}`).join('\n')}`)
  if (skill.antiPatterns.length) lines.push(`Avoid:\n${skill.antiPatterns.map(item => `- ${item}`).join('\n')}`)
  if (skill.exemplars.length) {
    lines.push(`Exemplars (match the voice, not the content):\n${skill.exemplars.map(text => `"""${text}"""`).join('\n')}`)
  }
  return lines.join('\n')
}

/** Compact voice skill first, long-form guide second. */
export function buildProjectStylePrompt(project: StoryProject): string {
  const snapshot = project.writingStyleSnapshot
  const skillBlock = formatStyleSkill(snapshot?.skill, snapshot?.name)
  const guide = project.style?.trim()
  if (!skillBlock) return guide ?? ''
  if (!guide) return skillBlock
  return `${skillBlock}\n\nFull style guide:\n${guide}`
}

export function buildWritingStyleSnapshot(
  style: WritingStyle | undefined,
  content: string,
  capturedAt = new Date().toISOString(),
): ProjectWritingStyleSnapshot | null {
  if (!style) return null
  return {
    id: style.id,
    name: style.name,
    description: style.description,
    content,
    tags: style.tags,
    skill: style.skill,
    capturedAt,
  }
}
