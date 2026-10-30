/**
 * Typed interface for agent context data.
 * All agents use underscore-prefixed properties to store intermediate results.
 * This interface documents the contract for context mutations.
 */
export interface AgentContextData {
  // Outline phase
  _outlineData?: {
    title: string
    synopsis: string
    outline: string
  }
  _onOutlineUpdated?: (data: any) => Promise<void>

  // Character phase
  _charactersData?: any[]
  _onCharactersUpdated?: (data: any) => Promise<void>
  _createdCharacters?: any[]

  // Chapter planning
  _chapterOutlineData?: {
    chapterNumber: number
    title: string
    objective: string
    conflict: string
    keyEvents: string[]
    characterActions: string[]
    infoReveals: string[]
    endingHook: string
  }
  _onChapterOutlineUpdated?: (data: any) => Promise<void>

  // Chapter titles
  _chapterTitlesData?: {
    chapterCount: number
    chapters: Array<{ chapterNumber: number; title: string; objective: string }>
  }
  _nextChapterTitleData?: {
    chapterNumber: number
    title: string
    objective: string
  }

  // Writing
  _chapterDraftChunks?: string[]
  _chapterComplete?: boolean

  // Proofreading & polishing
  _proofreadingIssues?: any[]

  // Configuration refinement
  _refinedConfig?: any

  // Story planner phases
  _storyPlannerPhase?: 'outline' | 'characters'

  // Relationship tracking
  _relationshipEvents?: any[]
  _relationshipEventsFinalized?: boolean
}

/**
 * Merge agent context data with runtime context.
 * Use this to ensure type safety when accessing context properties.
 */
export type RuntimeContext = Record<string, any> & AgentContextData
