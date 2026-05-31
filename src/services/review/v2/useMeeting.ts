/**
 * Meeting v2 — Vue Composable (Master-Worker)
 *
 * Flow per round:
 * 1. Sub-agents (reviewers) analyze in parallel → short text reports
 * 2. Master agent reads reports + context → calls execute_action directly
 * 3. Action executes immediately, no voting
 * 4. Master decides: another round, ask user, or end
 */

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useProviderStore } from '@/stores/provider'
import { useProjectStore } from '@/stores/project'
import { loadVibeConversation, saveVibeConversation } from '@/services/vibeChatStorage'
import { createId } from '@/services/review/definitions'
import { toStoredMessages, fromStoredMessages } from '@/services/review/storage'
import { getReviewAgentDefinitions, createAgentState, normalizeAgentState, internalProposerAgentDefinition } from '@/services/review/definitions'
import type { ReviewAgentState } from '@/services/review/types'
import { runSubAgentAnalysis, runMasterTurn, runVerifierTurn } from './agentRunner'
import { executeChangeRequest } from './actionExecutor'
import { createMeetingMachine, isTerminalPhase } from './meetingMachine'
import type { MachineEvent } from './meetingMachine'
import type {
  ActionSession,
  AgentState,
  ClarificationSession,
  ContextElement,
  MeetingContext,
  MeetingMessage,
  PhaseState,
  VerificationSession,
} from './types'

