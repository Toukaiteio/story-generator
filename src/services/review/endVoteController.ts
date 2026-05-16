import type { Ref } from 'vue'
import { providerManager } from '@/services/provider'
import type { ToolDefinition } from '@/services/provider'
import { decodeProviderModelRef } from '@/services/provider/catalog'
import type { ProviderModelRef } from '@/types/provider'
import type {
  MultiAgentReviewContext,
  ReviewAgentState,
  ReviewAskUserRequest,
  ReviewAskUserSession,
  ReviewEndVote,
  ReviewEndVoteSession,
  ReviewPublicMessage,
} from './types'
import { parseAskUserVote, parseEndVote, stripReasoningText } from './utils'
import { buildAskUserVoteMessages, buildEndVoteMessages } from './context'

const END_VOTE_TOOLS: ToolDefinition[] = [
  {
    name: 'submit_end_vote',
    description: 'Submit your vote for ending the meeting.',
    parameters: {
      type: 'object',
      properties: {
        vote: { type: 'string', enum: ['approve', 'reject', 'yes', 'no'] },
        reason: { type: 'string' },
      },
      required: ['vote', 'reason'],
    },
  },
]

const ASK_USER_VOTE_TOOLS: ToolDefinition[] = [
  {
    name: 'submit_ask_user_vote',
    description: 'Submit your vote on whether user clarification is required.',
    parameters: {
      type: 'object',
      properties: {
        vote: { type: 'string', enum: ['approve', 'reject', 'yes', 'no'] },
        reason: { type: 'string' },
      },
      required: ['vote', 'reason'],
    },
  },
]

function normalizeVoteToken(value: unknown): 'approve' | 'reject' {
  const token = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return token === 'approve' || token === 'yes' ? 'approve' : 'reject'
}

function parseEndVoteFromToolCalls(toolCalls: Array<{ name: string; arguments: Record<string, any> }>) {
  const call = [...toolCalls].reverse().find(item => item.name === 'submit_end_vote')
  if (!call) return null
  const vote = normalizeVoteToken(call.arguments?.vote)
  const reason = typeof call.arguments?.reason === 'string' && call.arguments.reason.trim()
    ? call.arguments.reason.trim()
    : vote === 'approve'
      ? 'The agent agrees the meeting goal is resolved.'
      : 'The agent thinks unresolved issues remain.'
  return { vote, reason }
}

function parseAskUserVoteFromToolCalls(toolCalls: Array<{ name: string; arguments: Record<string, any> }>) {
  const call = [...toolCalls].reverse().find(item => item.name === 'submit_ask_user_vote')
  if (!call) return null
  const vote = normalizeVoteToken(call.arguments?.vote)
  const reason = typeof call.arguments?.reason === 'string' && call.arguments.reason.trim()
    ? call.arguments.reason.trim()
    : vote === 'approve'
      ? 'Clarification is needed.'
      : 'Clarification is not necessary.'
  return { vote, reason }
}

interface ProviderStoreLike {
  providers: any[]
  getAvailableModelRefForRole: (role: any, preferred?: ProviderModelRef | null) => ProviderModelRef | null
  getDefaultModelRefForRole: (role: any) => ProviderModelRef | null
}

interface EndVoteControllerDeps {
  context: () => MultiAgentReviewContext
  providerStore: ProviderStoreLike
  agents: Ref<ReviewAgentState[]>
  messages: Ref<ReviewPublicMessage[]>
  currentFocus: Ref<string>
  selectedContextElements: Ref<any[]>
  endVoteSession: Ref<ReviewEndVoteSession | null>
  askUserSession: Ref<ReviewAskUserSession | null>
  meetingEnded: Ref<boolean>
  activeAbortControllers: Map<string, AbortController>
  inputText: Ref<string>
  addSystemMessage: (content: string) => void
  setAgentStatus: (agentId: string, status: ReviewAgentState['status'], waitingForTurn?: boolean) => void
  scheduleSave: () => void
  createId: (prefix: string) => string
  stopActiveTurns: () => void
  requestAllAgents: (focus?: string, options?: { mandatoryBrainstorm?: boolean; resetTurnCount?: boolean; agentFilter?: (agent: ReviewAgentState) => boolean }) => void
  sendUserMessage: () => Promise<void>
  cancelActiveTurnsExcept: (agentId: string) => void
}

