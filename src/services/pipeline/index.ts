import type { StoryProject } from '@/types/project'
import { polishChapter as polishChapterWorkflow } from './chapter'

export class StoryPipeline {
  cancel() {}

  async polishChapter(
    project: StoryProject,
    chapterIndex: number,
    onToken?: (token: string) => void,
    proofreadingIssues?: any[],
    onIntermediateChapter?: (chapter: StoryProject['chapters'][number]) => void | Promise<void>
  ) {
    return polishChapterWorkflow(project, chapterIndex, onToken, proofreadingIssues, onIntermediateChapter)
  }
}
