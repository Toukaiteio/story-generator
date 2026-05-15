import type { Ref } from 'vue'
import { providerManager } from '@/services/provider'
import { decodeProviderModelRef } from '@/services/provider/catalog'
import type { ProviderModelRef } from '@/types/provider'
import type {
  MultiAgentReviewContext,
  ReviewAgentState,
  ReviewAskUserRequest,
  ReviewChangeRequest,
  ReviewProposal,
  ReviewPublicMessage,
  ReviewSpeechRequest,
} from './types'
import {
  extractAskUserRequest,
  extractChangeRequests,
  extractEndRequest,
  extractFocusProposal,
  extractPublicAgentMessage,
  extractTurnRequests,
  normalizeChangeAction,
  stripReasoningText,
} from './utils'
import { buildAgentMessages } from './context'

interface ProviderStoreLike {
  providers: any[]
  getAvailableModelRefForRole: (role: any, preferred?: ProviderModelRef | null) => ProviderModelRef | null
  getDefaultModelRefForRole: (role: any) => ProviderModelRef | null
}

interface AgentTurnControllerDeps {
  context: () => MultiAgentReviewContext
  providerStore: ProviderStoreLike
  agents: Ref<ReviewAgentState[]>
  messages: Ref<ReviewPublicMessage[]>
  currentFocus: Ref<string>
  selectedContextElements: Ref<any[]>
  pendingProposal: Ref<ReviewProposal | null>
  pendingChangeRequests: Ref<Array<{ agent: ReviewAgentState; request: ReviewChangeRequest }>>
  mandatoryBrainstormActive: Ref<boolean>
  brainstormRoundCompleted: Ref<boolean>
  openDiscussionTurnCount: Ref<number>
  activeAbortControllers: Map<string, AbortController>
  activeSpeakerIds: Ref<string[]>
  loading: Ref<boolean>
  runGeneration: Ref<number>
  addSystemMessage: (content: string) => void
  createId: (prefix: string) => string
  setAgentStatus: (agentId: string, status: ReviewAgentState['status'], waitingForTurn?: boolean) => void
  requestTurn: (agentId: string, focus?: string, requestedBy?: ReviewSpeechRequest['requestedBy'], options?: { forceNext?: boolean }) => void
  requestAllAgents: (focus?: string, options?: { mandatoryBrainstorm?: boolean; resetTurnCount?: boolean; agentFilter?: (agent: ReviewAgentState) => boolean }) => void
  cancelActiveTurnsExcept: (agentId: string) => void
  requestEndVote: (agent: ReviewAgentState, reason: string) => void
  requestAskUserVote: (agent: ReviewAgentState, request: ReviewAskUserRequest) => void
  requestChangeVote: (agent: ReviewAgentState, request: ReviewChangeRequest) => void
  scheduleSave: () => void
  getMaxContextTurns: () => number
}

function normalizeChangeRequestCompat(request: ReviewChangeRequest | null | undefined): ReviewChangeRequest | null {
  if (!request) return null
  return {
    ...request,
    action: normalizeChangeAction((request as any).action),
  }
}

