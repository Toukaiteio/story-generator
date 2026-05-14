import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useProviderStore } from '@/stores/provider'
import { useProjectStore } from '@/stores/project'
import { useUiStore } from '@/stores/ui'
import { providerManager } from '@/services/provider'
import { loadVibeConversation, saveVibeConversation } from '@/services/vibeChatStorage'
import { decodeProviderModelRef } from '@/services/provider/catalog'
import type { StoryProject } from '@/types/project'
import type { Chapter } from '@/types/chapter'
import type { Character } from '@/types/character'
import type { ChatMessage } from '@/types/provider'
import type { ToolCallStatusItem } from '@/components/ui/ToolCallStatus.vue'
import type {
  ReviewAgentDefinition,
  ReviewAgentState,
  ReviewAgentStatus,
  ReviewAskUserRequest,
  ReviewAskUserSession,
  ReviewChangeRequest,
  ReviewChangeTarget,
  ReviewChangeVote,
  ReviewChangeVoteSession,
  ReviewContextElement,
  ReviewEndVote,
  ReviewEndVoteSession,
  ReviewProposal,
  ReviewPublicMessage,
  ReviewSpeechRequest,
  MultiAgentReviewContext,
} from './types'
import {
  reviewAgentDefinitions,
  getReviewAgentDefinitions,
  internalProposerAgentDefinition,
  createAgentState,
  normalizeAgentState,
  createId,
} from './definitions'
import {
  parseCharacterPayload,
  normalizeReviewCharacter,
  parseLooseJson,
  normalizeChapterOutlinePatch,
  extractFocusProposal,
  extractEndRequest,
  extractAskUserRequest,
  extractChangeRequests,
  extractChangeRequest,
  parseEndVote,
  parseChangeVote,
  extractAmendment,
  applyAmendmentToRequest,
  stripReasoningText,
  extractPublicAgentMessage,
  extractTurnRequests,
  parseAskUserVote,
  createToolMessage,
  rememberAcceptedChangeForAllAgents,
  buildPostToolReviewFocus,
} from './utils'
import {
  buildAgentMessages,
  buildEndVoteMessages,
  buildChangeVoteMessages,
  buildAskUserVoteMessages,
  buildSkillAgentMessages,
} from './context'
import {
  normalizePublicMessage,
  toStoredMessages,
  fromStoredMessages,
} from './storage'

// Re-exports for backward compatibility
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
  ReviewChangeVote,
  ReviewChangeVoteSession,
  ReviewAgentDefinition,
  ReviewAgentState,
  ReviewPublicMessage,
  MultiAgentReviewContext,
} from './types'

export { reviewAgentDefinitions } from './definitions'

