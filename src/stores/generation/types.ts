import type { Character } from '@/types/character'
import type { GenerationStage } from '@/types/project'
import type { AgentTodoListState } from '@/services/agent/todolist'

export interface GenerationError {
  id: string
  stage: string
  message: string
  timestamp: string
}

export interface ToolContinuationRequest {
  id: string
  workflow: string
  rounds: number
  finalToolNames: string[]
  continue: () => void
  stop: () => void
}

export interface VibePlanningResult {
  outline?: string
  characters?: Character[]
  summary: string
  toolName: string
}

export type ToolStatusUpdate = {
  name: string
  status: 'running' | 'success' | 'warning' | 'error'
  detail?: string
  before?: string
  after?: string
  callId?: string
}

export interface AssistantCallbacks {
  onToken?: (token: string) => void
  onReasoningToken?: (token: string) => void
  onToolStatus?: (status: ToolStatusUpdate) => void
  onTodoList?: (state: AgentTodoListState) => void
  onPlanningResult?: (result: VibePlanningResult) => void
  signal?: AbortSignal
}

export interface ManualTaskState {
  stage: GenerationStage
  message: string
  chapterIndex?: number | null
}
