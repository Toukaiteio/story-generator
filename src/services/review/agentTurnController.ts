import type { Ref } from 'vue'
import { providerManager } from '@/services/provider'
import type { ToolDefinition } from '@/services/provider'
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
  inferImplicitChangeRequest,
  normalizeChangeAction,
  stripReasoningText,
} from './utils'
import { buildAgentMessages } from './context'

const MEETING_AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'send_public_message',
    description: 'Publish a message to the shared meeting chat visible to the user and all agents.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Public message content.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'request_project_action',
    description: 'Propose a concrete project data action (read/create/update/delete) for vote.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['master-outline', 'chapter-plan', 'characters', 'consensus'] },
        action: { type: 'string', enum: ['create', 'read', 'update', 'delete'] },
        scope: { type: 'string' },
        purpose: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['target', 'action', 'scope', 'purpose', 'content'],
    },
  },
  {
    name: 'propose_focus',
    description: 'Propose a new meeting focus that requires user approval.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Proposed new focus sentence.' },
        reason: { type: 'string', description: 'Why this focus improves progress.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'request_end_meeting',
    description: 'Request ending the meeting. This triggers end voting flow.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
      },
      required: ['reason'],
    },
  },
  {
    name: 'ask_user_clarification',
    description: 'Request a clarification question to the user (will be voted by agents first).',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        options: { type: 'array', items: { type: 'string' } },
        reason: { type: 'string' },
      },
      required: ['question', 'options', 'reason'],
    },
  },
  {
    name: 'call_agent',
    description: 'Request another agent to speak next. Use target="all" to request all agents.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string' },
      },
      required: ['target'],
    },
  },
  {
    name: 'request_speech',
    description: 'Request another speaking turn for yourself.',
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string' },
      },
      required: [],
    },
  },
]

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

function asNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function normalizeToolChangeRequest(args: Record<string, any>): ReviewChangeRequest | null {
  const targetRaw = asNonEmptyString(args.target)
  const target = targetRaw === 'master-outline' || targetRaw === 'chapter-plan' || targetRaw === 'characters' || targetRaw === 'consensus'
    ? targetRaw
    : null
  if (!target) return null
  const action = normalizeChangeAction(args.action)
  const scope = asNonEmptyString(args.scope)
  const purpose = asNonEmptyString(args.purpose)
  const content = asNonEmptyString(args.content) || (action === 'read' ? 'N/A' : '')
  if (!scope || !purpose || !content) return null
  return { target, action, scope, purpose, content }
}

function normalizeToolAskUserRequest(args: Record<string, any>): ReviewAskUserRequest | null {
  const question = asNonEmptyString(args.question)
  const reason = asNonEmptyString(args.reason)
  const options = Array.isArray(args.options)
    ? args.options.map(item => asNonEmptyString(item)).filter(Boolean)
    : asNonEmptyString(args.options)
      ? asNonEmptyString(args.options).split(/\r?\n|[|]/).map(item => item.trim()).filter(Boolean)
      : []
  if (!question || options.length < 2 || !reason) return null
  return { question, options: options.slice(0, 6), reason }
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
      const toolResponse = await providerManager.chatWithTools(
        chatMessages,
        model,
        MEETING_AGENT_TOOLS,
        1400,
        0.45,
        { toolChoice: 'auto' },
        abortController.signal
      )
      if (generation !== deps.runGeneration.value) return
      const clean = stripReasoningText(toolResponse.content || '') || 'No concrete review notes.'

      const toolPublicMessages: string[] = []
      const toolTurnRequests: string[] = []
      const toolChangeRequests: ReviewChangeRequest[] = []
      let toolProposal: ReviewProposal | null = null
      let toolEndRequestReason = ''
      let toolAskUserRequest: ReviewAskUserRequest | null = null

      for (const toolCall of toolResponse.tool_calls) {
        const args = toolCall.arguments || {}
        if (toolCall.name === 'send_public_message') {
          const message = asNonEmptyString(args.content)
          if (message) toolPublicMessages.push(message)
          continue
        }
        if (toolCall.name === 'request_project_action') {
          const requestFromTool = normalizeToolChangeRequest(args)
          if (requestFromTool) toolChangeRequests.push(requestFromTool)
          continue
        }
        if (toolCall.name === 'propose_focus') {
          const focus = asNonEmptyString(args.content)
          if (focus) {
            toolProposal = {
              id: deps.createId('proposal'),
              type: 'focus',
              agentId: agent.id,
              agentName: agent.name,
              content: focus,
              reason: asNonEmptyString(args.reason) || 'Agent proposed updating the meeting focus.',
              createdAt: new Date().toISOString(),
            }
          }
          continue
        }
        if (toolCall.name === 'request_end_meeting') {
          const reason = asNonEmptyString(args.reason)
          if (reason) toolEndRequestReason = reason
          continue
        }
        if (toolCall.name === 'ask_user_clarification') {
          const parsed = normalizeToolAskUserRequest(args)
          if (parsed) toolAskUserRequest = parsed
          continue
        }
        if (toolCall.name === 'call_agent') {
          const target = asNonEmptyString(args.target)
          if (target) toolTurnRequests.push(target)
          continue
        }
        if (toolCall.name === 'request_speech') {
          toolTurnRequests.push('self')
        }
      }

      const proposal = toolProposal ?? extractFocusProposal(agent, clean)
      const endRequestReason = toolEndRequestReason || extractEndRequest(clean)
      const askUserRequest = toolAskUserRequest ?? extractAskUserRequest(clean)
      const explicitChangeRequests = toolChangeRequests.length ? toolChangeRequests : extractChangeRequests(clean)
      const inferredChangeRequest =
        !explicitChangeRequests.length
        && !isMandatoryBrainstormTurn
        && agent.id !== 'proposer'
          ? inferImplicitChangeRequest(clean, { hasChapter: Boolean(deps.context().chapter) })
          : null
      const changeRequests = inferredChangeRequest
        ? [...explicitChangeRequests, inferredChangeRequest]
        : explicitChangeRequests
      const turnRequests = toolTurnRequests.length ? toolTurnRequests : extractTurnRequests(clean)
      const publicMessage = toolPublicMessages.length ? toolPublicMessages.join('\n\n') : extractPublicAgentMessage(clean)
      const shouldSuppressPlanningOnlyPublicMessage =
        !toolPublicMessages.length
        && !toolChangeRequests.length
        && !toolProposal
        && !toolEndRequestReason
        && !toolAskUserRequest
        && !toolTurnRequests.length
        && /(?:let me|i need to|让我|我先).{0,100}(?:check|review|read|查看|检查|复查).{0,100}(?:story configuration|故事配置|配置)/i.test(clean)
      if (!shouldSuppressPlanningOnlyPublicMessage && publicMessage && publicMessage.trim()) {
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
        if (inferredChangeRequest) {
          deps.addSystemMessage(`${agent.name} did not call request_project_action in function-calling mode. The meeting engine inferred an actionable request from the agent message to avoid stalling.`)
        }
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
