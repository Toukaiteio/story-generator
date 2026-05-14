import type { ID, Timestamps } from './common'

export type AgentType = 'outline' | 'detailer' | 'character' | 'storyPlanner' | 'chapterTitlePlanner' | 'chapterPlanner' | 'writer' | 'editingAI' | 'proofreader' | 'polisher' | 'relationshipTracker' | 'skillAgent' | 'proposerAgent'
export type AgentRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface AgentDefinition {
  id: ID
  type: AgentType
  name: string
  description: string
  systemPrompt: string
  modelTier: 'expert' | 'standard'
  maxRetries: number
  timeout: number
}

export interface AgentRun extends Timestamps {
  id: ID
  agentType: AgentType
  projectId: ID
  chapterId?: ID
  status: AgentRunStatus
  input: string
  output: string
  duration: number
  tokenUsage: { prompt: number; completion: number }
  error?: string
  retryCount: number
}