export function useMeeting(context: () => MeetingContext) {
  const providerStore = useProviderStore()
  const projectStore = useProjectStore()
  const machine = createMeetingMachine()

  // ── State ──────────────────────────────────────────────────────────────────

  const agents = ref<AgentState[]>([])
  const messages = ref<MeetingMessage[]>([])
  const phase = ref<PhaseState>({
    phase: 'idle',
    discussionTurns: 0,
    maxDiscussionTurns: 6,
    synthesisAttempts: 0,
    focus: '',
  })
  const actionSession = ref<ActionSession | null>(null)
  const clarificationSession = ref<ClarificationSession | null>(null)
  const verificationSession = ref<VerificationSession | null>(null)
  const selectedContextElements = ref<ContextElement[]>([
    'story-config', 'master-outline', 'characters', 'selected-chapter', 'chapter-plan', 'chapter-draft',
  ])
  const autoContinue = ref(true)
  const maxAutoRounds = ref(5)
  const roundCount = ref(0)
  const taskGoal = ref('')
  const inputText = ref('')
  const loading = ref(false)
  const loaded = ref(false)
  const activeAgentIds = ref<string[]>([])

  // ── Internal ───────────────────────────────────────────────────────────────

  const abortControllers = new Map<string, AbortController>()
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const generation = ref(0)

  // ── Derived ────────────────────────────────────────────────────────────────

  const projectId = computed(() => context().project?.id ?? 'local')
  const directoryPath = computed(() => context().project?.directoryPath ?? undefined)
  const conversationKey = computed(() => {
    const chapterId = context().chapter?.id ?? 'global'
    return `chapter-outline-review.v2.${chapterId}`
  })
  const currentPhase = computed(() => phase.value.phase)
  const meetingEnded = computed(() => phase.value.phase === 'ended')
  const isWaitingForUser = computed(
    () => clarificationSession.value?.status === 'pending' || phase.value.phase === 'idle',
  )

  // ── Helpers ────────────────────────────────────────────────────────────────

  function addSystemMessage(content: string) {
    messages.value.push({ id: createId('sys'), role: 'system', content, createdAt: new Date().toISOString() })
  }

  function toActionVoteSnapshot(session: ActionSession) {
    return {
      id: session.id,
      requestedByAgentId: session.proposedByAgentId,
      requestedByAgentName: session.proposedByAgentName,
      request: session.request,
      status: session.status === 'running' ? 'applying' as const
        : session.status === 'applied' ? 'applied' as const
        : session.status === 'failed' ? 'failed' as const
        : 'rejected' as const,
      votes: [],
      result: session.result,
      error: session.error,
      createdAt: session.createdAt,
      completedAt: session.completedAt,
      executionTimeline: [],
      executionLedger: [],
    }
  }

  function scheduleSave() {
    if (!loaded.value) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void persist(), 300)
  }

  function enabledAgents() { return agents.value.filter(a => a.enabled) }
  function getAgent(id: string) { return agents.value.find(a => a.id === id) ?? null }
  function getMaster() { return agents.value.find(a => a.role === 'proposer' && a.enabled) ?? null }
  function getSubAgents() { return agents.value.filter(a => a.role === 'reviewer' && a.enabled) }

  // ── Core round ─────────────────────────────────────────────────────────────

  async function runRound(gen: number) {
    if (gen !== generation.value) return
    roundCount.value += 1
    loading.value = true

    // Step 1: Sub-agents analyze in parallel
    const subAgents = getSubAgents()
    const master = getMaster()

    const reports: Array<{ agentName: string; report: string }> = []

    if (subAgents.length > 0) {
      activeAgentIds.value = subAgents.map(a => a.id)
      const aborts = subAgents.map(a => {
        const ctrl = new AbortController()
        abortControllers.set(a.id, ctrl)
        return ctrl
      })

      const results = await Promise.all(
        subAgents.map((agent, i) =>
          runSubAgentAnalysis(
            agent,
            messages.value,
            context(),
            phase.value.focus,
            selectedContextElements.value,
            providerStore,
            aborts[i].signal,
          ).catch(() => '')
        ),
      )

      subAgents.forEach((agent, i) => {
        abortControllers.delete(agent.id)
        const report = results[i]
        if (report) {
          reports.push({ agentName: agent.name, report })
          agent.privateMemory = [...agent.privateMemory, `Analysis: ${report.slice(0, 400)}`].slice(-8)
          agent.lastSeenMessageIndex = messages.value.length
        }
      })
      activeAgentIds.value = []
    }

    if (gen !== generation.value) return

    // Emit sub-agent reports as a combined system message (visible to user)
    if (reports.length > 0) {
      const combined = reports.map(r => `**${r.agentName}:** ${r.report}`).join('\n\n')
      messages.value.push({
        id: createId('agent'),
        role: 'agent',
        agentId: 'analysis',
        agentName: 'Analysis Round',
        content: combined,
        createdAt: new Date().toISOString(),
      })
    }

    // Transition to synthesis
    const analysisTransition = machine.transition(phase.value, agents.value, { type: 'ANALYSIS_DONE' })
    phase.value = analysisTransition.phaseState
    if (analysisTransition.systemMessage) addSystemMessage(analysisTransition.systemMessage)

    if (!master || analysisTransition.nextAgents.length === 0) {
      loading.value = false
      scheduleSave()
      return
    }

    // Step 2: Master decides and acts
    await runMasterStep(master, reports, gen)
  }

  async function runMasterStep(
    master: AgentState,
    reports: Array<{ agentName: string; report: string }>,
    gen: number,
  ) {
    if (gen !== generation.value) return
    activeAgentIds.value = [master.id]
    const abort = new AbortController()
    abortControllers.set(master.id, abort)

    try {
      const turnInstruction = phase.value.synthesisAttempts > 0
        ? 'RETRY: You must call execute_action now. Do not send a message without acting.'
        : ''

      const result = await runMasterTurn(
        master,
        reports,
        messages.value,
        context(),
        phase.value.focus,
        selectedContextElements.value,
        providerStore,
        turnInstruction,
        abort.signal,
      )

      if (gen !== generation.value || abort.signal.aborted) return

      master.privateMemory = [...master.privateMemory, result.privateNote].slice(-8)
      master.lastSeenMessageIndex = messages.value.length

      if (result.publicMessage) {
        messages.value.push({
          id: createId('agent'),
          role: 'agent',
          agentId: master.id,
          agentName: master.name,
          content: result.publicMessage,
          createdAt: new Date().toISOString(),
        })
      }

      // Handle clarification
      if (result.intent?.type === 'ask_user') {
        const { question, options, reason } = result.intent
        clarificationSession.value = {
          id: createId('clarify'),
          question,
          options,
          reason,
          requestedByAgentId: master.id,
          requestedByAgentName: master.name,
          status: 'pending',
          createdAt: new Date().toISOString(),
        }
        const t = machine.transition(phase.value, agents.value, { type: 'MASTER_TURN_DONE', result })
        phase.value = t.phaseState
        if (t.systemMessage) addSystemMessage(t.systemMessage)
        loading.value = false
        scheduleSave()
        return
      }

      const t = machine.transition(phase.value, agents.value, { type: 'MASTER_TURN_DONE', result })
      phase.value = t.phaseState
      if (t.systemMessage) addSystemMessage(t.systemMessage)

      if (result.intent?.type === 'propose_action') {
        // Execute immediately
        await executeAction(result.intent.request, master, gen)
        return
      }

      if (isTerminalPhase(t.nextPhase)) {
        loading.value = false
        scheduleSave()
        return
      }

      // Retry master if needed
      if (t.nextAgents.includes(master.id)) {
        await runMasterStep(master, reports, gen)
        return
      }

      loading.value = false
      scheduleSave()
    } catch (err: any) {
      if (abort.signal.aborted || err?.name === 'AbortError') return
      addSystemMessage(`Master agent failed: ${err?.message || 'Unknown error'}`)
      loading.value = false
      scheduleSave()
    } finally {
      abortControllers.delete(master.id)
      activeAgentIds.value = []
    }
  }

  // ── Action Execution ───────────────────────────────────────────────────────

  async function executeAction(
    request: import('./types').ChangeRequest,
    agent: AgentState,
    gen: number,
  ) {
    const session: ActionSession = {
      id: createId('action'),
      request,
      proposedByAgentId: agent.id,
      proposedByAgentName: agent.name,
      status: 'running',
      createdAt: new Date().toISOString(),
    }
    actionSession.value = session
    addSystemMessage(`Executing: ${request.action} on ${request.target} — ${request.scope}`)

    try {
      const result = await executeChangeRequest(request, {
        context: context(),
        messages: messages.value,
        providerStore,
        projectStore,
        onProgress: (msg) => addSystemMessage(msg),
        onMessage: (content, tool) => {
          messages.value.push({ id: createId('sys'), role: 'system', content, tool, createdAt: new Date().toISOString() } as any)
        },
      })

      session.status = 'applied'
      session.result = result
      session.completedAt = new Date().toISOString()
      actionSession.value = { ...session }
      messages.value.push({
        id: createId('sys'),
        role: 'system',
        content: `✓ ${result}`,
        actionSnapshot: { ...session },
        actionVoteSnapshot: toActionVoteSnapshot(session),
        createdAt: new Date().toISOString(),
      } as any)

      if (gen !== generation.value) return
      await runVerificationStep(result, gen)
    } catch (err: any) {
      const error = err?.message || 'Unknown error'
      session.status = 'failed'
      session.error = error
      session.completedAt = new Date().toISOString()
      actionSession.value = { ...session }
      addSystemMessage(`Action failed: ${error}`)

      if (gen !== generation.value) return
      phase.value = { ...phase.value, phase: 'idle', synthesisAttempts: 0 }
      addSystemMessage('Round stopped after the failed tool action. Adjust the focus or message, then start another round.')
      loading.value = false
      scheduleSave()
    }
  }

  async function runVerificationStep(latestActionResult: string, gen: number) {
    if (gen !== generation.value) return
    const verifier = getMaster()
    if (!verifier) {
      phase.value = { ...phase.value, phase: 'idle', synthesisAttempts: 0 }
      addSystemMessage('Round complete. No verifier agent is available, so automatic continuation stopped.')
      loading.value = false
      scheduleSave()
      return
    }

    phase.value = { ...phase.value, phase: 'verify', synthesisAttempts: 0 }
    activeAgentIds.value = [verifier.id]
    const abort = new AbortController()
    const verifierId = `${verifier.id}:verifier`
    abortControllers.set(verifierId, abort)

    try {
      const result = await runVerifierTurn(
        verifier,
        messages.value,
        context(),
        taskGoal.value || phase.value.focus,
        phase.value.focus,
        latestActionResult,
        selectedContextElements.value,
        providerStore,
        roundCount.value,
        maxAutoRounds.value,
        abort.signal,
      )

      if (gen !== generation.value || abort.signal.aborted) return

      const session: VerificationSession = {
        id: createId('verify'),
        ...result,
        round: roundCount.value,
        createdAt: new Date().toISOString(),
      }
      verificationSession.value = session

      const remaining = session.remainingCriteria.length
        ? `\nRemaining:\n${session.remainingCriteria.map(item => `- ${item}`).join('\n')}`
        : ''
      addSystemMessage(`Verification: ${session.status}. ${session.reason}${remaining}`)

      abortControllers.delete(verifierId)
      activeAgentIds.value = []

      if (session.status === 'complete') {
        phase.value = { ...phase.value, phase: 'idle', focus: taskGoal.value || phase.value.focus, synthesisAttempts: 0 }
        addSystemMessage('Initial meeting task is complete. Start another round only if you want additional changes.')
        loading.value = false
        scheduleSave()
        return
      }

      if (session.status === 'ask_user') {
        phase.value = { ...phase.value, phase: 'idle', focus: session.nextFocus || phase.value.focus, synthesisAttempts: 0 }
        addSystemMessage('Verifier needs user input before continuing automatically.')
        loading.value = false
        scheduleSave()
        return
      }

      if (session.status === 'blocked') {
        phase.value = { ...phase.value, phase: 'idle', focus: session.nextFocus || phase.value.focus, synthesisAttempts: 0 }
        addSystemMessage('Automatic continuation stopped because the verifier marked the task blocked.')
        loading.value = false
        scheduleSave()
        return
      }

      if (!autoContinue.value) {
        phase.value = { ...phase.value, phase: 'idle', focus: session.nextFocus || phase.value.focus, synthesisAttempts: 0 }
        addSystemMessage('Verifier found remaining work. Auto-continue is off, so the meeting is waiting for the next round.')
        loading.value = false
        scheduleSave()
        return
      }

      if (roundCount.value >= maxAutoRounds.value) {
        phase.value = { ...phase.value, phase: 'idle', focus: session.nextFocus || phase.value.focus, synthesisAttempts: 0 }
        addSystemMessage(`Verifier found remaining work, but the auto-continue limit (${maxAutoRounds.value}) was reached.`)
        loading.value = false
        scheduleSave()
        return
      }

      if (session.risk === 'high') {
        phase.value = { ...phase.value, phase: 'idle', focus: session.nextFocus || phase.value.focus, synthesisAttempts: 0 }
        addSystemMessage('Verifier found a high-risk next step. Automatic continuation stopped for user review.')
        loading.value = false
        scheduleSave()
        return
      }

      phase.value = { ...phase.value, phase: 'analysis', focus: session.nextFocus || phase.value.focus, synthesisAttempts: 0 }
      addSystemMessage(`Auto-continuing round ${roundCount.value + 1}/${maxAutoRounds.value}: ${phase.value.focus}`)
      scheduleSave()
      await runRound(gen)
    } catch (err: any) {
      if (abort.signal.aborted || err?.name === 'AbortError') return
      abortControllers.delete(verifierId)
      activeAgentIds.value = []
      phase.value = { ...phase.value, phase: 'idle', synthesisAttempts: 0 }
      addSystemMessage(`Verification failed: ${err?.message || 'Unknown error'}`)
      loading.value = false
      scheduleSave()
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async function startMeeting(focus?: string) {
    if (phase.value.phase !== 'idle') return
    const f = focus?.trim() || phase.value.focus || 'Identify the most important issue or opportunity in the selected context and fix it.'
    if (!taskGoal.value || verificationSession.value?.status === 'complete' || roundCount.value === 0) {
      taskGoal.value = f
      roundCount.value = 0
      verificationSession.value = null
    }
    const t = machine.transition(phase.value, agents.value, { type: 'START', focus: f })
    phase.value = t.phaseState
    if (t.systemMessage) addSystemMessage(t.systemMessage)
    await runRound(generation.value)
  }

  async function sendUserMessage(content: string) {
    const text = content.trim()
    if (!text) return

    if (clarificationSession.value?.status === 'pending') {
      clarificationSession.value = { ...clarificationSession.value, status: 'answered', answer: text }
    }
    if (phase.value.phase === 'idle') {
      taskGoal.value = text
      roundCount.value = 0
      verificationSession.value = null
    }

    messages.value.push({ id: createId('user'), role: 'user', content: text, createdAt: new Date().toISOString() })
    inputText.value = ''
    scheduleSave()
    await nextTick()

    const gen = generation.value
    const t = machine.transition(phase.value, agents.value, { type: 'USER_MESSAGE', content: text })
    phase.value = t.phaseState
    if (t.systemMessage) addSystemMessage(t.systemMessage)
    await runRound(gen)
  }

  async function answerClarification(answer: string) {
    if (!clarificationSession.value || clarificationSession.value.status !== 'pending') return
    clarificationSession.value = { ...clarificationSession.value, status: 'answered', answer }
    addSystemMessage(`User answered: ${answer}`)
    const gen = generation.value
    const t = machine.transition(phase.value, agents.value, { type: 'CLARIFICATION_ANSWERED', answer })
    phase.value = t.phaseState
    if (t.systemMessage) addSystemMessage(t.systemMessage)
    const master = getMaster()
    if (master) await runMasterStep(master, [], gen)
  }

  function stopMeeting() {
    generation.value++
    for (const ctrl of abortControllers.values()) ctrl.abort()
    abortControllers.clear()
    activeAgentIds.value = []
    loading.value = false
    for (const agent of agents.value) agent.status = 'idle'
  }

  function endMeeting(reason = 'User ended the meeting.') {
    stopMeeting()
    phase.value = { ...phase.value, phase: 'ended' }
    addSystemMessage(reason)
    scheduleSave()
  }

  function clearConversation() {
    stopMeeting()
    messages.value = []
    actionSession.value = null
    clarificationSession.value = null
    verificationSession.value = null
    roundCount.value = 0
    taskGoal.value = ''
    phase.value = { phase: 'idle', discussionTurns: 0, maxDiscussionTurns: 6, synthesisAttempts: 0, focus: '' }
    agents.value = buildAgents()
    addSystemMessage('Meeting reset.')
    scheduleSave()
  }

  function setContextElement(element: ContextElement, enabled: boolean) {
    if (enabled && !selectedContextElements.value.includes(element)) {
      selectedContextElements.value = [...selectedContextElements.value, element]
    } else if (!enabled) {
      selectedContextElements.value = selectedContextElements.value.filter(e => e !== element)
    }
  }

  async function setAgentEnabled(agentId: string, enabled: boolean) {
    const agent = getAgent(agentId)
    if (!agent) return
    if (!enabled) {
      abortControllers.get(agentId)?.abort()
      abortControllers.delete(agentId)
      activeAgentIds.value = activeAgentIds.value.filter(id => id !== agentId)
    }
    agent.enabled = enabled
    const project = context().project
    if (project) {
      await projectStore.updateProject(project.id, {
        reviewAgentSettings: {
          agents: {
            ...(project.reviewAgentSettings?.agents ?? {}),
            [agentId]: { ...(project.reviewAgentSettings?.agents?.[agentId] ?? {}), disabled: !enabled },
          },
        },
      })
    }
    scheduleSave()
  }

  async function updateAgentSettings(agentId: string, settings: Partial<{
    name: string
    role: string
    brief: string
    defaultModelRole: 'chapterPlanner' | 'proofreader' | 'proposerAgent'
    modelValue: string
    systemPrompt: string
    customSystemPrompt: string
  }>) {
    const agent = getAgent(agentId)
    if (!agent) return
    const project = context().project
    const nextSettings = {
      ...(project?.reviewAgentSettings?.agents?.[agentId] ?? {}),
      ...settings,
    }
    if (typeof settings.customSystemPrompt === 'string') {
      agent.customSystemPrompt = settings.customSystemPrompt
    }
    if (typeof settings.modelValue === 'string') {
      agent.modelValue = settings.modelValue
    }
    if (typeof settings.name === 'string' && settings.name.trim()) agent.name = settings.name.trim()
    if (typeof settings.role === 'string') agent.brief = settings.role.trim() || agent.brief
    if (typeof settings.brief === 'string') agent.brief = settings.brief.trim() || agent.brief
    if (typeof settings.systemPrompt === 'string' && settings.systemPrompt.trim()) agent.systemPrompt = settings.systemPrompt.trim()

    if (project) {
      await projectStore.updateProject(project.id, {
        reviewAgentSettings: {
          agents: {
            ...(project.reviewAgentSettings?.agents ?? {}),
            [agentId]: nextSettings,
          },
        },
      })
    }
    scheduleSave()
  }

  async function addAgent(data: {
    name: string
    role?: string
    brief?: string
    systemPrompt?: string
    defaultModelRole?: 'chapterPlanner' | 'proofreader' | 'proposerAgent'
  }) {
    const project = context().project
    const name = data.name.trim()
    if (!name) return
    const id = createId('custom-agent')
    const setting = {
      custom: true,
      name,
      role: data.role?.trim() || 'Custom meeting role',
      brief: data.brief?.trim() || 'Custom meeting participant.',
      defaultModelRole: data.defaultModelRole === 'proposerAgent' || data.defaultModelRole === 'proofreader'
        ? data.defaultModelRole
        : 'chapterPlanner' as const,
      systemPrompt: data.systemPrompt?.trim() || 'You are a custom story meeting agent. Provide concise, useful feedback based on the selected context.',
      customSystemPrompt: data.systemPrompt?.trim() || '',
      disabled: false,
      deleted: false,
    }

    if (project) {
      await projectStore.updateProject(project.id, {
        reviewAgentSettings: {
          agents: {
            ...(project.reviewAgentSettings?.agents ?? {}),
            [id]: setting,
          },
        },
      })
    }
    agents.value = buildAgents()
    scheduleSave()
  }

  async function deleteAgent(agentId: string) {
    const project = context().project
    if (project) {
      await projectStore.updateProject(project.id, {
        reviewAgentSettings: {
          agents: {
            ...(project.reviewAgentSettings?.agents ?? {}),
            [agentId]: {
              ...(project.reviewAgentSettings?.agents?.[agentId] ?? {}),
              deleted: true,
              disabled: true,
            },
          },
        },
      })
    }
    agents.value = agents.value.filter(agent => agent.id !== agentId)
    activeAgentIds.value = activeAgentIds.value.filter(id => id !== agentId)
    scheduleSave()
  }

  async function restoreDefaultAgents() {
    const project = context().project
    if (project) {
      await projectStore.updateProject(project.id, { reviewAgentSettings: { agents: {} } })
    }
    clearConversation()
  }

  function reorderAgents(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= agents.value.length || to >= agents.value.length) return
    const next = [...agents.value]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    agents.value = next
    scheduleSave()
  }

  function setAutoContinue(value: boolean) {
    autoContinue.value = value
    scheduleSave()
  }

  function setMaxAutoRounds(value: number) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return
    maxAutoRounds.value = Math.max(1, Math.min(12, Math.trunc(parsed)))
    scheduleSave()
  }

  function dismissActionSession() { actionSession.value = null; scheduleSave() }

  // ── Persistence ────────────────────────────────────────────────────────────

  async function persist() {
    if (!projectId.value || !conversationKey.value) return
    try {
      const state = {
        kind: 'meeting-v2-state',
        phase: phase.value,
        actionSession: actionSession.value,
        clarificationSession: clarificationSession.value,
        verificationSession: verificationSession.value,
        selectedContextElements: selectedContextElements.value,
        autoContinue: autoContinue.value,
        maxAutoRounds: maxAutoRounds.value,
        roundCount: roundCount.value,
        taskGoal: taskGoal.value,
        agents: agents.value.map(a => ({ id: a.id, lastSeenMessageIndex: a.lastSeenMessageIndex, privateMemory: a.privateMemory, modelValue: a.modelValue })),
      }
      await Promise.all([
        saveVibeConversation(projectId.value, directoryPath.value, conversationKey.value, toStoredMessages(messages.value as any), { toolStatuses: [], todoItems: [] }),
        saveVibeConversation(projectId.value, directoryPath.value, `${conversationKey.value}.state`, [{ id: createId('state'), role: 'system' as const, content: JSON.stringify(state), timestamp: new Date().toISOString() }], { toolStatuses: [], todoItems: [] }),
      ])
    } catch (err: any) {
      console.error('[meeting-v2] persist failed:', err?.message)
    }
  }

  async function load() {
    loaded.value = false
    const [conv, stateConv] = await Promise.all([
      loadVibeConversation(projectId.value, directoryPath.value, conversationKey.value),
      loadVibeConversation(projectId.value, directoryPath.value, `${conversationKey.value}.state`),
    ])
    messages.value = fromStoredMessages(conv?.messages ?? []) as any
    const raw = stateConv?.messages?.[0]?.content
    if (raw) {
      try {
        const s = JSON.parse(raw)
        if (s?.kind === 'meeting-v2-state') {
          phase.value = s.phase ?? phase.value
          if (phase.value.phase !== 'idle' && phase.value.phase !== 'ended') {
            phase.value = { ...phase.value, phase: 'idle' }
            addSystemMessage('Previous meeting was interrupted. Start a new meeting to continue.')
          }
          actionSession.value = s.actionSession ?? null
          clarificationSession.value = s.clarificationSession ?? null
          verificationSession.value = s.verificationSession ?? null
          selectedContextElements.value = Array.isArray(s.selectedContextElements) ? s.selectedContextElements : selectedContextElements.value
          autoContinue.value = typeof s.autoContinue === 'boolean' ? s.autoContinue : autoContinue.value
          maxAutoRounds.value = Number.isFinite(Number(s.maxAutoRounds)) ? Math.max(1, Math.min(12, Math.trunc(Number(s.maxAutoRounds)))) : maxAutoRounds.value
          roundCount.value = Number.isFinite(Number(s.roundCount)) ? Math.max(0, Math.trunc(Number(s.roundCount))) : 0
          taskGoal.value = typeof s.taskGoal === 'string' ? s.taskGoal : ''
          agents.value = buildAgents(s.agents)
        }
      } catch { agents.value = buildAgents() }
    } else {
      agents.value = buildAgents()
    }
    loaded.value = true
    if (!messages.value.length) addSystemMessage('Multi-agent story meeting ready. Set a focus and start the meeting.')
  }

  function buildAgents(savedStates?: any[]): AgentState[] {
    const defs = getReviewAgentDefinitions(context().project)
    const reviewers: AgentState[] = defs.map(def => {
      const base: ReviewAgentState = savedStates?.find((s: any) => s?.id === def.id)
        ? normalizeAgentState(savedStates.find((s: any) => s?.id === def.id), def, context().project)
        : createAgentState(def, context().project)
      return toAgentState(base, 'reviewer')
    })
    const proposerDef = { ...internalProposerAgentDefinition }
    const savedProposer = savedStates?.find((s: any) => s?.id === 'proposer')
    const proposerBase: ReviewAgentState = savedProposer
      ? normalizeAgentState(savedProposer, proposerDef, context().project)
      : createAgentState(proposerDef, context().project)
    return [...reviewers, toAgentState(proposerBase, 'proposer')]
  }

  function toAgentState(r: ReviewAgentState, role: AgentState['role']): AgentState {
    return {
      id: r.id, name: r.name, role, brief: r.brief,
      defaultModelRole: r.defaultModelRole, systemPrompt: r.systemPrompt, custom: r.custom,
      enabled: r.enabled, status: 'idle', modelValue: r.modelValue,
      customSystemPrompt: r.customSystemPrompt, privateMemory: r.privateMemory,
      lastSeenMessageIndex: r.lastSeenMessageIndex,
    }
  }

  // ── Watchers ───────────────────────────────────────────────────────────────

  watch([projectId, conversationKey], () => void load(), { immediate: true })
  watch(messages, scheduleSave, { deep: true })
  onBeforeUnmount(() => { if (saveTimer) clearTimeout(saveTimer); void persist() })

  return {
    agents, messages, phase, currentPhase, meetingEnded, isWaitingForUser,
    activeAgentIds, actionSession, clarificationSession, verificationSession, selectedContextElements,
    autoContinue, maxAutoRounds, roundCount, taskGoal,
    inputText, loading, loaded,
    startMeeting, sendUserMessage, answerClarification,
    stopMeeting, endMeeting, clearConversation,
    setContextElement, setAgentEnabled, dismissActionSession,
    updateAgentSettings, addAgent, deleteAgent, restoreDefaultAgents, reorderAgents,
    setAutoContinue, setMaxAutoRounds,
  }
}