export function createAgentTurnController(deps: AgentTurnControllerDeps) {
  async function runAgentTurn(agent: ReviewAgentState, request: ReviewSpeechRequest) {
    const generation = deps.runGeneration.value
    providerManager.setProviders(deps.providerStore.providers)
    const preferred = decodeProviderModelRef(agent.modelValue)
    const model = deps.providerStore.getAvailableModelRefForRole(agent.defaultModelRole, preferred)
      ?? deps.providerStore.getAvailableModelRefForRole('chapterPlanner')
      ?? deps.providerStore.getAvailableModelRefForRole('proofreader')
      ?? deps.providerStore.getDefaultModelRefForRole(agent.defaultModelRole)
    if (!model) {
      deps.setAgentStatus(agent.id, 'blocked', false)
      agent.toolState.error = 'No model available for multi-agent review.'
      deps.addSystemMessage(`${agent.name} is blocked: no available model is configured.`)
      return
    }

    const isMandatoryBrainstormTurn = deps.mandatoryBrainstormActive.value && !deps.brainstormRoundCompleted.value
    if (!isMandatoryBrainstormTurn && request.requestedBy !== 'user') {
      const enabledAgentCount = deps.agents.value.filter(item => item.enabled).length
      if (deps.openDiscussionTurnCount.value >= enabledAgentCount * 3) {
        deps.addSystemMessage('System Intervention: open discussion exceeded the normal limit without a concrete tool action. The next turns must converge to a proposal, clarification request, focus proposal, or end request.')
        return
      }
      deps.openDiscussionTurnCount.value++
    }

    const beforeIndex = deps.messages.value.length
    const chatMessages = buildAgentMessages(
      agent,
      deps.messages.value,
      deps.context(),
      request.focus || deps.currentFocus.value,
      deps.selectedContextElements.value,
      request,
      {
        mandatoryBrainstorm: isMandatoryBrainstormTurn,
        openDiscussionTurnCount: deps.openDiscussionTurnCount.value,
        enabledAgentCount: deps.agents.value.filter(item => item.enabled).length,
        maxContextTurns: deps.getMaxContextTurns(),
      },
    )
    const abortController = new AbortController()
    deps.activeAbortControllers.set(agent.id, abortController)
    deps.setAgentStatus(agent.id, 'speaking', false)
    if (!deps.activeSpeakerIds.value.includes(agent.id)) {
      deps.activeSpeakerIds.value.push(agent.id)
    }
    deps.loading.value = true

    try {
      const content = await providerManager.chat(chatMessages, model, 1400, 0.45, abortController.signal)
      if (generation !== deps.runGeneration.value) return
      const clean = stripReasoningText(content) || 'No concrete review notes.'
      const proposal = extractFocusProposal(agent, clean)
      const endRequestReason = extractEndRequest(clean)
      const askUserRequest = extractAskUserRequest(clean)
      const changeRequests = extractChangeRequests(clean)
      const turnRequests = extractTurnRequests(clean)
      const publicMessage = extractPublicAgentMessage(clean)
      if (publicMessage) {
        deps.messages.value.push({
          id: deps.createId('agent'),
          role: 'agent',
          agentId: agent.id,
          agentName: agent.name,
          content: publicMessage,
          createdAt: new Date().toISOString(),
        })
      }

      if (!isMandatoryBrainstormTurn && turnRequests.length > 0) {
        for (const target of turnRequests) {
          if (target === 'self') {
            deps.requestTurn(agent.id)
          } else if (target.toLowerCase() === 'all') {
            deps.requestAllAgents(deps.currentFocus.value, { mandatoryBrainstorm: false })
          } else {
            const targetAgent = deps.agents.value.find(item => item.id === target || item.name.toLowerCase().includes(target.toLowerCase()))
            if (targetAgent) {
              deps.requestTurn(targetAgent.id)
            }
          }
        }
      }
      if (proposal && isMandatoryBrainstormTurn) {
        deps.addSystemMessage(`${agent.name} attempted a focus proposal during mandatory brainstorm. It will be reconsidered after the brainstorm round.`)
      } else if (proposal) {
        deps.cancelActiveTurnsExcept(agent.id)
        deps.pendingProposal.value = proposal
        deps.addSystemMessage(`${agent.name} created a proposal that requires user approval.`)
      }
      if (endRequestReason && isMandatoryBrainstormTurn) {
        deps.addSystemMessage(`${agent.name} attempted to request ending during mandatory brainstorm. End requests are disabled until open discussion starts.`)
      } else if (endRequestReason) {
        deps.requestEndVote(agent, endRequestReason)
      }
      if (askUserRequest && isMandatoryBrainstormTurn) {
        deps.addSystemMessage(`${agent.name} attempted to ask the user during mandatory brainstorm. Clarification requests can be raised after open discussion starts.`)
      } else if (askUserRequest) {
        deps.requestAskUserVote(agent, askUserRequest)
      }
      if (changeRequests.length) {
        for (const changeRequest of changeRequests) {
          const normalizedChangeRequest = normalizeChangeRequestCompat(changeRequest)
          if (!normalizedChangeRequest) continue
          if (isMandatoryBrainstormTurn) {
            deps.pendingChangeRequests.value.push({ agent, request: normalizedChangeRequest })
            deps.addSystemMessage(`${agent.name} attempted a proposal during mandatory brainstorm. It was queued until the brainstorm round completes.`)
          } else {
            deps.requestChangeVote(agent, normalizedChangeRequest)
          }
        }
      }
      agent.privateMemory = [
        ...agent.privateMemory,
        `Turn ${new Date().toLocaleString()}: ${clean.slice(0, 700)}`,
      ].slice(-12)
      agent.lastSeenMessageIndex = deps.messages.value.length
      agent.workspaceState = {
        ...agent.workspaceState,
        lastInputMessageCount: beforeIndex,
        lastFocus: request.focus || deps.currentFocus.value,
        lastRequestSource: request.requestedBy,
      }
      deps.setAgentStatus(agent.id, 'idle', false)
    } catch (error: any) {
      if (generation !== deps.runGeneration.value || abortController.signal.aborted || error?.name === 'AbortError') return
      agent.toolState.error = error?.message || 'Agent turn failed'
      deps.addSystemMessage(`${agent.name} failed to speak: ${agent.toolState.error}`)
      deps.setAgentStatus(agent.id, 'blocked', false)
    } finally {
      deps.activeAbortControllers.delete(agent.id)
      if (generation !== deps.runGeneration.value) return
      deps.activeSpeakerIds.value = deps.activeSpeakerIds.value.filter(id => id !== agent.id)
      deps.loading.value = deps.activeSpeakerIds.value.length > 0
      deps.scheduleSave()
    }
  }

  return {
    runAgentTurn,
  }
}
