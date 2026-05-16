import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useProviderStore } from '@/stores/provider'
import { useProjectStore } from '@/stores/project'
import { useUiStore } from '@/stores/ui'
import { loadVibeConversation, saveVibeConversation } from '@/services/vibeChatStorage'
import { providerManager } from '@/services/provider'
import { decodeProviderModelRef } from '@/services/provider/catalog'
import type { StoryProject } from '@/types/project'
import type {
  ReviewAgentDefinition,
  ReviewAgentState,
  ReviewAgentStatus,
  ReviewAskUserSession,
  ReviewChangeRequest,
  ReviewChangeVoteSession,
  ReviewContextElement,
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
  parseLooseJson,
  normalizeChangeAction,
  stripReasoningText,
  extractPublicAgentMessage,
} from './utils'
import {
  normalizePublicMessage,
  toStoredMessages,
  fromStoredMessages,
} from './storage'
import { createChangeVoteController, isTerminalChangeVoteStatus } from './changeVoteController'
import { createEndVoteController } from './endVoteController'
import { createAgentTurnController } from './agentTurnController'

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
  const selectedContextElements = ref<ReviewContextElement[]>(['story-config', 'master-outline', 'characters', 'knowledge-base', 'chapter-plan'])
  const pendingProposal = ref<ReviewProposal | null>(null)
  const endVoteSession = ref<ReviewEndVoteSession | null>(null)
  const askUserSession = ref<ReviewAskUserSession | null>(null)
  const changeVoteSession = ref<ReviewChangeVoteSession | null>(null)
  const meetingEnded = ref(false)
  const brainstormingMode = ref(false)
  const mandatoryBrainstormActive = ref(false)
  const openDiscussionTurnCount = ref(0)
  const proposerDutyAttemptCount = ref(0)
  const proposerDutyAwaiting = ref(false)
  const proposerDutyStalled = ref(false)
  const proposerSegmentedFallbackRunning = ref(false)
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

  function parseCharacterDeleteMatchers(content: string): { ids: Set<string>; names: Set<string> } {
    const ids = new Set<string>()
    const names = new Set<string>()
    try {
      const parsed = parseLooseJson(content)
      const items = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.characters)
          ? parsed.characters
          : Array.isArray(parsed?.targets)
            ? parsed.targets
            : parsed?.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)
              ? Object.entries(parsed.data).map(([key, value]) => ({ key, value }))
              : [parsed]
      for (const item of items) {
        if (!item) continue
        if (typeof item === 'string') {
          const normalized = item.trim()
          if (!normalized) continue
          if (/^[a-z0-9_-]{8,}$/i.test(normalized)) ids.add(normalized)
          else names.add(normalized.toLowerCase())
          continue
        }
        if (typeof item === 'object') {
          const maybeId = typeof (item as any).id === 'string' ? (item as any).id.trim() : ''
          const maybeName = typeof (item as any).name === 'string' ? (item as any).name.trim() : ''
          const maybeKey = typeof (item as any).key === 'string' ? (item as any).key.trim() : ''
          if (maybeId) ids.add(maybeId)
          if (maybeName) names.add(maybeName.toLowerCase())
          if (!maybeId && !maybeName && maybeKey) names.add(maybeKey.toLowerCase())
        }
      }
    } catch {
      // Fallback to text parsing below.
    }

    const fromLines = content
      .split(/\r?\n|[,|]/)
      .map(line => line.replace(/^[-*\d.)\s]+/, '').trim())
      .filter(Boolean)
    for (const token of fromLines) {
      if (/^(?:id|name|delete|remove|characters?|targets?)\s*[:：]/i.test(token)) {
        const value = token.split(/[:：]/).slice(1).join(':').trim()
        if (value) {
          if (/^[a-z0-9_-]{8,}$/i.test(value)) ids.add(value)
          else names.add(value.toLowerCase())
        }
        continue
      }
      if (/^[a-z0-9_-]{8,}$/i.test(token)) ids.add(token)
      else if (token.length <= 80) names.add(token.toLowerCase())
    }

    return { ids, names }
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

  function normalizeChangeRequestCompat(request: ReviewChangeRequest | null | undefined): ReviewChangeRequest | null {
    if (!request) return null
    return {
      ...request,
      action: normalizeChangeAction((request as any).action),
    }
  }

  function addChangeVoteSummaryMessage(session: ReviewChangeVoteSession, content: string) {
    messages.value.push({
      id: createId('system'),
      role: 'system',
      content,
      changeVoteSnapshot: {
        ...session,
        request: { ...session.request },
        executionTimeline: Array.isArray(session.executionTimeline) ? [...session.executionTimeline] : [],
        executionLedger: Array.isArray(session.executionLedger)
          ? session.executionLedger.map(entry => ({ ...entry }))
          : [],
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
              ['story-config', 'master-outline', 'characters', 'knowledge-base', 'selected-chapter', 'chapter-plan', 'chapter-plan-overview', 'chapter-draft'].includes(item)
            )
            : selectedContextElements.value
          pendingProposal.value = state.pendingProposal && typeof state.pendingProposal === 'object' ? state.pendingProposal : null
          endVoteSession.value = state.endVoteSession && typeof state.endVoteSession === 'object' ? state.endVoteSession : null
          askUserSession.value = state.askUserSession && typeof state.askUserSession === 'object' ? state.askUserSession : null
          changeVoteSession.value = state.changeVoteSession && typeof state.changeVoteSession === 'object'
            ? {
                ...state.changeVoteSession,
                request: normalizeChangeRequestCompat(state.changeVoteSession.request) || state.changeVoteSession.request,
              }
            : null
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
    proposerDutyAttemptCount.value = 0
    proposerDutyAwaiting.value = false
    proposerDutyStalled.value = false
    proposerSegmentedFallbackRunning.value = false
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
        'If a read/write action is needed, request a project action vote with scope, purpose, and concrete content.',
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
    proposerDutyAttemptCount.value = 0
    proposerDutyAwaiting.value = false
    proposerDutyStalled.value = false
    proposerSegmentedFallbackRunning.value = false
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
    proposerDutyAttemptCount.value = 0
    proposerDutyAwaiting.value = false
    proposerDutyStalled.value = false
    proposerSegmentedFallbackRunning.value = false
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

  const endVoteController = createEndVoteController({
    context,
    providerStore,
    agents,
    messages,
    currentFocus,
    selectedContextElements,
    endVoteSession,
    askUserSession,
    meetingEnded,
    activeAbortControllers,
    inputText,
    addSystemMessage,
    setAgentStatus,
    scheduleSave,
    createId,
    stopActiveTurns,
    requestAllAgents,
    sendUserMessage,
    cancelActiveTurnsExcept,
  })
  const {
    requestEndVote,
    approveEndVoteSession,
    rejectEndVoteSession,
    requestAskUserVote,
    answerAskUser,
  } = endVoteController

  const changeVoteController = createChangeVoteController({
    context,
    providerStore,
    projectStore,
    agents,
    messages,
    currentFocus,
    selectedContextElements,
    changeVoteSession,
    pendingChangeRequests,
    brainstormRoundCompleted,
    brainstormingMode,
    meetingEnded,
    activeAbortControllers,
    addSystemMessage,
    addChangeVoteSummaryMessage,
    setAgentStatus,
    scheduleSave,
    requestAllAgents,
    cancelActiveTurnsExcept,
    normalizeChangeRequestCompat,
    createId,
    verifyProjectPersistence,
  })
  const { requestChangeVote, flushPendingChangeRequest } = changeVoteController

  type ProposerSegmentField = 'target' | 'action' | 'scope' | 'purpose' | 'content'

  function normalizeProposerTarget(value: string): ReviewChangeRequest['target'] | null {
    const text = value.trim().toLowerCase()
    if (!text) return null
    if (text.includes('chapter-plan') || text.includes('chapter plan') || text.includes('章节规划') || text.includes('章节大纲') || text.includes('chapter outline')) {
      return 'chapter-plan'
    }
    if (text.includes('master-outline') || text.includes('master outline') || text.includes('主线大纲') || text.includes('故事大纲') || text.includes('主大纲')) {
      return 'master-outline'
    }
    if (text.includes('characters') || text.includes('character') || text.includes('角色') || text.includes('人物')) {
      return 'characters'
    }
    if (text.includes('consensus') || text.includes('共识')) {
      return 'consensus'
    }
    return null
  }

  function normalizeProposerSegmentAnswer(raw: string): string {
    const clean = stripReasoningText(raw || '')
    const publicPart = extractPublicAgentMessage(clean)
    return (publicPart || clean).trim()
  }

  function buildProposerSegmentPrompt(
    field: ProposerSegmentField,
    draft: Partial<ReviewChangeRequest>,
    discussion: string,
  ) {
    const base = [
      `Meeting language: ${context().project?.language || 'the project Primary Language'}.`,
      'You are in segmented proposal assembly mode.',
      'Return only the requested field value, no explanations, no markdown fences, no extra labels.',
      'If you are unsure, return your best concrete value instead of asking questions.',
      '',
      `Current focus:\n${currentFocus.value || 'No focus set.'}`,
      '',
      'Recent discussion:',
      discussion || 'No recent discussion.',
      '',
      `Collected fields so far:`,
      `target: ${draft.target || '(empty)'}`,
      `action: ${draft.action || '(empty)'}`,
      `scope: ${draft.scope || '(empty)'}`,
      `purpose: ${draft.purpose || '(empty)'}`,
      `content: ${draft.content ? `${draft.content.slice(0, 240)}${draft.content.length > 240 ? '...' : ''}` : '(empty)'}`,
      '',
    ]

    if (field === 'target') {
      base.push('Question: choose exactly one target from master-outline | chapter-plan | characters | consensus.')
    } else if (field === 'action') {
      base.push('Question: choose exactly one action from create | read | update | delete.')
    } else if (field === 'scope') {
      base.push('Question: provide one concise scope line describing which part should change.')
    } else if (field === 'purpose') {
      base.push('Question: provide one concise purpose line describing why this change is needed for user satisfaction.')
    } else {
      base.push('Question: provide the concrete change content to apply. JSON or prose are both acceptable.')
    }

    return base.join('\n')
  }

  async function runProposerSegmentedFallback() {
    if (proposerSegmentedFallbackRunning.value || meetingEnded.value) return false
    const proposer = proposerAgent.value
    if (!proposer.enabled) return false

    providerManager.setProviders(providerStore.providers)
    const preferred = decodeProviderModelRef(proposer.modelValue)
    const model = providerStore.getAvailableModelRefForRole(proposer.defaultModelRole, preferred)
      ?? providerStore.getAvailableModelRefForRole('chapterPlanner')
      ?? providerStore.getAvailableModelRefForRole('proofreader')
      ?? providerStore.getDefaultModelRefForRole(proposer.defaultModelRole)
    if (!model) {
      addSystemMessage('Proposer segmented fallback failed: no available model is configured for the Proposer Agent.')
      return false
    }

    proposerSegmentedFallbackRunning.value = true
    proposerDutyAwaiting.value = true
    setAgentStatus(proposer.id, 'speaking', false)
    if (!activeSpeakerIds.value.includes(proposer.id)) {
      activeSpeakerIds.value.push(proposer.id)
    }
    loading.value = true

    try {
      addSystemMessage('Proposer Agent failed to emit a concrete proposal block in round 1. Starting segmented proposal assembly round.')
      const discussion = messages.value
        .slice(-16)
        .map(msg => {
          if (msg.role === 'agent') return `[${msg.agentName || 'Agent'}] ${msg.content}`
          if (msg.role === 'user') return `[User] ${msg.content}`
          return `[System] ${msg.content}`
        })
        .join('\n\n')

      const draft: Partial<ReviewChangeRequest> = {}
      const fields: ProposerSegmentField[] = ['target', 'action', 'scope', 'purpose', 'content']

      for (const field of fields) {
        const prompt = buildProposerSegmentPrompt(field, draft, discussion)
        const response = await providerManager.chat(
          [
            {
              role: 'system',
              content: [
                proposer.customSystemPrompt || proposer.systemPrompt,
                '',
                'You are being asked to provide one field for a structured project-change proposal.',
                'Return only the field value requested by the user prompt.',
              ].join('\n'),
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          model,
          field === 'content' ? 1800 : 500,
          0.2,
        )
        const answer = normalizeProposerSegmentAnswer(response)
        if (!answer) throw new Error(`Segmented proposal answer is empty for field: ${field}`)
        if (field === 'target') {
          const normalizedTarget = normalizeProposerTarget(answer)
          if (!normalizedTarget) throw new Error(`Invalid target from proposer segmented answer: ${answer}`)
          draft.target = normalizedTarget
          continue
        }
        if (field === 'action') {
          draft.action = normalizeChangeAction(answer)
          continue
        }
        if (field === 'scope') {
          draft.scope = answer
          continue
        }
        if (field === 'purpose') {
          draft.purpose = answer
          continue
        }
        draft.content = answer
      }

      if (!draft.target || !draft.action || !draft.scope || !draft.purpose || !draft.content) {
        throw new Error('Segmented proposal assembly finished with missing required fields.')
      }

      requestChangeVote(proposer, {
        target: draft.target,
        action: draft.action,
        scope: draft.scope,
        purpose: draft.purpose,
        content: draft.content,
      })
      addSystemMessage('Segmented proposal assembly succeeded. The meeting engine auto-created a concrete proposal and moved it to voting.')
      proposerDutyAttemptCount.value = 0
      proposerDutyStalled.value = false
      return true
    } catch (error: any) {
      addSystemMessage(`Segmented proposal assembly failed: ${error?.message || 'Unknown error'}`)
      return false
    } finally {
      proposerSegmentedFallbackRunning.value = false
      proposerDutyAwaiting.value = false
      if (activeSpeakerIds.value.includes(proposer.id)) {
        activeSpeakerIds.value = activeSpeakerIds.value.filter(id => id !== proposer.id)
      }
      if (proposer.status === 'speaking' || proposer.status === 'waiting' || proposer.status === 'requesting' || proposer.status === 'blocked') {
        setAgentStatus(proposer.id, 'idle', false)
      }
      loading.value = activeSpeakerIds.value.length > 0
      scheduleSave()
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
    proposerDutyAwaiting.value = false
    proposerSegmentedFallbackRunning.value = false
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
    proposerDutyAttemptCount.value = 0
    proposerDutyAwaiting.value = false
    proposerDutyStalled.value = false
    proposerSegmentedFallbackRunning.value = false
    addSystemMessage(reason)
    scheduleSave()
  }

  const agentTurnController = createAgentTurnController({
    context,
    providerStore,
    agents,
    messages,
    currentFocus,
    selectedContextElements,
    pendingProposal,
    pendingChangeRequests,
    mandatoryBrainstormActive,
    brainstormRoundCompleted,
    openDiscussionTurnCount,
    activeAbortControllers,
    activeSpeakerIds,
    loading,
    runGeneration,
    addSystemMessage,
    createId,
    setAgentStatus,
    requestTurn,
    requestAllAgents,
    cancelActiveTurnsExcept,
    requestEndVote,
    requestAskUserVote,
    requestChangeVote,
    scheduleSave,
    getMaxContextTurns: () => context().project?.reviewAgentSettings?.maxContextTurns || uiStore.defaultMaxContextTurns,
  })
  const { runAgentTurn } = agentTurnController

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
          const beforeActionState = {
            hasPendingProposal: Boolean(pendingProposal.value),
            endVoteStatus: endVoteSession.value?.status ?? null,
            askUserStatus: askUserSession.value?.status ?? null,
            changeVoteStatus: changeVoteSession.value?.status ?? null,
            pendingChangeCount: pendingChangeRequests.value.length,
          }
          await runAgentTurn(agent, request)
          if (queueGeneration !== runGeneration.value) return
          if (request.agentId === 'proposer' && request.requestedBy === 'agent') {
            proposerDutyAwaiting.value = false
            const proposerProducedAction =
              Boolean(pendingProposal.value)
              || endVoteSession.value?.status === 'voting'
              || askUserSession.value?.status === 'ready'
              || askUserSession.value?.status === 'voting'
              || changeVoteSession.value?.status === 'voting'
              || changeVoteSession.value?.status === 'applying'
              || pendingChangeRequests.value.length > beforeActionState.pendingChangeCount
              || (!beforeActionState.hasPendingProposal && Boolean(pendingProposal.value))
            if (proposerProducedAction) {
              proposerDutyAttemptCount.value = 0
              proposerDutyStalled.value = false
            } else {
              proposerDutyAttemptCount.value += 1
              if (proposerDutyAttemptCount.value === 1) {
                const recovered = await runProposerSegmentedFallback()
                if (!recovered) {
                  proposerDutyStalled.value = true
                  addSystemMessage('Proposer Agent could not produce a concrete proposal in round 1, and segmented round-2 assembly also failed. Auto-round continuation is paused to avoid infinite prompting. Please send user guidance or manually request an agent turn.')
                }
              } else if (proposerDutyAttemptCount.value >= 2) {
                proposerDutyStalled.value = true
                addSystemMessage('Proposer Agent failed to create a concrete proposal after multiple attempts. Auto-round continuation is paused to avoid infinite prompting. Please send user guidance or manually request an agent turn.')
              }
            }
          }
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
          if (proposerDutyStalled.value) {
            return
          }
          const internalProposer = proposerAgent.value.enabled ? proposerAgent.value : null
          if (
            internalProposer &&
            openDiscussionTurnCount.value > 0 &&
            !queueHasAgent(internalProposer.id) &&
            !activeSpeakerIds.value.includes(internalProposer.id) &&
            !proposerDutyAwaiting.value &&
            !proposerSegmentedFallbackRunning.value &&
            proposerDutyAttemptCount.value < 2
          ) {
            proposerDutyAwaiting.value = true
            internalProposer.privateMemory = [
              ...internalProposer.privateMemory,
              `Proposer duty round ${new Date().toLocaleString()}: synthesize open-discussion outcomes into one concrete proposal action.`,
            ].slice(-12)
            requestTurn(internalProposer.id, [
              'Proposer duty round.',
              'The first open discussion pass by the other agents has finished.',
              'Now synthesize their discussion into one concrete next-step action.',
              'You MUST call exactly one actionable function in this turn if enough information exists: prefer request_project_action, otherwise ask_user_clarification, propose_focus, or request_end_meeting.',
              'Do not ask broad follow-up questions. Do not delegate proposal creation. Do not return only commentary.',
              'Your proposal must incorporate at least two concrete points from earlier agent messages (for example specific chapter, scene, character, or constraint details) and reflect them in scope/purpose/content.',
              'If you choose request_project_action, call it with target, action, scope, purpose, and content.',
              'If you include a public explanation, call send_public_message(content) first, then still call exactly one actionable function.',
            ].join('\n'))
            return
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
                'In this round, each agent must do one of these if justified: call request_project_action, call ask_user_clarification, call propose_focus, or call request_end_meeting.',
                'If a project read/write action is already clearly needed, call request_project_action now instead of describing it abstractly.',
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
    proposerDutyAttemptCount.value = 0
    proposerDutyAwaiting.value = false
    proposerDutyStalled.value = false
    proposerSegmentedFallbackRunning.value = false
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
