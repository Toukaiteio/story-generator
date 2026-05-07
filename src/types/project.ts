import type { ID, Timestamps } from './common'
import type { Chapter } from './chapter'
import type { Character } from './character'
import type { CharacterRelationshipEvent } from './relationship'

export type StoryLength = 'short' | 'medium' | 'long'
export type StoryStatus = 'draft' | 'generating' | 'completed' | 'error'

export type GenerationStage =
  | 'idle'
  | 'planning'
  | 'chapter-outline'
  | 'writing'
  | 'proofreading'
  | 'polishing'
  | 'done'

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
  length: StoryLength
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
}