export function createEndVoteController(deps: EndVoteControllerDeps) {
  function requestEndVote(agent: ReviewAgentState, reason: string) {
    if (deps.endVoteSession.value?.status === 'voting') return
    deps.cancelActiveTurnsExcept(agent.id)
    const session: ReviewEndVoteSession = {
      id: deps.createId('end-vote'),
      requestedByAgentId: agent.id,
      requestedByAgentName: agent.name,
      reason,
      status: 'voting',
      votes: [],
      createdAt: new Date().toISOString(),
    }
    deps.endVoteSession.value = session
    deps.addSystemMessage(`${agent.name} requested ending the meeting. All enabled agents will vote before the user decides.`)
    deps.scheduleSave()
    setTimeout(() => {
      void runEndVoteSession(session.id)
    }, 0)
  }

  async function runEndVoteForAgent(agent: ReviewAgentState, sessionId: string) {
    const session = deps.endVoteSession.value
    if (!session || session.id !== sessionId || !agent.enabled || deps.meetingEnded.value) return

    providerManager.setProviders(deps.providerStore.providers)
    const preferred = decodeProviderModelRef(agent.modelValue)
    const model = deps.providerStore.getAvailableModelRefForRole(agent.defaultModelRole, preferred)
      ?? deps.providerStore.getAvailableModelRefForRole('chapterPlanner')
      ?? deps.providerStore.getAvailableModelRefForRole('proofreader')
      ?? deps.providerStore.getDefaultModelRefForRole(agent.defaultModelRole)

    if (!model) {
      const vote: ReviewEndVote = {
        agentId: agent.id,
        agentName: agent.name,
        vote: 'reject',
        reason: 'No model is configured for this agent, so it cannot approve ending the meeting.',
        createdAt: new Date().toISOString(),
      }
      session.votes.push(vote)
      deps.messages.value.push({
        id: deps.createId('agent'),
        role: 'agent',
        agentId: agent.id,
        agentName: agent.name,
        content: `[End vote: Reject]\n${vote.reason}`,
        createdAt: vote.createdAt,
      })
      deps.setAgentStatus(agent.id, 'idle', false)
      return
    }

    const abortController = new AbortController()
    deps.activeAbortControllers.set(agent.id, abortController)
    deps.setAgentStatus(agent.id, 'speaking', false)

    try {
      const response = await providerManager.chatWithTools(
        buildEndVoteMessages(agent, deps.messages.value, deps.context(), deps.currentFocus.value, deps.selectedContextElements.value, session),
        model,
        END_VOTE_TOOLS,
        700,
        0.2,
        { toolChoice: 'auto' },
        abortController.signal
      )
      if (deps.endVoteSession.value?.id !== sessionId || abortController.signal.aborted) return
      const parsed = parseEndVoteFromToolCalls(response.tool_calls)
        ?? parseEndVote(stripReasoningText(response.content || ''))
      const vote: ReviewEndVote = {
        agentId: agent.id,
        agentName: agent.name,
        vote: parsed.vote,
        reason: parsed.reason,
        createdAt: new Date().toISOString(),
      }
      deps.endVoteSession.value.votes.push(vote)
      deps.messages.value.push({
        id: deps.createId('agent'),
        role: 'agent',
        agentId: agent.id,
        agentName: agent.name,
        content: `[End vote: ${vote.vote === 'approve' ? 'Approve' : 'Reject'}]\n${vote.reason}`,
        createdAt: vote.createdAt,
      })
      agent.privateMemory = [
        ...agent.privateMemory,
        `End vote ${new Date().toLocaleString()}: ${vote.vote}. ${vote.reason.slice(0, 500)}`,
      ].slice(-12)
      agent.lastSeenMessageIndex = deps.messages.value.length
      deps.setAgentStatus(agent.id, 'idle', false)
    } catch (error: any) {
      if (abortController.signal.aborted || error?.name === 'AbortError') return
      const vote: ReviewEndVote = {
        agentId: agent.id,
        agentName: agent.name,
        vote: 'reject',
        reason: error?.message ? `Vote failed: ${error.message}` : 'Vote failed, so the agent cannot approve ending.',
        createdAt: new Date().toISOString(),
      }
      if (deps.endVoteSession.value?.id === sessionId) deps.endVoteSession.value.votes.push(vote)
      deps.addSystemMessage(`${agent.name} failed to vote: ${vote.reason}`)
      deps.setAgentStatus(agent.id, 'blocked', false)
    } finally {
      deps.activeAbortControllers.delete(agent.id)
      if (agent.status === 'speaking') deps.setAgentStatus(agent.id, 'idle', false)
      deps.scheduleSave()
    }
  }

  async function runEndVoteSession(sessionId: string) {
    const voters = deps.agents.value.filter(agent => agent.enabled)
    for (const agent of voters) {
      if (deps.endVoteSession.value?.id !== sessionId || deps.endVoteSession.value.status !== 'voting') return
      deps.setAgentStatus(agent.id, 'waiting', true)
      await runEndVoteForAgent(agent, sessionId)
    }
    if (deps.endVoteSession.value?.id !== sessionId) return
    deps.endVoteSession.value.status = 'ready'
    deps.endVoteSession.value.completedAt = new Date().toISOString()
    deps.addSystemMessage('Agent end-vote is complete. User decision is required.')
    deps.scheduleSave()
  }

  function approveEndVoteSession() {
    if (!deps.endVoteSession.value) return
    const session = deps.endVoteSession.value
    deps.endVoteSession.value = null
    deps.stopActiveTurns()
    deps.meetingEnded.value = true
    deps.addSystemMessage(`User approved ending the meeting after agent vote. Original request: ${session.reason}`)
    deps.scheduleSave()
  }

  function rejectEndVoteSession(reason?: string) {
    if (!deps.endVoteSession.value) return false
    const clean = reason?.trim()
    if (!clean) return false
    deps.endVoteSession.value = null
    deps.meetingEnded.value = false
    deps.addSystemMessage(`User rejected ending the meeting: ${clean}`)
    deps.scheduleSave()
    deps.requestAllAgents(`The user rejected ending the meeting because: ${clean}. Continue the meeting and address the unresolved issue before any new end request.`, { mandatoryBrainstorm: false })
    return true
  }

  function requestAskUserVote(agent: ReviewAgentState, request: ReviewAskUserRequest) {
    if (deps.askUserSession.value?.status === 'voting' || deps.askUserSession.value?.status === 'ready') return
    const session: ReviewAskUserSession = {
      id: deps.createId('ask-user'),
      requestedByAgentId: agent.id,
      requestedByAgentName: agent.name,
      request,
      status: 'voting',
      votes: [],
      createdAt: new Date().toISOString(),
    }
    deps.askUserSession.value = session
    deps.addSystemMessage(`${agent.name} requested user clarification. All enabled agents will vote before showing it to the user.`)
    deps.scheduleSave()
    setTimeout(() => {
      void runAskUserVoteSession(session.id)
    }, 0)
  }

  async function runAskUserVoteForAgent(agent: ReviewAgentState, sessionId: string) {
    const session = deps.askUserSession.value
    if (!session || session.id !== sessionId || !agent.enabled) return
    providerManager.setProviders(deps.providerStore.providers)
    const preferred = decodeProviderModelRef(agent.modelValue)
    const model = deps.providerStore.getAvailableModelRefForRole(agent.defaultModelRole, preferred)
      ?? deps.providerStore.getAvailableModelRefForRole('chapterPlanner')
      ?? deps.providerStore.getAvailableModelRefForRole('proofreader')
      ?? deps.providerStore.getDefaultModelRefForRole(agent.defaultModelRole)
    if (!model) {
      session.votes.push({ agentId: agent.id, agentName: agent.name, vote: 'reject', reason: 'No model configured for this agent.', createdAt: new Date().toISOString() })
      return
    }
    const abortController = new AbortController()
    deps.activeAbortControllers.set(agent.id, abortController)
    deps.setAgentStatus(agent.id, 'speaking', false)
    try {
      const response = await providerManager.chatWithTools(
        buildAskUserVoteMessages(agent, deps.messages.value, deps.context(), session),
        model,
        ASK_USER_VOTE_TOOLS,
        500,
        0.2,
        { toolChoice: 'auto' },
        abortController.signal
      )
      if (deps.askUserSession.value?.id !== sessionId || abortController.signal.aborted) return
      const parsed = parseAskUserVoteFromToolCalls(response.tool_calls)
        ?? parseAskUserVote(stripReasoningText(response.content || ''))
      deps.askUserSession.value.votes.push({ agentId: agent.id, agentName: agent.name, vote: parsed.vote, reason: parsed.reason, createdAt: new Date().toISOString() })
    } catch (error: any) {
      if (abortController.signal.aborted || error?.name === 'AbortError') return
      deps.askUserSession.value?.votes.push({ agentId: agent.id, agentName: agent.name, vote: 'reject', reason: error?.message || 'Clarification vote failed.', createdAt: new Date().toISOString() })
    } finally {
      deps.activeAbortControllers.delete(agent.id)
      if (agent.status === 'speaking') deps.setAgentStatus(agent.id, 'idle', false)
      deps.scheduleSave()
    }
  }

  async function runAskUserVoteSession(sessionId: string) {
    const voters = deps.agents.value.filter(agent => agent.enabled)
    for (const agent of voters) {
      if (deps.askUserSession.value?.id !== sessionId || deps.askUserSession.value.status !== 'voting') return
      await runAskUserVoteForAgent(agent, sessionId)
    }
    const session = deps.askUserSession.value
    if (!session || session.id !== sessionId) return
    const allApproved = voters.length > 0 && session.votes.length >= voters.length && session.votes.every(vote => vote.vote === 'approve')
    if (allApproved) {
      deps.askUserSession.value = { ...session, status: 'ready', completedAt: new Date().toISOString() }
      deps.addSystemMessage('All agents agreed that user clarification is needed.')
    } else {
      deps.askUserSession.value = { ...session, status: 'rejected', completedAt: new Date().toISOString() }
      deps.addSystemMessage('User clarification request was rejected by at least one agent. Continuing the meeting.')
      deps.requestAllAgents('A clarification request was rejected. Continue using existing context and decide the best next action without asking the user unless a new clarification is truly necessary.', { mandatoryBrainstorm: false })
    }
    deps.scheduleSave()
  }

  async function answerAskUser(option: string) {
    const session = deps.askUserSession.value
    if (!session || session.status !== 'ready') return
    deps.askUserSession.value = { ...session, status: 'answered', completedAt: new Date().toISOString() }
    deps.inputText.value = option
    await deps.sendUserMessage()
  }

  return {
    requestEndVote,
    approveEndVoteSession,
    rejectEndVoteSession,
    requestAskUserVote,
    answerAskUser,
  }
}
