import type { StoryProject } from '@/types/project'
import type { Character } from '@/types/character'

const CHARACTER_DETAIL_THRESHOLD = 8

export function buildCharacterNames(characters: Character[]): string {
  if (!characters.length) return 'No characters'
  return characters.map(c => `- ${c.name} (${c.role})`).join('\n')
}

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

export function buildCharacterContextForTask(
  characters: Character[],
  task: 'proofreading' | 'polishing' | 'planning' | 'writing' | 'outlining'
): string {
  // 校对/润色流程总是需要完整角色信息以检查一致性
  if (task === 'proofreading' || task === 'polishing') {
    return buildCharacterContext(characters)
  }

  // 其他流程：角色少则注入完整信息，多则仅注入名称
  if (characters.length <= CHARACTER_DETAIL_THRESHOLD) {
    return buildCharacterContext(characters)
  }

  return buildCharacterNames(characters)
}

export function buildPreviousSummary(project: StoryProject, upToChapter: number): string {
  const summaries: string[] = []
  const target = project.chapters[upToChapter]
  const targetChapterOrder = target?.index ?? upToChapter
  const previousChapters = project.chapters
    .filter(chapter => chapter.index < targetChapterOrder)
    .sort((a, b) => a.index - b.index)

  for (const ch of previousChapters) {
    if (ch?.summary) {
      summaries.push(`Chapter ${ch.index + 1} (${ch.title}): ${ch.summary}`)
    }
  }
  return summaries.join('\n')
}