export function useMultiAgentReviewChat(context: () => MultiAgentReviewContext) {
  const providerStore = useProviderStore()
  const projectStore = useProjectStore()
  const uiStore = useUiStore()
  const agents = ref<ReviewAgentState[]>(getReviewAgentDefinitions(context().project).map(definition => createAgentState(definition, context().project)))
  const proposerAgent = ref<ReviewAgentState>(createAgentState({
    ...internalProposerAgentDefinition,
    systemPrompt: uiStore.meetingProposerPrompt || internalProposerAgentDefinition.systemPrompt,
  }))
  const messages = ref<ReviewPublicMessage[]>([])
  const speakingQueue = ref<ReviewSpeechRequest[]>([])
  const activeSpeakerIds = ref<string[]>([])
  const currentFocus = ref('Start a focused story meeting. Identify the most important issue, opportunity, or decision in the selected context, then coordinate next steps.')
  const selectedContextElements = ref<ReviewContextElement[]>(['story-config', 'master-outline', 'characters', 'chapter-plan'])
  const pendingProposal = ref<ReviewProposal | null>(null)
  const endVoteSession = ref<ReviewEndVoteSession | null>(null)
  const askUserSession = ref<ReviewAskUserSession | null>(null)
  const changeVoteSession = ref<ReviewChangeVoteSession | null>(null)
  const meetingEnded = ref(false)
  const brainstormingMode = ref(false)
  const mandatoryBrainstormActive = ref(false)
  const openDiscussionTurnCount = ref(0)
  const inputText = ref('')
  const userTyping = ref(false)
  const loading = ref(false)
  const loaded = ref(false)
  const brainstormRoundCompleted = ref(false)
  const pendingChangeRequests = ref<Array<{ agent: ReviewAgentState; request: ReviewChangeRequest }>>([])
  const saveTimer = ref<ReturnType<typeof setTimeout> | null>(null)
  const changeVoteCleanupTimer = ref<ReturnType<typeof setTimeout> | null>(null)
  const activeAbortControllers = new Map<string, AbortController>()
  const runGeneration = ref(0)
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let processing = false

  const projectId = computed(() => context().project?.id ?? 'local')
  const directoryPath = computed(() => context().project?.directoryPath)
  const conversationKey = computed(() => {
    const chapterId = context().chapter?.id ?? 'global'
    return `chapter-outline-review.multi-agent.${chapterId}`
  })

  const canStartAgentTurn = computed(() => {
    if (meetingEnded.value || userTyping.value || inputText.value.trim() || speakingQueue.value.length === 0) return false
    // Proposals and active votes/applications should block normal agent turns
    if (pendingProposal.value || endVoteSession.value?.status === 'voting' || changeVoteSession.value?.status === 'voting' || changeVoteSession.value?.status === 'applying') return false
    // In brainstorming mode, we can start even if others are speaking
    if (brainstormingMode.value) return true
    // Sequential mode requires no one else to be speaking
    return activeSpeakerIds.value.length === 0
  })

  function getAgentStateById(agentId: string) {
    if (proposerAgent.value.id === agentId) return proposerAgent.value
    return agents.value.find(item => item.id === agentId) ?? null
  }

  function addSystemMessage(content: string) {
    messages.value.push({
      id: createId('system'),
      role: 'system',
      content,
      createdAt: new Date().toISOString(),
    })
  }

  async function verifyProjectPersistence(projectId: string, verify: (project: StoryProject) => boolean, errorMessage: string) {
    const currentProject = context().project
    const directoryPathForLoad = currentProject?.directoryPath?.trim() || projectStore.getProjectById(projectId)?.directoryPath?.trim() || undefined
    const loader = window.electronAPI?.project?.load
    if (!loader) return
    const reloaded = await loader(projectId, directoryPathForLoad)
    if (!reloaded || typeof reloaded !== 'object' || !verify(reloaded as StoryProject)) {
      throw new Error(errorMessage)
    }
  }

  function clearChangeVoteCleanupTimer() {
    if (changeVoteCleanupTimer.value) {
      clearTimeout(changeVoteCleanupTimer.value)
      changeVoteCleanupTimer.value = null
    }
  }

  function isTerminalChangeVoteStatus(status?: ReviewChangeVoteSession['status']) {
    return status === 'applied' || status === 'rejected' || status === 'failed'
  }

  function addChangeVoteSummaryMessage(session: ReviewChangeVoteSession, content: string) {
    messages.value.push({
      id: createId('system'),
      role: 'system',
      content,
      changeVoteSnapshot: {
        ...session,
        request: { ...session.request },
        votes: session.votes.map(vote => ({
          ...vote,
          amendment: vote.amendment ? { ...vote.amendment } : undefined,
        })),
      },
      createdAt: new Date().toISOString(),
    })
  }

  function scheduleSave() {
    if (!loaded.value) return
    if (saveTimer.value) clearTimeout(saveTimer.value)
    saveTimer.value = setTimeout(() => {
      void persist()
    }, 250)
  }

  async function persist() {
    if (!projectId.value || !conversationKey.value) return
    const stateMessage = {
      id: createId('state'),
      role: 'system' as const,
      content: JSON.stringify({
        kind: 'multi-agent-review-state',
        focus: currentFocus.value,
        selectedContextElements: selectedContextElements.value,
        pendingProposal: pendingProposal.value,
        endVoteSession: endVoteSession.value,
        askUserSession: askUserSession.value,
        changeVoteSession: changeVoteSession.value,
        meetingEnded: meetingEnded.value,
        agents: agents.value.map(agent => ({
          id: agent.id,
          lastSeenMessageIndex: agent.lastSeenMessageIndex,
          privateMemory: agent.privateMemory,
          workspaceState: agent.workspaceState,
          modelValue: agent.modelValue,
          toolState: agent.toolState,
        })),
        proposerAgent: {
          id: proposerAgent.value.id,
          lastSeenMessageIndex: proposerAgent.value.lastSeenMessageIndex,
          privateMemory: proposerAgent.value.privateMemory,
          workspaceState: proposerAgent.value.workspaceState,
          modelValue: proposerAgent.value.modelValue,
          toolState: proposerAgent.value.toolState,
        },
      }),
      timestamp: new Date().toISOString(),
    }
    await saveVibeConversation(
      projectId.value,
      directoryPath.value,
      conversationKey.value,
      toStoredMessages(messages.value),
      { toolStatuses: [], todoItems: [] }
    )
    await saveVibeConversation(
      projectId.value,
      directoryPath.value,
      `${conversationKey.value}.state`,
      [stateMessage],
      { toolStatuses: [], todoItems: [] }
    )
  }

  async function load() {
    loaded.value = false
    const [conversation, stateConversation] = await Promise.all([
      loadVibeConversation(projectId.value, directoryPath.value, conversationKey.value),
      loadVibeConversation(projectId.value, directoryPath.value, `${conversationKey.value}.state`),
    ])
    messages.value = fromStoredMessages(conversation?.messages ?? [])
    speakingQueue.value = []
    activeSpeakerIds.value = []
    const stateRaw = stateConversation?.messages?.[0]?.content
    if (stateRaw) {
      try {
        const state = JSON.parse(stateRaw)
        if (state?.kind === 'multi-agent-review-state') {
          currentFocus.value = typeof state.focus === 'string' ? state.focus : currentFocus.value
          selectedContextElements.value = Array.isArray(state.selectedContextElements)
            ? state.selectedContextElements.filter((item: any) =>
              ['story-config', 'master-outline', 'characters', 'selected-chapter', 'chapter-plan', 'chapter-draft'].includes(item)
            )
            : selectedContextElements.value
          pendingProposal.value = state.pendingProposal && typeof state.pendingProposal === 'object' ? state.pendingProposal : null
          endVoteSession.value = state.endVoteSession && typeof state.endVoteSession === 'object' ? state.endVoteSession : null
          askUserSession.value = state.askUserSession && typeof state.askUserSession === 'object' ? state.askUserSession : null
          changeVoteSession.value = state.changeVoteSession && typeof state.changeVoteSession === 'object' ? state.changeVoteSession : null
          if (endVoteSession.value?.status === 'voting') {
            endVoteSession.value = null
            addSystemMessage('Previous end-vote workflow was interrupted when the meeting view was left. The meeting remains open.')
          }
          if (askUserSession.value?.status === 'voting') {
            askUserSession.value = { ...askUserSession.value, status: 'rejected', completedAt: new Date().toISOString() }
            addSystemMessage('Previous clarification vote was interrupted when the meeting view was left. Continue the meeting or ask again if needed.')
          }
          if (changeVoteSession.value?.status === 'voting' || changeVoteSession.value?.status === 'applying') {
            changeVoteSession.value = {
              ...changeVoteSession.value,
              status: 'failed',
              error: 'This project-change workflow was interrupted when the meeting view was left. Please continue the meeting and request the change again if it is still needed.',
              completedAt: new Date().toISOString(),
            }
            addSystemMessage('Previous project-change workflow was interrupted when the meeting view was left. It was not treated as completed.')
          }
          meetingEnded.value = Boolean(state.meetingEnded)
          agents.value = getReviewAgentDefinitions(context().project).map(definition =>
            normalizeAgentState(
              Array.isArray(state.agents) ? state.agents.find((item: any) => item?.id === definition.id) : null,
              definition,
              context().project
            )
          )
          proposerAgent.value = normalizeAgentState(
            state.proposerAgent ?? null,
            {
              ...internalProposerAgentDefinition,
              systemPrompt: uiStore.meetingProposerPrompt || internalProposerAgentDefinition.systemPrompt,
            }
          )
        }
      } catch {
        agents.value = getReviewAgentDefinitions(context().project).map(definition => createAgentState(definition, context().project))
        proposerAgent.value = createAgentState({
          ...internalProposerAgentDefinition,
          systemPrompt: uiStore.meetingProposerPrompt || internalProposerAgentDefinition.systemPrompt,
        })
      }
    } else {
      agents.value = getReviewAgentDefinitions(context().project).map(definition => createAgentState(definition, context().project))
      proposerAgent.value = createAgentState({
        ...internalProposerAgentDefinition,
        systemPrompt: uiStore.meetingProposerPrompt || internalProposerAgentDefinition.systemPrompt,
      })
    }
    loaded.value = true
    if (!messages.value.length) {
      addSystemMessage('Multi-agent story meeting is ready. Choose context, open the meeting, or ask an agent to speak.')
    }
  }

  function setAgentStatus(agentId: string, status: ReviewAgentStatus, waitingForTurn?: boolean) {
    const agent = getAgentStateById(agentId)
    if (!agent) return
    agent.status = status
    agent.waitingForTurn = waitingForTurn ?? (status === 'waiting' || status === 'blocked')
    agent.toolState.requestSpeech = status
    if (status === 'requesting') agent.toolState.lastRequestedAt = new Date().toISOString()
    if (status === 'speaking') agent.toolState.lastSpokeAt = new Date().toISOString()
  }

  function queueHasAgent(agentId: string) {
    return speakingQueue.value.some(item => item.agentId === agentId)
  }

  function requestTurn(agentId: string, focus?: string) {
    const agent = getAgentStateById(agentId)
    if (!agent || !agent.enabled || queueHasAgent(agentId) || activeSpeakerIds.value.includes(agentId) || meetingEnded.value) return
    if (focus?.trim()) currentFocus.value = focus.trim()
    setAgentStatus(agentId, 'requesting', true)
    speakingQueue.value.push({
      id: createId('turn'),
      agentId,
      requestedBy: 'agent',
      focus: currentFocus.value,
      createdAt: new Date().toISOString(),
    })
    setAgentStatus(agentId, activeSpeakerIds.value.length > 0 || userTyping.value || inputText.value.trim() ? 'blocked' : 'waiting', true)
    addSystemMessage(`${agent.name} requested speaking permission.`)
    scheduleSave()
    void processQueue()
  }

  function requestAllAgents(
    focus?: string,
    options: {
      mandatoryBrainstorm?: boolean
      resetTurnCount?: boolean
      agentFilter?: (agent: ReviewAgentState) => boolean
    } = {}
  ) {
    if (focus?.trim()) currentFocus.value = focus.trim()
    meetingEnded.value = false
    mandatoryBrainstormActive.value = options.mandatoryBrainstorm !== false
    // Use parallel brainstormingMode only for mandatory brainstorm rounds.
    // Open meeting rounds are sequential to allow agents to react to each other.
    brainstormingMode.value = mandatoryBrainstormActive.value
    if (mandatoryBrainstormActive.value) {
      brainstormRoundCompleted.value = false
    } else if (options.resetTurnCount !== false) {
      openDiscussionTurnCount.value = 0
    }
    for (const agent of agents.value.filter(item => item.enabled && (options.agentFilter ? options.agentFilter(item) : true))) {
      if (activeSpeakerIds.value.includes(agent.id)) continue
      speakingQueue.value = speakingQueue.value.filter(item => item.agentId !== agent.id)
      speakingQueue.value.push({
        id: createId('turn'),
        agentId: agent.id,
        requestedBy: 'agent',
        focus: currentFocus.value,
        createdAt: new Date().toISOString(),
      })
      setAgentStatus(agent.id, userTyping.value || inputText.value.trim() ? 'blocked' : 'waiting', true)
    }
    addSystemMessage(mandatoryBrainstormActive.value
      ? 'All agents entered the mandatory brainstorm round in parallel.'
      : 'All agents entered an open meeting round sequentially.')
    scheduleSave()
    void processQueue()
  }

  function requestAllAgentsSequentially(focus?: string) {
    if (focus?.trim()) currentFocus.value = focus.trim()
    meetingEnded.value = false
    brainstormingMode.value = false
    for (const agent of agents.value.filter(item => item.enabled)) {
      requestTurn(agent.id)
    }
  }

  function userRequestTurn(agentId: string, instruction?: string) {
    const agent = agents.value.find(item => item.id === agentId)
    if (!agent || !agent.enabled || activeSpeakerIds.value.includes(agentId)) return
    meetingEnded.value = false
    brainstormingMode.value = false // User explicit requests are sequential
    speakingQueue.value = speakingQueue.value.filter(item => item.agentId !== agentId)
    speakingQueue.value.unshift({
      id: createId('turn'),
      agentId,
      requestedBy: 'user',
      focus: currentFocus.value,
      userInstruction: instruction?.trim() || 'The user explicitly requested this agent to speak next.',
      createdAt: new Date().toISOString(),
    })
    setAgentStatus(agentId, activeSpeakerIds.value.length > 0 || userTyping.value || inputText.value.trim() ? 'blocked' : 'waiting', true)
    addSystemMessage(`User requested ${agent.name} to speak next.`)
    void processQueue()
  }

  function markQueuedAgentsBlocked() {
    for (const request of speakingQueue.value) {
      setAgentStatus(request.agentId, 'blocked', true)
    }
  }

  function releaseBlockedAgents() {
    for (const request of speakingQueue.value) {
      setAgentStatus(request.agentId, 'waiting', true)
    }
    void processQueue()
  }

  function handleInput(value: string) {
    inputText.value = value
    if (idleTimer) clearTimeout(idleTimer)
    if (value.trim()) {
      userTyping.value = true
      markQueuedAgentsBlocked()
      return
    }
    idleTimer = setTimeout(() => {
      userTyping.value = false
      releaseBlockedAgents()
    }, 3000)
  }

  async function sendUserMessage() {
    const content = inputText.value.trim()
    if (!content) return
    if (askUserSession.value?.status === 'ready') {
      askUserSession.value = { ...askUserSession.value, status: 'answered', completedAt: new Date().toISOString() }
    }
    inputText.value = ''
    userTyping.value = false
    if (idleTimer) clearTimeout(idleTimer)
    messages.value.push({
      id: createId('user'),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    })
    addSystemMessage('User message has highest priority. Queued agents will include it in their next turn.')
    mandatoryBrainstormActive.value = false
    brainstormRoundCompleted.value = false
    pendingChangeRequests.value = []
    scheduleSave()
    await nextTick()
    releaseBlockedAgents()

    // Auto-trigger a round if no one is waiting/speaking and no end vote is running.
    if (
      speakingQueue.value.length === 0
      && activeSpeakerIds.value.length === 0
      && endVoteSession.value?.status !== 'voting'
      && changeVoteSession.value?.status !== 'voting'
      && changeVoteSession.value?.status !== 'applying'
    ) {
      requestAllAgents([
        'Analyze the latest user request before taking action.',
        'Clarify what the user wants, what final effect would satisfy it, and whether a project edit is required.',
        'If the team needs alignment but no edit is needed, request target: consensus voting.',
        'If an edit is needed, request a project change vote with scope, purpose, and concrete content.',
      ].join(' '))
    }
  }

  function setContextElement(element: ReviewContextElement, enabled: boolean) {
    if (enabled && !selectedContextElements.value.includes(element)) {
      selectedContextElements.value = [...selectedContextElements.value, element]
    } else if (!enabled) {
      selectedContextElements.value = selectedContextElements.value.filter(item => item !== element)
    }
  }

  async function updateAgentSettings(agentId: string, settings: { customSystemPrompt?: string; modelValue?: string }) {
    const agent = agents.value.find(item => item.id === agentId)
    if (!agent) return
    if (typeof settings.customSystemPrompt === 'string') {
      agent.customSystemPrompt = settings.customSystemPrompt.trim() || agent.systemPrompt
    }
    if (typeof settings.modelValue === 'string') {
      agent.modelValue = settings.modelValue
    }
    const project = context().project
    if (project) {
      const existing = project.reviewAgentSettings?.agents?.[agentId] ?? {}
      await projectStore.updateProject(project.id, {
        reviewAgentSettings: {
          agents: {
            ...(project.reviewAgentSettings?.agents ?? {}),
            [agentId]: {
              ...existing,
              customSystemPrompt: agent.customSystemPrompt,
              modelValue: agent.modelValue,
            },
          },
        },
      })
    }
  }

  async function persistAgentProjectSetting(agentId: string, patch: NonNullable<StoryProject['reviewAgentSettings']>['agents'][string]) {
    const project = context().project
    if (!project) return
    const existing = project.reviewAgentSettings?.agents?.[agentId] ?? {}
    await projectStore.updateProject(project.id, {
      reviewAgentSettings: {
        agents: {
          ...(project.reviewAgentSettings?.agents ?? {}),
          [agentId]: {
            ...existing,
            ...patch,
          },
        },
      },
    })
  }

  async function addAgent(data: {
    name: string
    role: string
    brief: string
    systemPrompt: string
    defaultModelRole?: 'chapterPlanner' | 'proofreader'
  }) {
    const name = data.name.trim() || 'Custom Agent'
    const id = createId('agent')
    const defaultModelRole: 'chapterPlanner' | 'proofreader' = data.defaultModelRole === 'proofreader' ? 'proofreader' : 'chapterPlanner'
    const definition: ReviewAgentDefinition = {
      id,
      name,
      role: data.role.trim() || 'Custom role',
      brief: data.brief.trim() || 'Custom meeting participant.',
      defaultModelRole,
      systemPrompt: data.systemPrompt.trim() || 'You are a custom story meeting agent. Provide concise, useful feedback based on the selected context.',
      custom: true,
    }
    agents.value.push(createAgentState(definition, context().project))
    await persistAgentProjectSetting(id, {
      name: definition.name,
      role: definition.role,
      brief: definition.brief,
      defaultModelRole,
      modelValue: '',
      systemPrompt: definition.systemPrompt,
      customSystemPrompt: definition.systemPrompt,
      custom: true,
      disabled: false,
      deleted: false,
    })
  }

  async function setAgentEnabled(agentId: string, enabled: boolean) {
    const agent = agents.value.find(item => item.id === agentId)
    if (!agent) return
    if (!enabled) {
      speakingQueue.value = speakingQueue.value.filter(item => item.agentId !== agentId)
      activeAbortControllers.get(agentId)?.abort()
      activeAbortControllers.delete(agentId)
      activeSpeakerIds.value = activeSpeakerIds.value.filter(id => id !== agentId)
      setAgentStatus(agentId, 'idle', false)
    }
    agent.enabled = enabled
    await persistAgentProjectSetting(agentId, { disabled: !enabled })
    scheduleSave()
  }

  async function deleteAgent(agentId: string) {
    const agent = agents.value.find(item => item.id === agentId)
    if (!agent) return
    speakingQueue.value = speakingQueue.value.filter(item => item.agentId !== agentId)
    activeAbortControllers.get(agentId)?.abort()
    activeAbortControllers.delete(agentId)
    activeSpeakerIds.value = activeSpeakerIds.value.filter(id => id !== agentId)
    agents.value = agents.value.filter(item => item.id !== agentId)
    await persistAgentProjectSetting(agentId, { deleted: true, disabled: true })
    scheduleSave()
  }

  async function restoreDefaultAgents() {
    speakingQueue.value = []
    for (const id of activeSpeakerIds.value) {
      activeAbortControllers.get(id)?.abort()
      activeAbortControllers.delete(id)
    }
    activeSpeakerIds.value = []
    const project = context().project
    if (project) {
      // Keep maxContextTurns but reset agents
      const newSettings = {
        maxContextTurns: project.reviewAgentSettings?.maxContextTurns,
        agents: {}
      }
      await projectStore.updateProject(project.id, { reviewAgentSettings: newSettings })
    }
    agents.value = getReviewAgentDefinitions(context().project).map(definition => createAgentState(definition, context().project))
    scheduleSave()
  }

  function approveProposal() {
    if (!pendingProposal.value) return
    const proposal = pendingProposal.value
    currentFocus.value = proposal.content
    addSystemMessage(`User approved new meeting focus: ${proposal.content}`)
    pendingProposal.value = null
    meetingEnded.value = false
    requestAllAgents([
      `The user approved the new meeting focus: ${proposal.content}`,
      'Continue the meeting in open discussion mode.',
      'Do not stop unless an agent explicitly requests ending, all enabled agents approve that end request, and the user approves it.',
      'Discuss, challenge, refine, or act on this focus as a group. Use project-change, clarification, consensus, or end-request tools only when justified.',
    ].join('\n'), { mandatoryBrainstorm: false })
  }

  function rejectProposal(reason?: string) {
    if (!pendingProposal.value) return
    const proposal = pendingProposal.value
    addSystemMessage(`User rejected focus change${reason?.trim() ? `: ${reason.trim()}` : '.'}`)
    pendingProposal.value = null
    meetingEnded.value = false
    requestAllAgents([
      `The user rejected the proposed focus: ${proposal.content}`,
      reason?.trim() ? `User reason: ${reason.trim()}` : 'No rejection reason was provided.',
      'Continue the meeting in open discussion mode and address the remaining issue.',
      'Do not stop unless an agent explicitly requests ending, all enabled agents approve that end request, and the user approves it.',
    ].join('\n'), { mandatoryBrainstorm: false })
  }

  function cancelActiveTurnsExcept(agentId: string) {
    speakingQueue.value = []
    brainstormingMode.value = false
    for (const [activeAgentId, controller] of activeAbortControllers.entries()) {
      if (activeAgentId === agentId) continue
      controller.abort()
      activeAbortControllers.delete(activeAgentId)
      setAgentStatus(activeAgentId, 'idle', false)
    }
    activeSpeakerIds.value = activeSpeakerIds.value.filter(id => id === agentId)
  }

  function requestEndVote(agent: ReviewAgentState, reason: string) {
    if (endVoteSession.value?.status === 'voting') return
    cancelActiveTurnsExcept(agent.id)
    const session: ReviewEndVoteSession = {
      id: createId('end-vote'),
      requestedByAgentId: agent.id,
      requestedByAgentName: agent.name,
      reason,
      status: 'voting',
      votes: [],
      createdAt: new Date().toISOString(),
    }
    endVoteSession.value = session
    addSystemMessage(`${agent.name} requested ending the meeting. All enabled agents will vote before the user decides.`)
    scheduleSave()
    setTimeout(() => {
      void runEndVoteSession(session.id)
    }, 0)
  }

  async function runEndVoteForAgent(agent: ReviewAgentState, sessionId: string) {
    const session = endVoteSession.value
    if (!session || session.id !== sessionId || !agent.enabled || meetingEnded.value) return

    providerManager.setProviders(providerStore.providers)
    const preferred = decodeProviderModelRef(agent.modelValue)
    const model = providerStore.getAvailableModelRefForRole(agent.defaultModelRole, preferred)
      ?? providerStore.getAvailableModelRefForRole('chapterPlanner')
      ?? providerStore.getAvailableModelRefForRole('proofreader')
      ?? providerStore.getDefaultModelRefForRole(agent.defaultModelRole)

    if (!model) {
      const vote: ReviewEndVote = {
        agentId: agent.id,
        agentName: agent.name,
        vote: 'reject',
        reason: 'No model is configured for this agent, so it cannot approve ending the meeting.',
        createdAt: new Date().toISOString(),
      }
      session.votes.push(vote)
      messages.value.push({
        id: createId('agent'),
        role: 'agent',
        agentId: agent.id,
        agentName: agent.name,
        content: `[End vote: Reject]\n${vote.reason}`,
        createdAt: vote.createdAt,
      })
      setAgentStatus(agent.id, 'idle', false)
      return
    }

    const abortController = new AbortController()
    activeAbortControllers.set(agent.id, abortController)
    setAgentStatus(agent.id, 'speaking', false)

    try {
      const content = await providerManager.chat(
        buildEndVoteMessages(agent, messages.value, context(), currentFocus.value, selectedContextElements.value, session),
        model,
        700,
        0.2,
        abortController.signal
      )
      if (endVoteSession.value?.id !== sessionId || abortController.signal.aborted) return
      const parsed = parseEndVote(stripReasoningText(content))
      const vote: ReviewEndVote = {
        agentId: agent.id,
        agentName: agent.name,
        vote: parsed.vote,
        reason: parsed.reason,
        createdAt: new Date().toISOString(),
      }
      endVoteSession.value.votes.push(vote)
      messages.value.push({
        id: createId('agent'),
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
      agent.lastSeenMessageIndex = messages.value.length
      setAgentStatus(agent.id, 'idle', false)
    } catch (error: any) {
      if (abortController.signal.aborted || error?.name === 'AbortError') return
      const vote: ReviewEndVote = {
        agentId: agent.id,
        agentName: agent.name,
        vote: 'reject',
        reason: error?.message ? `Vote failed: ${error.message}` : 'Vote failed, so the agent cannot approve ending.',
        createdAt: new Date().toISOString(),
      }
      if (endVoteSession.value?.id === sessionId) endVoteSession.value.votes.push(vote)
      addSystemMessage(`${agent.name} failed to vote: ${vote.reason}`)
      setAgentStatus(agent.id, 'blocked', false)
    } finally {
      activeAbortControllers.delete(agent.id)
      if (agent.status === 'speaking') setAgentStatus(agent.id, 'idle', false)
      scheduleSave()
    }
  }

  async function runEndVoteSession(sessionId: string) {
    const voters = agents.value.filter(agent => agent.enabled)
    for (const agent of voters) {
      if (endVoteSession.value?.id !== sessionId || endVoteSession.value.status !== 'voting') return
      setAgentStatus(agent.id, 'waiting', true)
      await runEndVoteForAgent(agent, sessionId)
    }
    if (endVoteSession.value?.id !== sessionId) return
    endVoteSession.value.status = 'ready'
    endVoteSession.value.completedAt = new Date().toISOString()
    addSystemMessage('Agent end-vote is complete. User decision is required.')
    scheduleSave()
  }

  function approveEndVoteSession() {
    if (!endVoteSession.value) return
    const session = endVoteSession.value
    endVoteSession.value = null
    stopActiveTurns()
    meetingEnded.value = true
    addSystemMessage(`User approved ending the meeting after agent vote. Original request: ${session.reason}`)
    scheduleSave()
  }

  function rejectEndVoteSession(reason?: string) {
    if (!endVoteSession.value) return false
    const clean = reason?.trim()
    if (!clean) return false
    endVoteSession.value = null
    meetingEnded.value = false
    addSystemMessage(`User rejected ending the meeting: ${clean}`)
    scheduleSave()
    requestAllAgents(`The user rejected ending the meeting because: ${clean}. Continue the meeting and address the unresolved issue before any new end request.`, { mandatoryBrainstorm: false })
    return true
  }

  function requestAskUserVote(agent: ReviewAgentState, request: ReviewAskUserRequest) {
    if (askUserSession.value?.status === 'voting' || askUserSession.value?.status === 'ready') return
    const session: ReviewAskUserSession = {
      id: createId('ask-user'),
      requestedByAgentId: agent.id,
      requestedByAgentName: agent.name,
      request,
      status: 'voting',
      votes: [],
      createdAt: new Date().toISOString(),
    }
    askUserSession.value = session
    addSystemMessage(`${agent.name} requested user clarification. All enabled agents will vote before showing it to the user.`)
    scheduleSave()
    setTimeout(() => {
      void runAskUserVoteSession(session.id)
    }, 0)
  }

  async function runAskUserVoteForAgent(agent: ReviewAgentState, sessionId: string) {
    const session = askUserSession.value
    if (!session || session.id !== sessionId || !agent.enabled) return
    providerManager.setProviders(providerStore.providers)
    const preferred = decodeProviderModelRef(agent.modelValue)
    const model = providerStore.getAvailableModelRefForRole(agent.defaultModelRole, preferred)
      ?? providerStore.getAvailableModelRefForRole('chapterPlanner')
      ?? providerStore.getAvailableModelRefForRole('proofreader')
      ?? providerStore.getDefaultModelRefForRole(agent.defaultModelRole)
    if (!model) {
      session.votes.push({ agentId: agent.id, agentName: agent.name, vote: 'reject', reason: 'No model configured for this agent.', createdAt: new Date().toISOString() })
      return
    }
    const abortController = new AbortController()
    activeAbortControllers.set(agent.id, abortController)
    setAgentStatus(agent.id, 'speaking', false)
    try {
      const content = await providerManager.chat(buildAskUserVoteMessages(agent, messages.value, context(), session), model, 500, 0.2, abortController.signal)
      if (askUserSession.value?.id !== sessionId || abortController.signal.aborted) return
      const parsed = parseAskUserVote(stripReasoningText(content))
      askUserSession.value.votes.push({ agentId: agent.id, agentName: agent.name, vote: parsed.vote, reason: parsed.reason, createdAt: new Date().toISOString() })
    } catch (error: any) {
      if (abortController.signal.aborted || error?.name === 'AbortError') return
      askUserSession.value?.votes.push({ agentId: agent.id, agentName: agent.name, vote: 'reject', reason: error?.message || 'Clarification vote failed.', createdAt: new Date().toISOString() })
    } finally {
      activeAbortControllers.delete(agent.id)
      if (agent.status === 'speaking') setAgentStatus(agent.id, 'idle', false)
      scheduleSave()
    }
  }

  async function runAskUserVoteSession(sessionId: string) {
    const voters = agents.value.filter(agent => agent.enabled)
    for (const agent of voters) {
      if (askUserSession.value?.id !== sessionId || askUserSession.value.status !== 'voting') return
      await runAskUserVoteForAgent(agent, sessionId)
    }
    const session = askUserSession.value
    if (!session || session.id !== sessionId) return
    const allApproved = voters.length > 0 && session.votes.length >= voters.length && session.votes.every(vote => vote.vote === 'approve')
    if (allApproved) {
      askUserSession.value = { ...session, status: 'ready', completedAt: new Date().toISOString() }
      addSystemMessage('All agents agreed that user clarification is needed.')
    } else {
      askUserSession.value = { ...session, status: 'rejected', completedAt: new Date().toISOString() }
      addSystemMessage('User clarification request was rejected by at least one agent. Continuing the meeting.')
      requestAllAgents('A clarification request was rejected. Continue using existing context and decide the best next action without asking the user unless a new clarification is truly necessary.', { mandatoryBrainstorm: false })
    }
    scheduleSave()
  }

  async function answerAskUser(option: string) {
    const session = askUserSession.value
    if (!session || session.status !== 'ready') return
    askUserSession.value = { ...session, status: 'answered', completedAt: new Date().toISOString() }
    inputText.value = option
    await sendUserMessage()
  }

  function changeVoters() {
    return agents.value.filter(agent => agent.enabled)
  }

  function requestChangeVote(agent: ReviewAgentState, request: ReviewChangeRequest) {
    if (changeVoteSession.value?.status === 'voting' || changeVoteSession.value?.status === 'applying') {
      pendingChangeRequests.value.push({ agent, request })
      addSystemMessage(`${agent.name} created an additional proposal. It was queued until the active change vote finishes.`)
      return
    }
    if (!brainstormRoundCompleted.value) {
      pendingChangeRequests.value.push({ agent, request })
      addSystemMessage(`${agent.name} drafted a proposal. It will wait until every active meeting agent has completed at least one brainstorm turn.`)
      if (!brainstormingMode.value) {
        requestAllAgents([
          'Before voting on a proposal, complete at least one brainstorm round.',
          'Each agent should analyze the user request from its own role and state what outcome would satisfy the user.',
          'After the brainstorm round, the queued proposal can enter voting or be replaced by a better proposal.',
        ].join('\n'))
      }
      return
    }
    cancelActiveTurnsExcept(agent.id)
    const session: ReviewChangeVoteSession = {
      id: createId('change-vote'),
      requestedByAgentId: agent.id,
      requestedByAgentName: agent.name,
      request,
      status: 'voting',
      votes: [],
      createdAt: new Date().toISOString(),
    }
    changeVoteSession.value = session
    messages.value.push({
      id: createId('agent'),
      role: 'agent',
      agentId: agent.id,
      agentName: agent.name,
      content: [
        `[Change request: ${request.target}]`,
        `Scope: ${request.scope}`,
        `Purpose: ${request.purpose}`,
        'The request will be applied automatically if a majority of meeting agents approve.',
      ].join('\n'),
      tool: createToolMessage('request_project_change', 'pending', 'Change vote requested', `${agent.name} requested a project change`, request.content),
      createdAt: new Date().toISOString(),
    })
    scheduleSave()
    setTimeout(() => {
      void runChangeVoteSession(session.id)
    }, 0)
  }

  function flushPendingChangeRequest() {
    if (!brainstormRoundCompleted.value || changeVoteSession.value?.status === 'voting' || changeVoteSession.value?.status === 'applying') return
    const next = pendingChangeRequests.value.shift()
    if (!next) return
    requestChangeVote(next.agent, next.request)
  }

  async function runChangeVoteForAgent(agent: ReviewAgentState, sessionId: string) {
    const session = changeVoteSession.value
    if (!session || session.id !== sessionId || !agent.enabled || meetingEnded.value) return

    providerManager.setProviders(providerStore.providers)
    const preferred = decodeProviderModelRef(agent.modelValue)
    const model = providerStore.getAvailableModelRefForRole(agent.defaultModelRole, preferred)
      ?? providerStore.getAvailableModelRefForRole('chapterPlanner')
      ?? providerStore.getAvailableModelRefForRole('proofreader')
      ?? providerStore.getDefaultModelRefForRole(agent.defaultModelRole)

    if (!model) {
      session.votes.push({
        agentId: agent.id,
        agentName: agent.name,
        vote: 'reject',
        reason: 'No model is configured for this agent, so it cannot approve the change.',
        createdAt: new Date().toISOString(),
      })
      setAgentStatus(agent.id, 'idle', false)
      return
    }

    const abortController = new AbortController()
    activeAbortControllers.set(agent.id, abortController)
    setAgentStatus(agent.id, 'speaking', false)

    try {
      const content = await providerManager.chat(
        buildChangeVoteMessages(agent, messages.value, context(), currentFocus.value, selectedContextElements.value, session),
        model,
        700,
        0.2,
        abortController.signal
      )
      if (changeVoteSession.value?.id !== sessionId || abortController.signal.aborted) return
      const cleanVoteContent = stripReasoningText(content)
      const parsed = parseChangeVote(cleanVoteContent)
      const amendment = changeVoteSession.value.amendmentDepth ? null : extractAmendment(cleanVoteContent)
      const vote: ReviewChangeVote = {
        agentId: agent.id,
        agentName: agent.name,
        vote: parsed.vote,
        reason: parsed.reason,
        amendment: amendment ?? undefined,
        createdAt: new Date().toISOString(),
      }
      changeVoteSession.value.votes.push(vote)
      messages.value.push({
        id: createId('agent'),
        role: 'agent',
        agentId: agent.id,
        agentName: agent.name,
        content: `[Change vote: ${vote.vote === 'approve' ? 'Approve' : 'Reject'}]\n${vote.reason}`,
        createdAt: vote.createdAt,
      })
      agent.privateMemory = [
        ...agent.privateMemory,
        `Change vote ${new Date().toLocaleString()}: ${vote.vote}. ${vote.reason.slice(0, 500)}`,
      ].slice(-12)
      agent.lastSeenMessageIndex = messages.value.length
      setAgentStatus(agent.id, 'idle', false)
    } catch (error: any) {
      if (abortController.signal.aborted || error?.name === 'AbortError') return
      const vote: ReviewChangeVote = {
        agentId: agent.id,
        agentName: agent.name,
        vote: 'reject',
        reason: error?.message ? `Vote failed: ${error.message}` : 'Vote failed, so the agent cannot approve the change.',
        createdAt: new Date().toISOString(),
      }
      if (changeVoteSession.value?.id === sessionId) changeVoteSession.value.votes.push(vote)
      addSystemMessage(`${agent.name} failed to vote on the change: ${vote.reason}`)
      setAgentStatus(agent.id, 'blocked', false)
    } finally {
      activeAbortControllers.delete(agent.id)
      if (agent.status === 'speaking') setAgentStatus(agent.id, 'idle', false)
      scheduleSave()
    }
  }

  async function normalizeApprovedChangeWithSkillAgent(session: ReviewChangeVoteSession): Promise<ReviewChangeVoteSession> {
    providerManager.setProviders(providerStore.providers)
    const model = providerStore.getAvailableModelRefForRole('skillAgent')
      ?? providerStore.getAvailableModelRefForRole('chapterPlanner')
      ?? providerStore.getDefaultModelRefForRole('skillAgent')
    if (!model) return session

    try {
      const content = await providerManager.chat(
        buildSkillAgentMessages(session, context(), selectedContextElements.value),
        model,
        1800,
        0.15
      )
      const parsed = parseLooseJson(stripReasoningText(content))
      const target = parsed?.target === 'master-outline' || parsed?.target === 'chapter-plan' || parsed?.target === 'characters' || parsed?.target === 'consensus'
        ? parsed.target as ReviewChangeTarget
        : session.request.target
      const normalizedContent = typeof parsed?.content === 'string'
        ? parsed.content
        : JSON.stringify(parsed?.content ?? session.request.content, null, 2)
      const normalized: ReviewChangeRequest = {
        target,
        scope: typeof parsed?.scope === 'string' && parsed.scope.trim() ? parsed.scope.trim() : session.request.scope,
        purpose: typeof parsed?.purpose === 'string' && parsed.purpose.trim() ? parsed.purpose.trim() : session.request.purpose,
        content: normalizedContent,
      }
      messages.value.push({
        id: createId('system'),
        role: 'system',
        content: `Project Change Tool normalized the approved proposal before execution.${parsed?.verification ? `\nVerification plan: ${parsed.verification}` : ''}`,
        tool: createToolMessage('normalize_project_change', 'success', 'Proposal normalized', normalized.scope, normalized.purpose, session.request.content, normalized.content),
        createdAt: new Date().toISOString(),
      })
      return { ...session, request: normalized }
    } catch (error: any) {
      messages.value.push({
        id: createId('system'),
        role: 'system',
        content: `Project Change Tool could not normalize with the configured skill model, so it will try local parsing. ${error?.message || ''}`.trim(),
        tool: createToolMessage('normalize_project_change', 'warning', 'Normalization fallback', session.request.scope, error?.message || 'Skill model normalization failed'),
        createdAt: new Date().toISOString(),
      })
      return session
    }
  }

  async function runAmendmentVote(
    originalSession: ReviewChangeVoteSession,
    proposerVote: ReviewChangeVote,
    voters: ReviewAgentState[]
  ) {
    if (!proposerVote.amendment) return false
    const amendedRequest = applyAmendmentToRequest(originalSession.request, proposerVote.amendment)
    const amendmentSession: ReviewChangeVoteSession = {
      ...originalSession,
      id: createId('amendment-vote'),
      request: amendedRequest,
      amendmentDepth: 1,
      votes: [{
        agentId: proposerVote.agentId,
        agentName: proposerVote.agentName,
        vote: 'approve',
        reason: 'Amendment proposer automatically approves the amendment.',
        createdAt: new Date().toISOString(),
      }],
    }
    changeVoteSession.value = amendmentSession
    addSystemMessage(`${proposerVote.agentName} proposed an amendment. Voting on the amendment before continuing the original proposal.`)

    for (const agent of voters.filter(item => item.id !== proposerVote.agentId)) {
      if (changeVoteSession.value?.id !== amendmentSession.id) return true
      setAgentStatus(agent.id, 'waiting', true)
      await runChangeVoteForAgent(agent, amendmentSession.id)
    }

    const latest = changeVoteSession.value
    if (!latest || latest.id !== amendmentSession.id) return true
    const approvals = latest.votes.filter(vote => vote.vote === 'approve').length
    const majority = Math.floor(voters.length / 2) + 1
    if (approvals >= majority) {
      const restarted: ReviewChangeVoteSession = {
        ...originalSession,
        id: createId('change-vote'),
        request: amendedRequest,
        votes: [{
          agentId: proposerVote.agentId,
          agentName: proposerVote.agentName,
          vote: 'approve',
          reason: 'Automatically approves the original proposal after the accepted amendment.',
          createdAt: new Date().toISOString(),
        }],
        amendmentDepth: 0,
      }
      changeVoteSession.value = restarted
      addSystemMessage('Amendment approved and applied to the proposal. Restarting the original proposal vote.')
      setTimeout(() => {
        void runChangeVoteSession(restarted.id)
      }, 0)
      return true
    }

    changeVoteSession.value = originalSession
    addSystemMessage('Amendment rejected. Continuing the original proposal vote with the proposer\'s initial stance.')
    return false
  }

  async function applyApprovedChange(session: ReviewChangeVoteSession) {
    const project = context().project
    if (!project) throw new Error('No active project is selected.')
    changeVoteSession.value = { ...session, status: 'applying' }
    scheduleSave()
    const executableSession = await normalizeApprovedChangeWithSkillAgent(session)

    if (executableSession.request.target === 'consensus') {
      const result = 'Project Change Tool recorded the approved meeting consensus.'
      messages.value.push({
        id: createId('system'),
        role: 'system',
        content: `${result}\nAll agents must treat this consensus as accepted meeting guidance until the user requests a new direction.`,
        tool: createToolMessage('record_meeting_consensus', 'success', 'Meeting consensus recorded', executableSession.request.scope, executableSession.request.purpose, '', executableSession.request.content),
        createdAt: new Date().toISOString(),
      })
      rememberAcceptedChangeForAllAgents(agents.value, executableSession, result)
      changeVoteSession.value = { ...executableSession, status: 'applied', result, completedAt: new Date().toISOString() }
      return
    }

    if (executableSession.request.target === 'master-outline') {
      const before = project.outline || ''
      const saved = await projectStore.updateProject(project.id, { outline: executableSession.request.content })
      if (saved === null) throw new Error('Failed to save master outline change to the project file.')
      await verifyProjectPersistence(
        project.id,
        reloaded => (reloaded.outline || '') === executableSession.request.content,
        'The master outline change did not persist to the project file.'
      )
      const result = 'Project Change Tool applied the approved change to the master outline.'
      messages.value.push({
        id: createId('system'),
        role: 'system',
        content: `${result}\nAll agents must treat this applied change as accepted source-of-truth. Do not revert it unless the user explicitly requests a new change.`,
        tool: createToolMessage('replace_master_outline', 'success', 'Master outline updated', executableSession.request.scope, executableSession.request.purpose, before, executableSession.request.content),
        createdAt: new Date().toISOString(),
      })
      rememberAcceptedChangeForAllAgents(agents.value, executableSession, result)
      changeVoteSession.value = { ...executableSession, status: 'applied', result, completedAt: new Date().toISOString() }
      return
    }

    if (executableSession.request.target === 'characters') {
      const rawCharacters = parseCharacterPayload(executableSession.request.content)
      if (!rawCharacters.length) throw new Error('Character changes need at least one inferable character name and description.')
      const before = JSON.stringify(project.characters, null, 2)
      const existingByName = new Map(project.characters.map(character => [character.name.trim().toLowerCase(), character]))
      const incoming = rawCharacters.map((item: any, index: number) => normalizeReviewCharacter(item, project.characters.length + index))
      const merged = [...project.characters]
      for (const character of incoming) {
        const key = character.name.trim().toLowerCase()
        const existing = existingByName.get(key)
        if (existing) {
          const index = merged.findIndex(item => item.id === existing.id)
          merged[index] = { ...existing, ...character, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() }
        } else {
          merged.push(character)
        }
      }
      const saved = await projectStore.updateProject(project.id, { characters: merged })
      if (saved === null) throw new Error('Failed to save character changes to the project file.')
      const incomingNames = new Set(incoming.map(character => character.name.trim().toLowerCase()).filter(Boolean))
      await verifyProjectPersistence(
        project.id,
        reloaded => Array.isArray(reloaded.characters)
          && [...incomingNames].every(name => reloaded.characters.some(character => character?.name?.trim?.().toLowerCase() === name)),
        'The character change did not persist to the project file.'
      )
      const after = JSON.stringify(merged, null, 2)
      const result = `Project Change Tool applied the approved character change (${incoming.length} character${incoming.length === 1 ? '' : 's'}).`
      messages.value.push({
        id: createId('system'),
        role: 'system',
        content: `${result}\nAll agents must treat this applied change as accepted source-of-truth. Do not revert it unless the user explicitly requests a new change.`,
        tool: createToolMessage('update_characters', 'success', 'Characters updated', executableSession.request.scope, executableSession.request.purpose, before, after),
        createdAt: new Date().toISOString(),
      })
      rememberAcceptedChangeForAllAgents(agents.value, executableSession, result)
      changeVoteSession.value = { ...executableSession, status: 'applied', result, completedAt: new Date().toISOString() }
      return
    }

    const chapter = context().chapter
    if (!chapter) throw new Error('No chapter is selected for chapter-plan changes.')
    const normalizedOutline = normalizeChapterOutlinePatch(chapter, executableSession.request)
    const before = JSON.stringify({ title: chapter.title, outline: chapter.outline }, null, 2)
    const chapters = project.chapters.map(item => item.id === chapter.id
      ? {
          ...item,
          title: item.title,
          outline: normalizedOutline,
          updatedAt: new Date().toISOString(),
        }
      : item
    )
    const saved = await projectStore.updateProject(project.id, { chapters })
    if (saved === null) throw new Error('Failed to save chapter plan change to the project file.')
    await verifyProjectPersistence(
      project.id,
      reloaded => Array.isArray(reloaded.chapters)
        && reloaded.chapters.some(item => item?.id === chapter.id && JSON.stringify(item?.outline ?? null) === JSON.stringify(normalizedOutline)),
      'The chapter plan change did not persist to the project file.'
    )
    const after = JSON.stringify({ title: chapter.title, outline: normalizedOutline }, null, 2)
    const result = `Project Change Tool applied the approved change to Chapter ${chapter.index + 1} plan.`
    messages.value.push({
      id: createId('system'),
      role: 'system',
      content: `${result}\nAll agents must treat this applied change as accepted source-of-truth. Do not revert it unless the user explicitly requests a new change.`,
      tool: createToolMessage('rewrite_chapter_outline', 'success', 'Chapter plan updated', executableSession.request.scope, executableSession.request.purpose, before, after),
      createdAt: new Date().toISOString(),
    })
    rememberAcceptedChangeForAllAgents(agents.value, executableSession, result)
    changeVoteSession.value = { ...executableSession, status: 'applied', result, completedAt: new Date().toISOString() }
  }

  async function runChangeVoteSession(sessionId: string) {
    const voters = changeVoters()
    const majority = Math.floor(voters.length / 2) + 1
    if (!voters.length) {
      if (changeVoteSession.value?.id === sessionId) {
        changeVoteSession.value.status = 'rejected'
        changeVoteSession.value.error = 'No enabled meeting agents are available to vote.'
        changeVoteSession.value.completedAt = new Date().toISOString()
        addChangeVoteSummaryMessage(changeVoteSession.value, 'Project change vote ended without eligible voters. Open this card to inspect the final proposal state.')
        scheduleSave()
      }
      return
    }

    for (const agent of voters) {
      if (changeVoteSession.value?.id !== sessionId || changeVoteSession.value.status !== 'voting') return
      setAgentStatus(agent.id, 'waiting', true)
      await runChangeVoteForAgent(agent, sessionId)
      const session = changeVoteSession.value
      if (!session || session.id !== sessionId) return
      const latestVote = [...session.votes].reverse().find(vote => vote.agentId === agent.id)
      if (!session.amendmentDepth && latestVote?.amendment) {
        const interrupted = await runAmendmentVote(session, latestVote, voters)
        if (interrupted) return
      }
      const approvals = session.votes.filter(vote => vote.vote === 'approve').length
      const rejections = session.votes.filter(vote => vote.vote === 'reject').length
      if (approvals >= majority) {
        let appliedResult = ''
        try {
          await applyApprovedChange(session)
          appliedResult = changeVoteSession.value?.result || 'Approved change was applied.'
        } catch (error: any) {
          const failureReason = error?.message || 'Failed to apply approved change.'
          changeVoteSession.value = {
            ...session,
            status: 'failed',
            error: failureReason,
            completedAt: new Date().toISOString(),
          }
          addSystemMessage(`Project Change Tool failed to apply approved change: ${failureReason}`)
          if (changeVoteSession.value) {
            addChangeVoteSummaryMessage(changeVoteSession.value, 'Project change vote passed, but execution failed. Open this card to inspect the proposal, votes, and failure detail.')
          }
          setTimeout(() => {
            requestAllAgents([
              'The approved project change failed during tool execution. This is a tool/application error, not a reason to end the meeting.',
              'Retry by proposing a corrected REQUEST_CHANGE with clearer actionable content.',
              'Preserve the same user-facing intent unless there is a concrete reason to adjust it.',
              'For target: characters, content can be JSON, bullets, or prose, but must include inferable names and descriptions.',
              'For target: chapter-plan, content should clearly include the chapter outline fields; JSON is preferred but the skill tool can normalize prose.',
              `Failed target: ${session.request.target}`,
              `Failed scope: ${session.request.scope}`,
              `Failure reason: ${failureReason}`,
            ].join('\n'), { mandatoryBrainstorm: false })
          }, 0)
        }
        scheduleSave()
        if (changeVoteSession.value?.status === 'applied') {
          addChangeVoteSummaryMessage(changeVoteSession.value, 'Project change vote completed. Open this card to inspect the proposal, votes, and applied result.')
          setTimeout(() => {
            requestAllAgents(buildPostToolReviewFocus(session, appliedResult), { mandatoryBrainstorm: false })
          }, 0)
        }
        return
      }
      if (rejections >= majority) {
        changeVoteSession.value = {
          ...session,
          status: 'rejected',
          result: 'The proposed change did not receive majority approval.',
          completedAt: new Date().toISOString(),
        }
        addSystemMessage('Project change was rejected by majority vote.')
        addChangeVoteSummaryMessage(changeVoteSession.value, 'Project change vote was rejected. Open this card to inspect the proposal and vote breakdown.')
        scheduleSave()
        setTimeout(() => {
          requestAllAgents([
            'A proposed change was rejected by majority vote. This does not end the meeting.',
            'Re-evaluate the latest user request as the highest-priority requirement.',
            'Explain what the rejected proposal failed to satisfy, if anything.',
            'If the proposal actually best matched the user request, propose a corrected consensus/change vote instead of stopping.',
            'If another approach would better satisfy the user, propose that alternative with concrete scope, purpose, and content.',
            'Do not request ending the meeting until the user need is satisfied or a valid end request is explicitly justified.',
            `Rejected target: ${session.request.target}`,
            `Rejected scope: ${session.request.scope}`,
            `Rejected purpose: ${session.request.purpose}`,
          ].join('\n'), { mandatoryBrainstorm: false })
        }, 0)
        return
      }
    }
  }

  function stopActiveTurns() {
    runGeneration.value += 1
    for (const controller of activeAbortControllers.values()) {
      controller.abort()
    }
    activeAbortControllers.clear()
    speakingQueue.value = []
    activeSpeakerIds.value = []
    changeVoteSession.value = changeVoteSession.value?.status === 'voting' || changeVoteSession.value?.status === 'applying' ? null : changeVoteSession.value
    loading.value = false
    brainstormingMode.value = false
    mandatoryBrainstormActive.value = false
    for (const agent of agents.value) {
      if (agent.status === 'speaking' || agent.status === 'waiting' || agent.status === 'requesting' || agent.status === 'blocked') {
        setAgentStatus(agent.id, 'idle', false)
      }
    }
  }

  function endMeeting(reason = 'User ended the meeting.') {
    stopActiveTurns()
    endVoteSession.value = null
    askUserSession.value = null
    changeVoteSession.value = null
    meetingEnded.value = true
    addSystemMessage(reason)
    scheduleSave()
  }

  async function runAgentTurn(agent: ReviewAgentState, request: ReviewSpeechRequest) {
    const generation = runGeneration.value
    providerManager.setProviders(providerStore.providers)
    const preferred = decodeProviderModelRef(agent.modelValue)
    const model = providerStore.getAvailableModelRefForRole(agent.defaultModelRole, preferred)
      ?? providerStore.getAvailableModelRefForRole('chapterPlanner')
      ?? providerStore.getAvailableModelRefForRole('proofreader')
      ?? providerStore.getDefaultModelRefForRole(agent.defaultModelRole)
    if (!model) {
      setAgentStatus(agent.id, 'blocked', false)
      agent.toolState.error = 'No model available for multi-agent review.'
      addSystemMessage(`${agent.name} is blocked: no available model is configured.`)
      return
    }

    const isMandatoryBrainstormTurn = mandatoryBrainstormActive.value && !brainstormRoundCompleted.value
    if (!isMandatoryBrainstormTurn && request.requestedBy !== 'user') {
      const enabledAgentCount = agents.value.filter(a => a.enabled).length
      if (openDiscussionTurnCount.value >= enabledAgentCount * 3) {
        addSystemMessage('System Intervention: open discussion exceeded the normal limit without a concrete tool action. The next turns must converge to a proposal, clarification request, focus proposal, or end request.')
        return
      }
      openDiscussionTurnCount.value++
    }

    const beforeIndex = messages.value.length
    const chatMessages = buildAgentMessages(
      agent,
      messages.value,
      context(),
      request.focus || currentFocus.value,
      selectedContextElements.value,
      request,
      {
        mandatoryBrainstorm: isMandatoryBrainstormTurn,
        openDiscussionTurnCount: openDiscussionTurnCount.value,
        enabledAgentCount: agents.value.filter(a => a.enabled).length,
        maxContextTurns: context().project?.reviewAgentSettings?.maxContextTurns || useUiStore().defaultMaxContextTurns
      }
    )
    const abortController = new AbortController()
    activeAbortControllers.set(agent.id, abortController)
    setAgentStatus(agent.id, 'speaking', false)
    if (!activeSpeakerIds.value.includes(agent.id)) {
      activeSpeakerIds.value.push(agent.id)
    }
    loading.value = true

    try {
      const content = await providerManager.chat(chatMessages, model, 1400, 0.45, abortController.signal)
      if (generation !== runGeneration.value) return
      const clean = stripReasoningText(content) || 'No concrete review notes.'
      const proposal = extractFocusProposal(agent, clean)
      const endRequestReason = extractEndRequest(clean)
      const askUserRequest = extractAskUserRequest(clean)
      const changeRequests = extractChangeRequests(clean)
      const turnRequests = extractTurnRequests(clean)
      const publicMessage = extractPublicAgentMessage(clean)
      if (publicMessage) {
        messages.value.push({
          id: createId('agent'),
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
            requestTurn(agent.id)
          } else if (target.toLowerCase() === 'all') {
            requestAllAgents(currentFocus.value, { mandatoryBrainstorm: false })
          } else {
            const targetAgent = agents.value.find(a => a.id === target || a.name.toLowerCase().includes(target.toLowerCase()))
            if (targetAgent) {
              requestTurn(targetAgent.id)
            }
          }
        }
      }
      if (proposal && isMandatoryBrainstormTurn) {
        addSystemMessage(`${agent.name} attempted a focus proposal during mandatory brainstorm. It will be reconsidered after the brainstorm round.`)
      } else if (proposal) {
        cancelActiveTurnsExcept(agent.id)
        pendingProposal.value = proposal
        addSystemMessage(`${agent.name} created a proposal that requires user approval.`)
      }
      if (endRequestReason && isMandatoryBrainstormTurn) {
        addSystemMessage(`${agent.name} attempted to request ending during mandatory brainstorm. End requests are disabled until open discussion starts.`)
      } else if (endRequestReason) {
        requestEndVote(agent, endRequestReason)
      }
      if (askUserRequest && isMandatoryBrainstormTurn) {
        addSystemMessage(`${agent.name} attempted to ask the user during mandatory brainstorm. Clarification requests can be raised after open discussion starts.`)
      } else if (askUserRequest) {
        requestAskUserVote(agent, askUserRequest)
      }
      if (changeRequests.length) {
        for (const changeRequest of changeRequests) {
          if (isMandatoryBrainstormTurn) {
            pendingChangeRequests.value.push({ agent, request: changeRequest })
            addSystemMessage(`${agent.name} attempted a proposal during mandatory brainstorm. It was queued until the brainstorm round completes.`)
          } else {
            requestChangeVote(agent, changeRequest)
          }
        }
      }
      agent.privateMemory = [
        ...agent.privateMemory,
        `Turn ${new Date().toLocaleString()}: ${clean.slice(0, 700)}`,
      ].slice(-12)
      agent.lastSeenMessageIndex = messages.value.length
      agent.workspaceState = {
        ...agent.workspaceState,
        lastInputMessageCount: beforeIndex,
        lastFocus: request.focus || currentFocus.value,
        lastRequestSource: request.requestedBy,
      }
      setAgentStatus(agent.id, 'idle', false)
    } catch (error: any) {
      if (generation !== runGeneration.value || abortController.signal.aborted || error?.name === 'AbortError') return
      agent.toolState.error = error?.message || 'Agent turn failed'
      addSystemMessage(`${agent.name} failed to speak: ${agent.toolState.error}`)
      setAgentStatus(agent.id, 'blocked', false)
    } finally {
      activeAbortControllers.delete(agent.id)
      if (generation !== runGeneration.value) return
      activeSpeakerIds.value = activeSpeakerIds.value.filter(id => id !== agent.id)
      loading.value = activeSpeakerIds.value.length > 0
      scheduleSave()
    }
  }

  async function processQueue() {
    if (processing) return
    processing = true
    const queueGeneration = runGeneration.value
    try {
      if (brainstormingMode.value) {
        const wasMandatoryBrainstorm = mandatoryBrainstormActive.value && !brainstormRoundCompleted.value
        const parallelTasks: Promise<void>[] = []
        while (canStartAgentTurn.value) {
          const request = speakingQueue.value.shift()
          if (!request) break
          const agent = getAgentStateById(request.agentId)
          if (!agent) continue
          parallelTasks.push(runAgentTurn(agent, request))
        }
        await Promise.all(parallelTasks)
        if (queueGeneration !== runGeneration.value) return
        if (speakingQueue.value.length === 0) {
          brainstormingMode.value = false
          if (wasMandatoryBrainstorm) {
            mandatoryBrainstormActive.value = false
            brainstormRoundCompleted.value = true
            openDiscussionTurnCount.value = 0
            addSystemMessage('Mandatory brainstorm round complete. The meeting is now open: agents may respond to each other, challenge assumptions, refine shared direction, or use tools when justified.')
            const hadQueuedChange = pendingChangeRequests.value.length > 0
            flushPendingChangeRequest()
            if (!hadQueuedChange && !meetingEnded.value && endVoteSession.value?.status !== 'voting' && askUserSession.value?.status !== 'ready') {
              const continuationGeneration = runGeneration.value
              setTimeout(() => {
                if (continuationGeneration !== runGeneration.value || meetingEnded.value) return
                requestAllAgents([
                  'Continue the meeting in open discussion mode.',
                  'This is the first open discussion pass for the non-proposer agents.',
                  'The Proposer Agent should stay silent for this pass and observe the discussion.',
                  'Respond to the completed brainstorm: challenge weak assumptions, refine strong ideas, combine compatible directions, or explain what remains unclear.',
                  'Do not treat this as a required proposal round for the non-proposer agents.',
                ].join('\n'), {
                  mandatoryBrainstorm: false,
                  resetTurnCount: false,
                  agentFilter: agent => agent.id !== 'proposer',
                })
              }, 0)
            }
          }
        }
      } else {
        while (canStartAgentTurn.value) {
          const request = speakingQueue.value.shift()
          if (!request) break
          const agent = getAgentStateById(request.agentId)
          if (!agent) continue
          await runAgentTurn(agent, request)
          if (queueGeneration !== runGeneration.value) return
        }

        if (
          speakingQueue.value.length === 0 &&
          !meetingEnded.value &&
          !pendingProposal.value &&
          endVoteSession.value?.status !== 'voting' &&
          changeVoteSession.value?.status !== 'voting' &&
          changeVoteSession.value?.status !== 'applying' &&
          askUserSession.value?.status !== 'ready' &&
          !userTyping.value &&
          !inputText.value.trim()
        ) {
          const internalProposer = proposerAgent.value.enabled ? proposerAgent.value : null
          if (
            internalProposer &&
            openDiscussionTurnCount.value > 0 &&
            !queueHasAgent(internalProposer.id) &&
            !activeSpeakerIds.value.includes(internalProposer.id)
          ) {
            const lastProposerMemory = internalProposer.privateMemory[internalProposer.privateMemory.length - 1] || ''
            const hasRecentProposalDuty = lastProposerMemory.includes('Proposer duty round')
            if (!hasRecentProposalDuty) {
              internalProposer.privateMemory = [
                ...internalProposer.privateMemory,
                `Proposer duty round ${new Date().toLocaleString()}: after observing the first open-discussion pass, you must now synthesize the discussion into one concrete proposal action.`,
              ].slice(-12)
              requestTurn(internalProposer.id, [
                'Proposer duty round.',
                'The first open discussion pass by the other agents has finished.',
                'You did not participate in that pass. Now synthesize their discussion.',
                'You must create exactly one concrete next-step tool action in this turn if enough information exists: preferably [REQUEST_CHANGE], otherwise [ASK_USER], [PROPOSE_FOCUS], or [REQUEST_END].',
                'Do not ask a broad follow-up question. Do not delegate proposal creation to others.',
              ].join('\n'))
              return
            }
          }

          const enabledAgentCount = agents.value.filter(a => a.enabled).length
          if (openDiscussionTurnCount.value >= enabledAgentCount * 3) {
            const continuationGeneration = runGeneration.value
            setTimeout(() => {
              if (continuationGeneration !== runGeneration.value || meetingEnded.value || speakingQueue.value.length > 0) return
              addSystemMessage('System Intervention: forcing convergence after extended open discussion.')
              requestAllAgents([
                'Converge now.',
                'Do not continue general discussion.',
                'In this round, each agent must do one of these if justified: create [REQUEST_CHANGE], create [ASK_USER], create [PROPOSE_FOCUS], or create [REQUEST_END].',
                'If a project edit is already clearly needed, create [REQUEST_CHANGE] now instead of describing it abstractly.',
              ].join('\n'), {
                mandatoryBrainstorm: false,
                resetTurnCount: false,
                agentFilter: agent => agent.id !== 'proposer',
              })
            }, 500)
          } else if (openDiscussionTurnCount.value > 0) {
            const continuationGeneration = runGeneration.value
            setTimeout(() => {
              if (continuationGeneration !== runGeneration.value || meetingEnded.value || speakingQueue.value.length > 0) return
              addSystemMessage('Auto-continuing to the next round of discussion.')
              requestAllAgents(currentFocus.value, {
                mandatoryBrainstorm: false,
                resetTurnCount: false,
                agentFilter: agent => agent.id !== 'proposer',
              })
            }, 500)
          }
        }
      }
      if (speakingQueue.value.length && (userTyping.value || inputText.value.trim())) {
        markQueuedAgentsBlocked()
      }
    } finally {
      processing = false
      if (canStartAgentTurn.value) void processQueue()
    }
  }

  function clearConversation() {
    stopActiveTurns()
    clearChangeVoteCleanupTimer()
    messages.value = []
    speakingQueue.value = []
    activeSpeakerIds.value = []
    pendingProposal.value = null
    endVoteSession.value = null
    askUserSession.value = null
    changeVoteSession.value = null
    meetingEnded.value = false
    brainstormingMode.value = false
    mandatoryBrainstormActive.value = false
    brainstormRoundCompleted.value = false
    pendingChangeRequests.value = []
    agents.value = getReviewAgentDefinitions(context().project).map(definition => createAgentState(definition, context().project))
    proposerAgent.value = createAgentState({
      ...internalProposerAgentDefinition,
      systemPrompt: uiStore.meetingProposerPrompt || internalProposerAgentDefinition.systemPrompt,
    })
    addSystemMessage('Multi-agent story meeting was reset.')
    scheduleSave()
  }

  watch([projectId, conversationKey], () => {
    void load()
  }, { immediate: true })

  watch(messages, scheduleSave, { deep: true })
  watch(agents, scheduleSave, { deep: true })
  watch(proposerAgent, scheduleSave, { deep: true })
  watch(currentFocus, scheduleSave)
  watch(() => `${changeVoteSession.value?.id || ''}:${changeVoteSession.value?.status || ''}`, () => {
    clearChangeVoteCleanupTimer()
    const session = changeVoteSession.value
    if (!session || !isTerminalChangeVoteStatus(session.status)) return
    const sessionId = session.id
    changeVoteCleanupTimer.value = setTimeout(() => {
      if (changeVoteSession.value?.id !== sessionId) return
      if (!isTerminalChangeVoteStatus(changeVoteSession.value.status)) return
      changeVoteSession.value = null
      scheduleSave()
    }, 12000)
  })
  watch(() => uiStore.meetingProposerPrompt, (value) => {
    proposerAgent.value.systemPrompt = value || internalProposerAgentDefinition.systemPrompt
    proposerAgent.value.customSystemPrompt = value || internalProposerAgentDefinition.systemPrompt
  })

  onBeforeUnmount(() => {
    if (idleTimer) clearTimeout(idleTimer)
    if (saveTimer.value) clearTimeout(saveTimer.value)
    clearChangeVoteCleanupTimer()
    void persist()
  })

  return {
    agents,
    messages,
    speakingQueue,
    activeSpeakerIds,
    currentFocus,
    selectedContextElements,
    pendingProposal,
    endVoteSession,
    askUserSession,
    changeVoteSession,
    meetingEnded,
    inputText,
    userTyping,
    loading,
    loaded,
    requestTurn,
    requestAllAgents,
    requestAllAgentsSequentially,
    userRequestTurn,
    addAgent,
    setAgentEnabled,
    deleteAgent,
    restoreDefaultAgents,
    handleInput,
    sendUserMessage,
    setContextElement,
    updateAgentSettings,
    approveProposal,
    rejectProposal,
    approveEndVoteSession,
    rejectEndVoteSession,
    answerAskUser,
    dismissChangeVoteSession: () => {
      clearChangeVoteCleanupTimer()
      changeVoteSession.value = null
      scheduleSave()
    },
    stopActiveTurns,
    endMeeting,
    clearConversation,
  }
}
