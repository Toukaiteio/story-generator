import type { StoryProject } from '@/types/project'
import type { Character } from '@/types/character'

const CHARACTER_DETAIL_THRESHOLD = 8

export function buildCharacterNames(characters: Character[]): string {
  if (!characters.length) return 'No characters'
  return characters.map(c => `- ${c.name} [id: ${c.id}] (${c.role})`).join('\n')
}

export function buildCharacterContext(characters: Character[]): string {
  return characters.map(c =>
    `**${c.name}** [id: ${c.id}] (${c.role})
- Personality: ${c.personality.join(', ')}
- Appearance: ${c.appearance}
- Motivation: ${c.motivation}
- Goals: ${c.goals}
- Conflicts: ${c.conflicts}
- Current State: ${c.currentState}`
  ).join('\n\n')
}

export function buildCharacterContextForTask(
  characters: Character[],
  task: 'proofreading' | 'polishing' | 'planning' | 'writing' | 'outlining'
): string {
  if (task === 'proofreading' || task === 'polishing') {
    return buildCharacterNames(characters)
  }

  if (characters.length <= CHARACTER_DETAIL_THRESHOLD) {
    return buildCharacterContext(characters)
  }

  return buildCharacterNames(characters)
}

export function buildPreviousSummary(project: StoryProject, upToChapter: number, limit = 12): string {
  const summaries: string[] = []
  const target = project.chapters[upToChapter]
  const targetChapterOrder = target?.index ?? upToChapter
  const previousChapters = project.chapters
    .filter(chapter => chapter.index < targetChapterOrder)
    .sort((a, b) => a.index - b.index)
    .slice(-limit)

  const omitted = Math.max(0, targetChapterOrder - previousChapters.length)
  if (omitted > 0) {
    summaries.push(`[${omitted} earlier chapters omitted from this local context. Use the story outline and relationship tools for global continuity.]`)
  }

  for (const ch of previousChapters) {
    if (ch?.summary) {
      summaries.push(`Chapter ${ch.index + 1} (${ch.title}): ${ch.summary}`)
    }
  }
  return summaries.join('\n')
}

export function buildProjectRelationshipContext(project: StoryProject): StoryProject {
  return {
    ...project,
    chapters: project.chapters.map(chapter => ({
      ...chapter,
      content: '',
      polishedContent: '',
    })),
  }
}
