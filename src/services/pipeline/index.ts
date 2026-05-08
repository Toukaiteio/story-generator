import type { StoryProject } from '@/types/project'
import type { PipelineCallbacks, PipelineRunOptions } from './types'
import { generateOutline as generateOutlineWorkflow, generateCharacters as generateCharactersWorkflow, generateStoryPlan as generateStoryPlanWorkflow } from './planning'
import { generateChapterPlan as generateChapterPlanWorkflow, generateChapterDraft as generateChapterDraftWorkflow, proofreadChapter as proofreadChapterWorkflow, polishChapter as polishChapterWorkflow, run as runWorkflow } from './chapter'

export type { PipelineCallbacks, PipelineRunOptions } from './types'

export class StoryPipeline {
  private cancelled = false

  cancel() {
    this.cancelled = true
  }

  async generateOutline(project: StoryProject) {
    return generateOutlineWorkflow(project)
  }

  async generateCharacters(project: StoryProject) {
    return generateCharactersWorkflow(project)
  }

  async generateStoryPlan(
    project: StoryProject,
    onToken?: (token: string) => void,
    onProgress?: (message: string) => void,
    onError?: (error: string) => void,
    onIntermediateSave?: (updates: Partial<StoryProject>) => void
  ) {
    return generateStoryPlanWorkflow(project, onToken, onProgress, onError, onIntermediateSave)
  }

  async generateChapterPlan(
    project: StoryProject,
    onToken?: (token: string) => void,
    onProgress?: (message: string) => void,
    onError?: (error: string) => void,
    onIntermediateSave?: (updates: Partial<StoryProject>) => void
  ) {
    return generateChapterPlanWorkflow(project, onToken, onProgress, onError, onIntermediateSave, () => this.cancelled)
  }

  async generateChapterDraft(
    project: StoryProject,
    chapterIndex: number,
    onToken?: (token: string) => void,
    onIntermediateChapter?: (chapter: StoryProject['chapters'][number]) => void | Promise<void>
  ) {
    return generateChapterDraftWorkflow(project, chapterIndex, onToken, onIntermediateChapter)
  }

  async proofreadChapter(project: StoryProject, chapterIndex: number, onToken?: (token: string) => void) {
    return proofreadChapterWorkflow(project, chapterIndex, onToken)
  }

  async polishChapter(project: StoryProject, chapterIndex: number, onToken?: (token: string) => void) {
    return polishChapterWorkflow(project, chapterIndex, onToken)
  }

  async run(
    project: StoryProject,
    callbacks: PipelineCallbacks,
    options: PipelineRunOptions = {}
  ) {
    return runWorkflow(project, callbacks, options, () => this.cancelled)
  }
}
