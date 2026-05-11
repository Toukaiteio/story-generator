import type { StoryProject } from '@/types/project'

export interface DraftSnapshotLike {
  title: string
  content: string
  updatedAt: string
}

export interface UnsavedChapterLocation {
  projectId: string
  projectName: string
  chapterId: string
  chapterIndex: number
  chapterTitle: string
  workspaceNode: string
  hasDraftSnapshot: boolean
}

export interface UnsavedChapterScanResult {
  entries: UnsavedChapterLocation[]
  staleChapterIds: string[]
}

export function buildUnsavedChapterLocations(
  projects: StoryProject[],
  unsavedWorkspaceNodes: Record<string, boolean>,
  chapterEditorDrafts: Record<string, DraftSnapshotLike>
): UnsavedChapterScanResult {
  const chapterLookup = new Map<string, { project: StoryProject; chapter: StoryProject['chapters'][number] }>()
  for (const project of projects) {
    for (const chapter of project.chapters) {
      chapterLookup.set(chapter.id, { project, chapter })
    }
  }

  const candidateIds = new Set<string>()
  for (const node of Object.keys(unsavedWorkspaceNodes)) {
    if (node.startsWith('chapter-') && unsavedWorkspaceNodes[node]) {
      candidateIds.add(node.slice('chapter-'.length))
    }
  }
  for (const chapterId of Object.keys(chapterEditorDrafts)) {
    candidateIds.add(chapterId)
  }

  const entries: UnsavedChapterLocation[] = []
  const staleChapterIds: string[] = []

  for (const chapterId of candidateIds) {
    const matched = chapterLookup.get(chapterId)
    if (!matched) {
      staleChapterIds.push(chapterId)
      continue
    }

    const draft = chapterEditorDrafts[chapterId]
    if (draft && draft.title === (matched.chapter.title || '') && draft.content === (matched.chapter.content || '')) {
      staleChapterIds.push(chapterId)
      continue
    }

    entries.push({
      projectId: matched.project.id,
      projectName: matched.project.name,
      chapterId,
      chapterIndex: matched.chapter.index,
      chapterTitle: matched.chapter.title || '',
      workspaceNode: `chapter-${chapterId}`,
      hasDraftSnapshot: Boolean(draft),
    })
  }

  entries.sort((left, right) => {
    if (left.projectName !== right.projectName) return left.projectName.localeCompare(right.projectName)
    return left.chapterIndex - right.chapterIndex
  })

  return { entries, staleChapterIds }
}
