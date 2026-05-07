import type { StoryProject } from '@/types/project'

export interface PipelineCallbacks {
  onStageChange: (stage: string) => void
  onProgress: (message: string) => void
  onError: (error: string) => void
  onChapterStart: (index: number) => void
  onChapterComplete: (index: number) => void
  onToken?: (token: string) => void
  onIntermediateSave?: (project: StoryProject) => void
}

export interface PipelineRunOptions {
  stopAfterStage?: 'planning' | 'chapter-outline' | 'writing' | 'proofreading' | 'polishing'
}

export interface PlanningDraft {
  title: string
  synopsis: string
  outline: string
  characterSignals: string
  needsCharacters: boolean | null
}

export interface ChapterPlanEntry {
  chapterNumber: number
  title: string
  objective: string
  conflict: string
  keyEvents: string[]
  characterActions: string[]
  infoReveals: string[]
  endingHook: string
}
