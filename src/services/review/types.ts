import type { ToolCallStatusItem } from '@/components/ui/ToolCallStatus.vue'
import type { StoryProject } from '@/types/project'
import type { Chapter } from '@/types/chapter'

export type ReviewAgentStatus = 'idle' | 'waiting' | 'requesting' | 'speaking' | 'blocked'
export type ReviewMessageRole = 'user' | 'agent' | 'system'
export type ReviewContextElement = 'story-config' | 'master-outline' | 'characters' | 'selected-chapter' | 'chapter-plan' | 'chapter-draft'

export interface ReviewSpeechRequest {
  id: string
  agentId: string
  requestedBy: 'agent' | 'user'
  focus: string
  userInstruction?: string
  createdAt: string
}

export interface ReviewProposal {
  id: string
  type: 'focus'
  agentId: string
  agentName: string
  content: string
  reason: string
  createdAt: string
}

export type ReviewEndVoteValue = 'approve' | 'reject'

export interface ReviewEndVote {
  agentId: string
  agentName: string
  vote: ReviewEndVoteValue
  reason: string
  createdAt: string
}

export interface ReviewEndVoteSession {
  id: string
  requestedByAgentId: string
  requestedByAgentName: string
  reason: string
  status: 'voting' | 'ready'
  votes: ReviewEndVote[]
  createdAt: string
  completedAt?: string
}

export interface ReviewAskUserRequest {
  question: string
  options: string[]
  reason: string
}

export interface ReviewAskUserSession {
  id: string
  requestedByAgentId: string
  requestedByAgentName: string
  request: ReviewAskUserRequest
  status: 'voting' | 'ready' | 'answered' | 'rejected'
  votes: ReviewEndVote[]
  createdAt: string
  completedAt?: string
}

export type ReviewChangeTarget = 'master-outline' | 'chapter-plan' | 'characters' | 'consensus'

export interface ReviewChangeRequest {
  target: ReviewChangeTarget
  scope: string
  purpose: string
  content: string
}

export interface ReviewChangeAmendment {
  action: 'modify' | 'delete' | 'insert'
  scope: string
  purpose: string
  content: string
}

export interface ReviewChangeVote {
  agentId: string
  agentName: string
  vote: ReviewEndVoteValue
  reason: string
  amendment?: ReviewChangeAmendment
  createdAt: string
}

export interface ReviewChangeVoteSession {
  id: string
  requestedByAgentId: string
  requestedByAgentName: string
  request: ReviewChangeRequest
  status: 'voting' | 'applying' | 'applied' | 'rejected' | 'failed'
  votes: ReviewChangeVote[]
  amendmentDepth?: number
  result?: string
  error?: string
  createdAt: string
  completedAt?: string
}

export interface ReviewAgentDefinition {
  id: string
  name: string
  role: string
  brief: string
  defaultModelRole: 'chapterPlanner' | 'proofreader' | 'proposerAgent'
  systemPrompt: string
  custom?: boolean
}

export interface ReviewAgentState extends ReviewAgentDefinition {
  enabled: boolean
  status: ReviewAgentStatus
  waitingForTurn: boolean
  lastSeenMessageIndex: number
  privateMemory: string[]
  workspaceState: Record<string, unknown>
  modelValue: string
  customSystemPrompt: string
  toolState: {
    requestSpeech: ReviewAgentStatus
    lastRequestedAt?: string
    lastSpokeAt?: string
    error?: string
  }
}

export interface ReviewPublicMessage {
  id: string
  role: ReviewMessageRole
  agentId?: string
  agentName?: string
  content: string
  tool?: ToolCallStatusItem
  changeVoteSnapshot?: ReviewChangeVoteSession
  createdAt: string
}

export interface MultiAgentReviewContext {
  project: StoryProject | null | undefined
  chapter: Chapter | null | undefined
  outline: string
  characters: string
}
