import type { ID, Timestamps } from './common'
import type { Chapter } from './chapter'
import type { Character } from './character'
import type { CharacterRelationshipEvent } from './relationship'

export type StoryLength = 'short' | 'medium' | 'long'
export type StoryStatus = 'draft' | 'generating' | 'completed' | 'error'
export type WritingFormat = 'plaintext' | 'markdown'

export type GenerationStage =
  | 'idle'
  | 'planning'
  | 'chapter-outline'
  | 'chapter-outline-review'
  | 'writing'
  | 'proofreading'
  | 'polishing'
  | 'done'

export interface ChapterConfig {
  maxChapters: number
}

export interface ProjectWritingStyleSnapshot {
  id: ID
  name: string
  description?: string
  content: string
  tags?: string[]
  capturedAt: string
}

export interface ProjectReviewAgentSettings {
  agents: Record<string, {
    name?: string
    role?: string
    brief?: string
    defaultModelRole?: 'chapterPlanner' | 'proofreader' | 'proposerAgent'
    modelValue?: string
    systemPrompt?: string
    customSystemPrompt?: string
    disabled?: boolean
    deleted?: boolean
    custom?: boolean
  }>
}

export interface StoryProject extends Timestamps {
  id: ID
  name: string
  directoryPath: string
  theme: string
  genre: string
  targetReader: string
  language: string
  style: string
  styleId: string
  writingStyleSnapshot?: ProjectWritingStyleSnapshot | null
  writingFormat: WritingFormat
  chapterCount: number
  chapterConfig: ChapterConfig
  length?: StoryLength
  constraints: {
    required: string[]
    forbidden: string[]
  }
  customRequirements: string
  chapters: Chapter[]
  characters: Character[]
  relationshipEvents: CharacterRelationshipEvent[]
  knowledgeBaseIds: ID[]
  status: StoryStatus
  generationStage: GenerationStage
  outline: string
  summary: string
  reviewAgentSettings?: ProjectReviewAgentSettings
}
