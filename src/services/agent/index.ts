import { OutlineExpert } from './outline'
import { DetailerExpert } from './detailer'
import { CharacterExpert } from './character'
import { StoryPlannerExpert } from './storyPlanner'
import { ChapterTitlePlannerExpert } from './chapterTitlePlanner'
import { ChapterPlannerExpert } from './chapterPlanner'
import { WriterExpert } from './writer'
import { EditingAIExpert } from './editingAI'
import { ProofreaderExpert } from './proofreader'
import { PolisherExpert } from './polisher'
import { RelationshipTrackerExpert } from './relationshipTracker'
import type { AgentType } from '@/types/agent'

export { BaseAgent } from './base'
export type { AgentResult } from './base'

export const agents = {
  outline: new OutlineExpert(),
  detailer: new DetailerExpert(),
  character: new CharacterExpert(),
  storyPlanner: new StoryPlannerExpert(),
  chapterTitlePlanner: new ChapterTitlePlannerExpert(),
  chapterPlanner: new ChapterPlannerExpert(),
  writer: new WriterExpert(),
  editingAI: new EditingAIExpert(),
  proofreader: new ProofreaderExpert(),
  polisher: new PolisherExpert(),
  relationshipTracker: new RelationshipTrackerExpert(),
}

export function getAgent(type: AgentType) {
  return agents[type]
}

// Re-export tool types for convenience
export type { ToolDefinition, ToolCall, ToolResult } from '@/services/provider/tools'
