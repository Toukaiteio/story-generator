import { OutlineExpert } from './outline'
import { DetailerExpert } from './detailer'
import { CharacterExpert } from './character'
import { StoryPlannerExpert } from './storyPlanner'
import { ChapterTitlePlannerExpert } from './chapterTitlePlanner'
import { ChapterPlannerExpert } from './chapterPlanner'
import { WriterExpert } from './writer'
import { ProofreaderExpert } from './proofreader'
import { PolisherExpert } from './polisher'
import { RelationshipTrackerExpert } from './relationshipTracker'
import type { AgentType } from '@/types/agent'

type RuntimeAgentType = Exclude<AgentType, 'skillAgent'>

export { BaseAgent } from './base'
export type { AgentResult } from './base'
export { runPiAgent } from './piRuntime'
export type { PiAgentRunOptions, PiAgentRunResult, PiToolStatus } from './piRuntime'
export { createPiContextTransformer } from './piContext'
export type { PiContextTransformOptions, PiContextTransformReport } from './piContext'

export const agents = {
  outline: new OutlineExpert(),
  detailer: new DetailerExpert(),
  character: new CharacterExpert(),
  storyPlanner: new StoryPlannerExpert(),
  chapterTitlePlanner: new ChapterTitlePlannerExpert(),
  chapterPlanner: new ChapterPlannerExpert(),
  writer: new WriterExpert(),
  editingAI: new DetailerExpert('editingAI', 'Editing AI'),
  proofreader: new ProofreaderExpert(),
  polisher: new PolisherExpert(),
  relationshipTracker: new RelationshipTrackerExpert(),
}

export function getAgent(type: RuntimeAgentType) {
  return agents[type]
}

// Re-export tool types for convenience
export type { ToolDefinition, ToolCall, ToolResult } from '@/services/provider/tools'
