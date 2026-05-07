import type { StoryProject } from '@/types/project'
import type { Character } from '@/types/character'

export function buildCharacterContext(characters: Character[]): string {
  return characters.map(c =>
    `**${c.name}** (${c.role})
- Personality: ${c.personality.join(', ')}
- Appearance: ${c.appearance}
- Motivation: ${c.motivation}
- Goals: ${c.goals}
- Conflicts: ${c.conflicts}
- Current State: ${c.currentState}`
  ).join('\n\n')
}

export function buildPreviousSummary(project: StoryProject, upToChapter: number): string {
  const summaries: string[] = []
  for (let i = 0; i < upToChapter; i++) {
    const ch = project.chapters[i]
    if (ch?.summary) {
      summaries.push(`Chapter ${i + 1} (${ch.title}): ${ch.summary}`)
    }
  }
  return summaries.join('\n')
}
