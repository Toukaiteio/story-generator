/**
 * multiAgentReview.ts — v1 compatibility shim
 *
 * Wraps the v2 useMeeting composable and exposes the same API surface
 * that MultiAgentReviewChat.vue and other consumers expect.
 */

import { computed, ref } from 'vue'
import { useMeeting } from './v2/useMeeting'
import type { MeetingContext } from './v2/types'

// Re-export types from the canonical locations
export type {
  ReviewAgentStatus,
  ReviewMessageRole,
  ReviewContextElement,
  ReviewSpeechRequest,
  ReviewProposal,
  ReviewEndVoteValue,
  ReviewEndVote,
  ReviewEndVoteSession,
  ReviewAskUserRequest,
  ReviewAskUserSession,
  ReviewChangeTarget,
  ReviewChangeRequest,
  ReviewChangeAmendment,
  ReviewActionVote,
  ReviewActionVoteSession,
  ReviewAgentDefinition,
  ReviewAgentState,
  ReviewPublicMessage,
  MultiAgentReviewContext,
} from './types'
export { reviewAgentDefinitions } from './definitions'

export function useMultiAgentReviewChat(context: () => MeetingContext) {
  const meeting = useMeeting(context)

  // ── v1 compatibility shims ─────────────────────────────────────────────────

  // Wrap v2 AgentState[] into ReviewAgentState[]-compatible objects.
  const agents = computed(() =>
    meeting.agents.value.map(a => ({
      ...a,
      status: (a.status === 'thinking' ? 'speaking' : a.status) as import('./types').ReviewAgentStatus,
      waitingForTurn: false,
      workspaceState: {},
      toolState: { requestSpeech: (a.status === 'thinking' ? 'speaking' : a.status) as import('./types').ReviewAgentStatus },
    }))
  )

  // v1 speaking queue → v2 activeAgentIds
  const speakingQueue = computed(() =>
    meeting.activeAgentIds.value.map(id => ({
      id: `turn-${id}`,
      agentId: id,
      requestedBy: 'agent' as const,
      focus: meeting.phase.value.focus,
      createdAt: new Date().toISOString(),
    }))
  )

  const pendingProposal = ref(null)
  const endVoteSession = ref(null)

  // v1 askUserSession → v2 clarificationSession
  const askUserSession = computed(() => {
    const s = meeting.clarificationSession.value
    if (!s) return null
    return {
      id: s.id,
      requestedByAgentId: s.requestedByAgentId,
      requestedByAgentName: s.requestedByAgentName,
      request: { question: s.question, options: s.options, reason: s.reason },
      status: s.status === 'pending' ? 'ready' as const : s.status === 'answered' ? 'answered' as const : 'rejected' as const,
      votes: [],
      createdAt: s.createdAt,
    }
  })

  // v1 actionVoteSession → v2 actionSession
  const actionVoteSession = computed(() => {
    const s = meeting.actionSession.value
    if (!s) return null
    return {
      id: s.id,
      requestedByAgentId: s.proposedByAgentId,
      requestedByAgentName: s.proposedByAgentName,
      request: s.request as any,
      status: s.status === 'running' ? 'applying' as const
        : s.status === 'applied' ? 'applied' as const
        : s.status === 'failed' ? 'failed' as const
        : 'rejected' as const,
      votes: [],
      result: s.result,
      error: s.error,
      createdAt: s.createdAt,
      completedAt: s.completedAt,
      executionTimeline: [],
      executionLedger: [],
    }
  })

  const currentFocus = computed({
    get: () => meeting.phase.value.focus,
    set: (v: string) => { meeting.phase.value = { ...meeting.phase.value, focus: v } },
  })

  const activeSpeakerIds = meeting.activeAgentIds
  const userTyping = ref(false)

  // ── v1 API methods ─────────────────────────────────────────────────────────

  function requestTurn(agentId: string, focus?: string) {
    if (focus) meeting.phase.value = { ...meeting.phase.value, focus }
  }

  function requestAllAgents(focus?: string, _options?: any) {
    if (focus) meeting.phase.value = { ...meeting.phase.value, focus }
    void meeting.startMeeting(focus)
  }

  function requestAllAgentsSequentially(focus?: string) {
    requestAllAgents(focus)
  }

  function userRequestTurn(agentId: string, instruction?: string) {
    void meeting.sendUserMessage(instruction || `Please ask ${agentId} to speak next.`)
  }

  function handleInput(value: string) {
    meeting.inputText.value = value
  }

  async function sendUserMessage() {
    const content = meeting.inputText.value.trim()
    if (!content) return
    await meeting.sendUserMessage(content)
  }

  function approveProposal() { pendingProposal.value = null }
  function rejectProposal(_reason?: string) { pendingProposal.value = null }
  function approveEndVoteSession() { meeting.endMeeting('Meeting ended by user approval.') }
  function rejectEndVoteSession(_reason?: string) { endVoteSession.value = null }
  function answerAskUser(answer: string) { void meeting.answerClarification(answer) }
  function dismissChangeVoteSession() { meeting.dismissActionSession() }

  // ── Return ─────────────────────────────────────────────────────────────────

  return {
    agents,
    messages: meeting.messages,
    speakingQueue,
    activeSpeakerIds,
    currentFocus,
    selectedContextElements: meeting.selectedContextElements,
    pendingProposal,
    endVoteSession,
    askUserSession,
    actionVoteSession,
    verificationSession: meeting.verificationSession,
    meetingEnded: meeting.meetingEnded,
    inputText: meeting.inputText,
    userTyping,
    loading: meeting.loading,
    loaded: meeting.loaded,
    autoContinue: meeting.autoContinue,
    maxAutoRounds: meeting.maxAutoRounds,
    roundCount: meeting.roundCount,
    taskGoal: meeting.taskGoal,
    requestTurn,
    requestAllAgents,
    requestAllAgentsSequentially,
    userRequestTurn,
    addAgent: meeting.addAgent,
    setAgentEnabled: meeting.setAgentEnabled,
    deleteAgent: meeting.deleteAgent,
    restoreDefaultAgents: meeting.restoreDefaultAgents,
    reorderAgents: meeting.reorderAgents,
    handleInput,
    sendUserMessage,
    setContextElement: meeting.setContextElement,
    setAutoContinue: meeting.setAutoContinue,
    setMaxAutoRounds: meeting.setMaxAutoRounds,
    updateAgentSettings: meeting.updateAgentSettings,
    approveProposal,
    rejectProposal,
    approveEndVoteSession,
    rejectEndVoteSession,
    answerAskUser,
    dismissChangeVoteSession,
    stopActiveTurns: meeting.stopMeeting,
    endMeeting: (reason?: string, _extra?: any) => meeting.endMeeting(reason),
    clearConversation: meeting.clearConversation,
  }
}
