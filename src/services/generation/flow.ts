import type { GenerationStage, StoryProject } from '@/types/project'
import type { NextGenerationAction } from './types'

export const generationStageOrder: GenerationStage[] = [
  'planning',
  'chapter-outline',
  'writing',
  'proofreading',
  'polishing',
]

export function findNextChapterPosition(
  chapters: StoryProject['chapters'],
  predicate: (chapter: StoryProject['chapters'][number]) => boolean | string
) {
  let nextIndex = -1
  for (let index = 0; index < chapters.length; index++) {
    if (!predicate(chapters[index])) continue
    if (nextIndex === -1 || chapters[index].index < chapters[nextIndex].index) {
      nextIndex = index
    }
  }
  return nextIndex
}

export function isChapterPlanComplete(chapter: StoryProject['chapters'][number]) {
  return Boolean(
    chapter.title?.trim() &&
    chapter.outline.objective?.trim() &&
    chapter.outline.conflict?.trim() &&
    chapter.outline.keyEvents?.some(item => item.trim()) &&
    chapter.outline.characterActions?.some(item => item.trim()) &&
    chapter.outline.infoReveals?.some(item => item.trim()) &&
    chapter.outline.endingHook?.trim()
  )
}

export function hasAnyChapterPlanInfo(chapter: StoryProject['chapters'][number]) {
  return Boolean(
    chapter.outline.objective?.trim() ||
    chapter.outline.conflict?.trim() ||
    chapter.outline.keyEvents?.some(item => item.trim()) ||
    chapter.outline.characterActions?.some(item => item.trim()) ||
    chapter.outline.infoReveals?.some(item => item.trim()) ||
    chapter.outline.endingHook?.trim()
  )
}

export function getNextGenerationAction(project: StoryProject): NextGenerationAction {
  if (!project.outline.trim() || !project.characters.length) return { stage: 'planning' }
  if (!project.chapters.length) {
    return { stage: 'chapter-outline' }
  }

  const chapterOutlineIndex = findNextChapterPosition(project.chapters, chapter => !isChapterPlanComplete(chapter))
  if (chapterOutlineIndex !== -1) return { stage: 'chapter-outline', chapterIndex: chapterOutlineIndex }

  const writingIndex = findNextChapterPosition(project.chapters, ch => !ch.content.trim())
  if (writingIndex !== -1) return { stage: 'writing', chapterIndex: writingIndex }

  const proofreadingIndex = findNextChapterPosition(project.chapters, ch =>
    ch.content.trim() && (
      ch.proofreadingIssuesStale === true ||
      !['proofread', 'proofreading', 'polishing', 'polished'].includes(ch.status)
    )
  )
  if (proofreadingIndex !== -1) return { stage: 'proofreading', chapterIndex: proofreadingIndex }

  const polishingIndex = findNextChapterPosition(project.chapters, ch =>
    ch.content.trim() && ch.status === 'proofread'
  )
  if (polishingIndex !== -1) return { stage: 'polishing', chapterIndex: polishingIndex }

  return { stage: 'done' }
}

export function resolveNextChapterIndex(
  project: StoryProject,
  stage: Exclude<NextGenerationAction['stage'], 'planning' | 'chapter-outline' | 'done'>
) {
  const action = getNextGenerationAction(project)
  return action.stage === stage ? action.chapterIndex : -1
}

export function resolveChapterIndexById(project: StoryProject, chapterId: string) {
  return project.chapters.findIndex(chapter => chapter.id === chapterId)
}
