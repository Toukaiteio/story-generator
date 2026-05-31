/**
 * Meeting v2 — Phase State Machine Types
 *
 * Design principles:
 * - Explicit phases replace the implicit loop+counter model
 * - Each phase has a clear entry condition, exit condition, and turn budget
 * - Agent turns are pure async functions; side effects live in the composable
 * - Voting is lightweight: majority wins, no per-vote LLM calls for simple approvals
 */

import type { Chapter } from '@/types/chapter'
import type { StoryProject } from '@/types/project'

// ─── Meeting Phases ──────────────────────────────────────────────────────────

/**
 * idle     — not started
 * analysis — sub-agents analyzing in parallel
 * synthesis — master deciding and acting
 * action   — executing a change
 * verify   — checking whether the original task is complete
 * ended    — terminal
 */
export type MeetingPhase =
  | 'idle'
  | 'analysis'
  | 'synthesis'
  | 'action'
  | 'verify'
  | 'ended'

// ─── Agent Role ──────────────────────────────────────────────────────────────

export type AgentRole = 'reviewer' | 'proposer'

// ─── Agent Turn Result ───────────────────────────────────────────────────────

/**
 * What an agent produced in a single turn.
 * Pure data — no refs, no side effects.
 */
export interface AgentTurnResult {
  agentId: string
  agentName: string
  /** Public message to show in chat. Null = agent chose to stay silent. */
  publicMessage: string | null
  /** Structured action the agent wants to take. */
  intent: AgentIntent | null
  /** Private note appended to agent's memory (not shown in chat). */
  privateNote: string
}

// ─── Agent Intents ───────────────────────────────────────────────────────────

export type AgentIntent =
  | { type: 'propose_action'; request: ChangeRequest }
  | { type: 'propose_focus'; content: string; reason: string }
  | { type: 'ask_user'; question: string; options: string[]; reason: string }
  | { type: 'request_end'; reason: string }
  | { type: 'call_agent'; targetId: string }
  | { type: 'continue_speaking' }

// ─── Change Request ───────────────────────────────────────────────────────────

export type ChangeTarget = 'master-outline' | 'chapter-plan' | 'chapter-draft' | 'characters' | 'consensus'
export type ChangeAction = 'create' | 'read' | 'update' | 'delete'

export interface ChangeRequest {
  target: ChangeTarget
  action: ChangeAction
  scope: string
  purpose: string
  content: string
}

// ─── Action Execution ─────────────────────────────────────────────────────────

export type ActionStatus = 'pending' | 'running' | 'applied' | 'failed' | 'skipped'

export interface ActionSession {
  id: string
  request: ChangeRequest
  proposedByAgentId: string
  proposedByAgentName: string
  status: ActionStatus
  result?: string
  error?: string
  createdAt: string
  completedAt?: string
}

// ─── Verification ────────────────────────────────────────────────────────────

export type VerificationStatus = 'complete' | 'continue' | 'ask_user' | 'blocked'
export type VerificationRisk = 'low' | 'medium' | 'high'

export interface VerificationSession {
  id: string
  status: VerificationStatus
  reason: string
  remainingCriteria: string[]
  nextFocus: string
  risk: VerificationRisk
  round: number
  createdAt: string
}

// ─── User Clarification ───────────────────────────────────────────────────────

export type ClarificationStatus = 'pending' | 'answered' | 'dismissed'

export interface ClarificationSession {
  id: string
  question: string
  options: string[]
  reason: string
  requestedByAgentId: string
  requestedByAgentName: string
  status: ClarificationStatus
  answer?: string
  createdAt: string
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'agent' | 'system'

export interface MeetingMessage {
  id: string
  role: MessageRole
  agentId?: string
  agentName?: string
  content: string
  /** Snapshot of the action session at the time of the message, for display. */
  actionSnapshot?: ActionSession
  createdAt: string
}

// ─── Agent State ──────────────────────────────────────────────────────────────

export type AgentStatus = 'idle' | 'thinking' | 'blocked'

export interface AgentDefinition {
  id: string
  name: string
  role: AgentRole
  brief: string
  defaultModelRole: 'chapterPlanner' | 'proofreader' | 'proposerAgent'
  systemPrompt: string
  custom?: boolean
}

export interface AgentState extends AgentDefinition {
  enabled: boolean
  status: AgentStatus
  modelValue: string
  customSystemPrompt: string
  /** Rolling private memory, last 12 entries. */
  privateMemory: string[]
  /** Index into messages[] of the last message this agent has seen. */
  lastSeenMessageIndex: number
}

// ─── Phase State ──────────────────────────────────────────────────────────────

export interface PhaseState {
  phase: MeetingPhase
  /** How many discussion turns have happened in the current discussion phase. */
  discussionTurns: number
  /** Max discussion turns before forcing synthesis (= enabledAgents * 2). */
  maxDiscussionTurns: number
  /** Number of consecutive synthesis attempts without a concrete action. */
  synthesisAttempts: number
  /** The current meeting focus/topic. */
  focus: string
}

// ─── Meeting Context ──────────────────────────────────────────────────────────

export type ContextElement =
  | 'story-config'
  | 'master-outline'
  | 'characters'
  | 'knowledge-base'
  | 'selected-chapter'
  | 'chapter-plan'
  | 'chapter-plan-overview'
  | 'chapter-draft'

export interface MeetingContext {
  project: StoryProject | null | undefined
  chapter: Chapter | null | undefined
  outline: string
  characters: string
}

// ─── Full Meeting State (persisted) ──────────────────────────────────────────

export interface MeetingState {
  phase: PhaseState
  agents: AgentState[]
  messages: MeetingMessage[]
  actionSession: ActionSession | null
  clarificationSession: ClarificationSession | null
  verificationSession: VerificationSession | null
  selectedContextElements: ContextElement[]
  autoContinue: boolean
  maxAutoRounds: number
  roundCount: number
  meetingEnded: boolean
}
