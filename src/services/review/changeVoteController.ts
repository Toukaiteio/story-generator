import type { Ref } from 'vue'
import { providerManager } from '@/services/provider'
import type { ToolDefinition } from '@/services/provider'
import { decodeProviderModelRef } from '@/services/provider/catalog'
import type { StoryProject } from '@/types/project'
import type { Chapter } from '@/types/chapter'
import type { ProviderModelRef } from '@/types/provider'
import type {
  ReviewAgentState,
  ReviewChangeRequest,
  ReviewChangeAction,
  ReviewChangeTarget,
  ReviewChangeVote,
  ReviewChangeVoteSession,
  ReviewExecutionLedgerEntry,
  ReviewExecutionErrorClass,
  ReviewExecutionPhase,
  ReviewContextElement,
  ReviewPublicMessage,
  MultiAgentReviewContext,
} from './types'
import {
  parseCharacterPayload,
  normalizeReviewCharacter,
  parseLooseJson,
  normalizeChangeAction,
  normalizeChapterOutlinePatch,
  parseChangeVote,
  extractAmendment,
  applyAmendmentToRequest,
  stripReasoningText,
  createToolMessage,
  rememberAcceptedChangeForAllAgents,
  buildPostToolReviewFocus,
} from './utils'
import {
  buildChangeVoteMessages,
  buildSkillAgentMessages,
} from './context'

const CHANGE_VOTE_TOOLS: ToolDefinition[] = [
  {
    name: 'submit_change_vote',
    description: 'Submit your vote for the current project action proposal. Optionally include one amendment.',
    parameters: {
      type: 'object',
      properties: {
        vote: { type: 'string', enum: ['approve', 'reject', 'yes', 'no'] },
        reason: { type: 'string' },
        amendment: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['modify', 'delete', 'insert'] },
            scope: { type: 'string' },
            purpose: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['action', 'scope', 'purpose', 'content'],
        },
      },
      required: ['vote', 'reason'],
    },
  },
]

function normalizeVoteToken(value: unknown): 'approve' | 'reject' {
  const token = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return token === 'approve' || token === 'yes' ? 'approve' : 'reject'
}

function parseChangeVoteFromToolCalls(toolCalls: Array<{ name: string; arguments: Record<string, any> }>) {
  const call = [...toolCalls].reverse().find(item => item.name === 'submit_change_vote')
  if (!call) return null
  const vote = normalizeVoteToken(call.arguments?.vote)
  const reason = typeof call.arguments?.reason === 'string' && call.arguments.reason.trim()
    ? call.arguments.reason.trim()
    : vote === 'approve'
      ? 'The proposed change is safe and useful.'
      : 'The proposed change needs more discussion.'
  const amendmentRaw = call.arguments?.amendment
  const amendment = amendmentRaw && typeof amendmentRaw === 'object'
    ? {
        action: amendmentRaw.action === 'modify' || amendmentRaw.action === 'delete' || amendmentRaw.action === 'insert' ? amendmentRaw.action : undefined,
        scope: typeof amendmentRaw.scope === 'string' ? amendmentRaw.scope.trim() : '',
        purpose: typeof amendmentRaw.purpose === 'string' ? amendmentRaw.purpose.trim() : '',
        content: typeof amendmentRaw.content === 'string' ? amendmentRaw.content.trim() : '',
      }
    : null
  const normalizedAmendment = amendment && amendment.action && amendment.scope && amendment.purpose && amendment.content
    ? amendment
    : null
  return { vote, reason, amendment: normalizedAmendment }
}

type RequestAllAgentsFn = (
  focus?: string,
  options?: {
    mandatoryBrainstorm?: boolean
    resetTurnCount?: boolean
    agentFilter?: (agent: ReviewAgentState) => boolean
  }
) => void

interface ProviderStoreLike {
  providers: any[]
  getAvailableModelRefForRole: (role: any, preferred?: ProviderModelRef | null) => ProviderModelRef | null
  getDefaultModelRefForRole: (role: any) => ProviderModelRef | null
}

interface ProjectStoreLike {
  updateProject: (projectId: string, patch: Partial<StoryProject>) => Promise<StoryProject | null>
}

interface ChangeVoteControllerDeps {
  context: () => MultiAgentReviewContext
  providerStore: ProviderStoreLike
  projectStore: ProjectStoreLike
  agents: Ref<ReviewAgentState[]>
  messages: Ref<ReviewPublicMessage[]>
  currentFocus: Ref<string>
  selectedContextElements: Ref<ReviewContextElement[]>
  changeVoteSession: Ref<ReviewChangeVoteSession | null>
  pendingChangeRequests: Ref<Array<{ agent: ReviewAgentState; request: ReviewChangeRequest }>>
  brainstormRoundCompleted: Ref<boolean>
  brainstormingMode: Ref<boolean>
  meetingEnded: Ref<boolean>
  activeAbortControllers: Map<string, AbortController>
  addSystemMessage: (content: string) => void
  addChangeVoteSummaryMessage: (session: ReviewChangeVoteSession, content: string) => void
  setAgentStatus: (agentId: string, status: ReviewAgentState['status'], waitingForTurn?: boolean) => void
  scheduleSave: () => void
  requestAllAgents: RequestAllAgentsFn
  cancelActiveTurnsExcept: (agentId: string) => void
  normalizeChangeRequestCompat: (request: ReviewChangeRequest | null | undefined) => ReviewChangeRequest | null
  createId: (prefix: string) => string
  verifyProjectPersistence: (projectId: string, verify: (project: StoryProject) => boolean, errorMessage: string) => Promise<void>
}

function normalizeOutlineList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => String(item).trim()).filter(Boolean)
}

function normalizeOutlineForCompare(outline: any) {
  return {
    objective: typeof outline?.objective === 'string' ? outline.objective : '',
    conflict: typeof outline?.conflict === 'string' ? outline.conflict : '',
    keyEvents: normalizeOutlineList(outline?.keyEvents),
    characterActions: normalizeOutlineList(outline?.characterActions),
    infoReveals: normalizeOutlineList(outline?.infoReveals),
    endingHook: typeof outline?.endingHook === 'string' ? outline.endingHook : '',
  }
}

function summarizeChapterOutline(chapter: Chapter) {
  const outline = normalizeOutlineForCompare(chapter.outline)
  return {
    id: chapter.id,
    index: chapter.index,
    title: chapter.title || '',
    status: chapter.status,
    objective: outline.objective,
    conflict: outline.conflict,
    keyEvents: outline.keyEvents,
    characterActions: outline.characterActions,
    infoReveals: outline.infoReveals,
    endingHook: outline.endingHook,
  }
}

function parseChapterPlanReadScope(scope: string): { mode: 'current' | 'all' | 'index'; index?: number } {
  const text = scope.trim().toLowerCase()
  if (!text) return { mode: 'current' }
  if (/(^|\b)(all|all chapters|chapter plans|overview|全章节|全部章节|所有章节)(\b|$)/i.test(text)) {
    return { mode: 'all' }
  }

  const chapterMatch = text.match(/chapter\s*(\d{1,3})/i)
  if (chapterMatch) {
    const chapterNo = Number(chapterMatch[1])
    if (Number.isFinite(chapterNo) && chapterNo > 0) return { mode: 'index', index: chapterNo - 1 }
  }
  const zhChapterMatch = text.match(/第\s*(\d{1,3})\s*章/i)
  if (zhChapterMatch) {
    const chapterNo = Number(zhChapterMatch[1])
    if (Number.isFinite(chapterNo) && chapterNo > 0) return { mode: 'index', index: chapterNo - 1 }
  }

  return { mode: 'current' }
}

function parseChapterPlanReadScopeSafe(scope: string): { mode: 'current' | 'all' | 'indices'; indices?: number[] } {
  const raw = scope.trim()
  const text = raw.toLowerCase()
  if (!text) return { mode: 'current' }

  if (
    /(^|\b)(all|all chapters|all chapter plans|chapter plans|overview)(\b|$)/i.test(text)
    || /\u5168\u7ae0\u8282|\u5168\u90e8\u7ae0\u8282|\u6240\u6709\u7ae0\u8282/.test(raw)
  ) {
    return { mode: 'all' }
  }

  const indices = new Set<number>()

  for (const match of text.matchAll(/chapter\s*(\d{1,3})/gi)) {
    const chapterNo = Number(match[1])
    if (Number.isFinite(chapterNo) && chapterNo > 0) {
      indices.add(chapterNo - 1)
    }
  }

  for (const match of raw.matchAll(/\u7b2c\s*(\d{1,3})\s*\u7ae0/gi)) {
    const chapterNo = Number(match[1])
    if (Number.isFinite(chapterNo) && chapterNo > 0) {
      indices.add(chapterNo - 1)
    }
  }

  if (indices.size > 0) {
    return { mode: 'indices', indices: [...indices].sort((a, b) => a - b) }
  }

  return { mode: 'current' }
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

function applyChapterPlanDelete(chapter: Chapter, request: ReviewChangeRequest): Chapter['outline'] {
  const base = normalizeOutlineForCompare(chapter.outline)
  const scope = request.scope.trim()
  const content = request.content.trim()
  const indexedListMatch = scope.match(/^(keyEvents|characterActions|infoReveals)\s*\[\s*(\d+)\s*\]/i)
  if (indexedListMatch) {
    const field = indexedListMatch[1] as 'keyEvents' | 'characterActions' | 'infoReveals'
    const index = Number(indexedListMatch[2])
    const list = [...base[field]]
    if (index >= 0 && index < list.length) list.splice(index, 1)
    return { ...base, [field]: list }
  }

  const listFieldMatch = scope.match(/^(keyEvents|characterActions|infoReveals)\b/i)
  if (listFieldMatch) {
    const field = listFieldMatch[1] as 'keyEvents' | 'characterActions' | 'infoReveals'
    const values = content
      .split(/\r?\n|[,|]/)
      .map(item => item.replace(/^[-*\d.)\s]+/, '').trim())
      .filter(Boolean)
    if (!values.length) return { ...base, [field]: [] }
    const lowerValues = new Set(values.map(item => item.toLowerCase()))
    return { ...base, [field]: base[field].filter(item => !lowerValues.has(item.toLowerCase())) }
  }

  if (/^objective\b/i.test(scope)) return { ...base, objective: '' }
  if (/^conflict\b/i.test(scope)) return { ...base, conflict: '' }
  if (/^endingHook\b/i.test(scope)) return { ...base, endingHook: '' }
  if (/^(chapter-plan|outline|all)\b/i.test(scope)) {
    return {
      objective: '',
      conflict: '',
      keyEvents: [],
      characterActions: [],
      infoReveals: [],
      endingHook: '',
    }
  }

  throw new Error('Chapter plan delete needs a supported scope such as keyEvents[2], keyEvents, characterActions, infoReveals, objective, conflict, endingHook, or chapter-plan.')
}

export function isTerminalChangeVoteStatus(status?: ReviewChangeVoteSession['status']) {
  return status === 'applied' || status === 'rejected' || status === 'failed'
}

export function createChangeVoteController(deps: ChangeVoteControllerDeps) {
  const recentlyAppliedWriteRequests = new Map<string, number>()
  const APPLIED_WRITE_DEDUP_TTL_MS = 8 * 60 * 1000

  function normalizeFingerprintText(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .slice(0, 1200)
  }

  function buildRequestFingerprint(request: ReviewChangeRequest) {
    return [
      request.target,
      request.action,
      normalizeFingerprintText(request.scope),
      normalizeFingerprintText(request.content),
    ].join('||')
  }

  function pruneAppliedWriteRequestFingerprints(now = Date.now()) {
    for (const [fingerprint, timestamp] of recentlyAppliedWriteRequests.entries()) {
      if (now - timestamp > APPLIED_WRITE_DEDUP_TTL_MS) {
        recentlyAppliedWriteRequests.delete(fingerprint)
      }
    }
  }

  function isRecentlyAppliedDuplicateWriteRequest(request: ReviewChangeRequest) {
    if (request.action === 'read') return false
    pruneAppliedWriteRequestFingerprints()
    const fingerprint = buildRequestFingerprint(request)
    return recentlyAppliedWriteRequests.has(fingerprint)
  }

  function markAppliedWriteRequest(request: ReviewChangeRequest) {
    if (request.action === 'read') return
    pruneAppliedWriteRequestFingerprints()
    recentlyAppliedWriteRequests.set(buildRequestFingerprint(request), Date.now())
  }

  function hasEquivalentPendingRequest(request: ReviewChangeRequest) {
    const fingerprint = buildRequestFingerprint(request)
    const active = deps.changeVoteSession.value
    if (active && buildRequestFingerprint(active.request) === fingerprint) return true
    return deps.pendingChangeRequests.value.some(item => buildRequestFingerprint(item.request) === fingerprint)
  }

  function changeVoters() {
    return deps.agents.value.filter(agent => agent.enabled)
  }
  const MAX_REFINEMENT_ROUNDS = 2

  function setExecutionStatus(sessionId: string, status: string, toolStatus: 'running' | 'success' | 'warning' | 'error' = 'running') {
    if (deps.changeVoteSession.value?.id === sessionId) {
      const timeline = Array.isArray(deps.changeVoteSession.value.executionTimeline)
        ? [...deps.changeVoteSession.value.executionTimeline]
        : []
      const nextLine = status.trim()
      if (nextLine) {
        timeline.push({
          line: nextLine,
          state: toolStatus,
          createdAt: new Date().toISOString(),
        })
      }
      deps.changeVoteSession.value = {
        ...deps.changeVoteSession.value,
        executionStatus: status,
        executionState: toolStatus,
        executionTimeline: timeline.slice(-20),
      }
      deps.scheduleSave()
    }
    deps.messages.value.push({
      id: deps.createId('system'),
      role: 'system',
      content: status,
      tool: createToolMessage(
        'skill_agent_progress',
        toolStatus,
        'Skill Agent progress',
        status
      ),
      createdAt: new Date().toISOString(),
    })
  }

  function classifyExecutionError(error: unknown): ReviewExecutionErrorClass {
    const message = String((error as any)?.message ?? error ?? '').toLowerCase()
    if (!message) return 'unknown'
    if (message.includes('could not find valid json') || message.includes('missing required') || message.includes('outline json') || message.includes('normalization')) return 'schema_error'
    if (message.includes('not found') || message.includes('no chapter is selected') || message.includes('no chapters exist')) return 'not_found'
    if (message.includes('conflict') || message.includes('already active or queued') || message.includes('duplicate')) return 'conflict'
    if (message.includes('did not persist') || message.includes('persist to the project file')) return 'persist_mismatch'
    return 'unknown'
  }

  function pushExecutionLedger(
    sessionId: string,
    input: {
      phase: ReviewExecutionPhase
      step: string
      status: 'running' | 'success' | 'warning' | 'error'
      detail?: string
      attempt?: number
      errorClass?: ReviewExecutionErrorClass
    }
  ) {
    const session = deps.changeVoteSession.value
    if (!session || session.id !== sessionId) return
    const entry: ReviewExecutionLedgerEntry = {
      id: deps.createId('exec-ledger'),
      phase: input.phase,
      step: input.step,
      status: input.status,
      detail: input.detail,
      attempt: input.attempt,
      errorClass: input.errorClass,
      createdAt: new Date().toISOString(),
    }
    const ledger = Array.isArray(session.executionLedger) ? [...session.executionLedger, entry].slice(-60) : [entry]
    deps.changeVoteSession.value = {
      ...session,
      executionPhase: input.phase,
      executionState: input.status,
      executionLedger: ledger,
    }
    deps.scheduleSave()
  }

  async function runWithExecutionRetry<T>(
    sessionId: string,
    phase: ReviewExecutionPhase,
    step: string,
    runner: () => Promise<T>,
    options: {
      retries: number
      shouldRetry: (errorClass: ReviewExecutionErrorClass, attempt: number) => boolean
      beforeRetry?: (attempt: number, errorClass: ReviewExecutionErrorClass, error: unknown) => Promise<void> | void
    }
  ): Promise<T> {
    let attempt = 0
    while (true) {
      attempt += 1
      pushExecutionLedger(sessionId, { phase, step, status: 'running', attempt, detail: `Attempt ${attempt}` })
      try {
        const result = await runner()
        pushExecutionLedger(sessionId, { phase, step, status: 'success', attempt })
        return result
      } catch (error: any) {
        const errorClass = classifyExecutionError(error)
        pushExecutionLedger(sessionId, {
          phase,
          step,
          status: 'warning',
          attempt,
          errorClass,
          detail: error?.message || String(error || ''),
        })
        if (attempt > options.retries || !options.shouldRetry(errorClass, attempt)) {
          pushExecutionLedger(sessionId, {
            phase,
            step,
            status: 'error',
            attempt,
            errorClass,
            detail: error?.message || String(error || ''),
          })
          throw error
        }
        if (options.beforeRetry) await options.beforeRetry(attempt, errorClass, error)
      }
    }
  }

  function synthesizeRecentDiscussionForRequest(limit = 4) {
    const recent = deps.messages.value
      .filter(item => item.role === 'agent' || item.role === 'user')
      .slice(-18)
      .map(item => {
        const prefix = item.role === 'user' ? 'User' : (item.agentName || item.agentId || 'Agent')
        return `[${prefix}] ${item.content}`.replace(/\s+/g, ' ').trim()
      })
      .filter(Boolean)
      .slice(-limit)
    return recent
  }

  function enrichRequestFromDiscussion(request: ReviewChangeRequest): ReviewChangeRequest {
    const evidence = synthesizeRecentDiscussionForRequest()
    if (!evidence.length) return request
    const scope = request.scope.trim()
    const purpose = request.purpose.trim()
    const content = request.content.trim()
    const weakScope = scope.length < 12
    const weakPurpose = purpose.length < 20
    const weakContent = content.length < 80
    if (!weakScope && !weakPurpose && !weakContent) return request

    const evidenceText = evidence.map(line => `- ${line}`).join('\n')
    return {
      ...request,
      scope: weakScope ? `discussion-derived action on ${request.target}` : scope,
      purpose: weakPurpose ? `${purpose || 'Improve the project in the direction agreed by discussion.'}\n\nDiscussion evidence:\n${evidenceText}` : purpose,
      content: weakContent ? `${content || 'Apply the agreed direction from discussion.'}\n\nDiscussion evidence:\n${evidenceText}` : content,
    }
  }

  function isDraftLikeRequest(request: ReviewChangeRequest) {
    const scope = request.scope.trim()
    const purpose = request.purpose.trim()
    const content = request.content.trim()
    return scope.length < 20 || purpose.length < 30 || content.length < 120
  }

  function requestChangeVote(agent: ReviewAgentState, request: ReviewChangeRequest) {
    const normalizedRequest = deps.normalizeChangeRequestCompat(request)
    if (!normalizedRequest) return
    const enrichedRequest = enrichRequestFromDiscussion(normalizedRequest)

    if (isRecentlyAppliedDuplicateWriteRequest(enrichedRequest)) {
      deps.addSystemMessage(`${agent.name} proposed a write action that is effectively identical to a recently applied change. Duplicate proposal was skipped. If further work is needed, propose a delta change with a new scope/content.`)
      return
    }

    if (hasEquivalentPendingRequest(enrichedRequest)) {
      deps.addSystemMessage(`${agent.name} proposed an action that is already active or queued. Duplicate proposal was skipped.`)
      return
    }

    if (
      enrichedRequest.scope !== normalizedRequest.scope
      || enrichedRequest.purpose !== normalizedRequest.purpose
      || enrichedRequest.content !== normalizedRequest.content
    ) {
      deps.addSystemMessage('Action request was auto-refined with recent discussion evidence to make the proposal more concrete and traceable.')
    }
    if (deps.changeVoteSession.value?.status === 'voting' || deps.changeVoteSession.value?.status === 'applying') {
      deps.pendingChangeRequests.value.push({ agent, request: enrichedRequest })
      deps.addSystemMessage(`${agent.name} created an additional proposal. It was queued until the active change vote finishes.`)
      return
    }
    if (!deps.brainstormRoundCompleted.value) {
      deps.pendingChangeRequests.value.push({ agent, request: enrichedRequest })
      deps.addSystemMessage(`${agent.name} drafted a proposal. It will wait until every active meeting agent has completed at least one brainstorm turn.`)
      if (!deps.brainstormingMode.value) {
        deps.requestAllAgents([
          'Before voting on a proposal, complete at least one brainstorm round.',
          'Each agent should analyze the user request from its own role and state what outcome would satisfy the user.',
          'After the brainstorm round, the queued proposal can enter voting or be replaced by a better proposal.',
        ].join('\n'))
      }
      return
    }
    deps.cancelActiveTurnsExcept(agent.id)
    const session: ReviewChangeVoteSession = {
      id: deps.createId('change-vote'),
      requestedByAgentId: agent.id,
      requestedByAgentName: agent.name,
      request: enrichedRequest,
      draft: isDraftLikeRequest(enrichedRequest),
      refinementRound: 0,
      executionContractVersion: 'skill-agent-v2',
      executionPhase: 'plan',
      status: 'voting',
      votes: [],
      createdAt: new Date().toISOString(),
    }
    deps.changeVoteSession.value = session
    deps.messages.value.push({
      id: deps.createId('agent'),
      role: 'agent',
      agentId: agent.id,
      agentName: agent.name,
      content: [
        `[Action request: ${enrichedRequest.target}]`,
        `Action: ${enrichedRequest.action}`,
        `Scope: ${enrichedRequest.scope}`,
        `Purpose: ${enrichedRequest.purpose}`,
        session.draft
          ? 'This is a draft action request. Agents should refine it with amendments, then approve if it clearly improves the project direction.'
          : 'The request will be applied automatically if a majority of meeting agents approve.',
      ].join('\n'),
      tool: createToolMessage('request_project_action', 'pending', 'Action vote requested', `${agent.name} requested a project action`, enrichedRequest.content),
      createdAt: new Date().toISOString(),
    })
    deps.scheduleSave()
    setTimeout(() => {
      void runChangeVoteSession(session.id)
    }, 0)
  }

  function flushPendingChangeRequest() {
    if (!deps.brainstormRoundCompleted.value || deps.changeVoteSession.value?.status === 'voting' || deps.changeVoteSession.value?.status === 'applying') return
    const next = deps.pendingChangeRequests.value.shift()
    if (!next) return
    requestChangeVote(next.agent, next.request)
  }

  async function runChangeVoteForAgent(agent: ReviewAgentState, sessionId: string) {
    const session = deps.changeVoteSession.value
    if (!session || session.id !== sessionId || !agent.enabled || deps.meetingEnded.value) return

    providerManager.setProviders(deps.providerStore.providers)
    const preferred = decodeProviderModelRef(agent.modelValue)
    const model = deps.providerStore.getAvailableModelRefForRole(agent.defaultModelRole, preferred)
      ?? deps.providerStore.getAvailableModelRefForRole('chapterPlanner')
      ?? deps.providerStore.getAvailableModelRefForRole('proofreader')
      ?? deps.providerStore.getDefaultModelRefForRole(agent.defaultModelRole)

    if (!model) {
      session.votes.push({
        agentId: agent.id,
        agentName: agent.name,
        vote: 'reject',
        reason: 'No model is configured for this agent, so it cannot approve the change.',
        createdAt: new Date().toISOString(),
      })
      deps.setAgentStatus(agent.id, 'idle', false)
      return
    }

    const abortController = new AbortController()
    deps.activeAbortControllers.set(agent.id, abortController)
    deps.setAgentStatus(agent.id, 'speaking', false)

    try {
      const response = await providerManager.chatWithTools(
        buildChangeVoteMessages(agent, deps.messages.value, deps.context(), deps.currentFocus.value, deps.selectedContextElements.value, session),
        model,
        CHANGE_VOTE_TOOLS,
        700,
        0.2,
        { toolChoice: 'auto' },
        abortController.signal
      )
      if (deps.changeVoteSession.value?.id !== sessionId || abortController.signal.aborted) return
      const cleanVoteContent = stripReasoningText(response.content || '')
      const parsedFromTool = parseChangeVoteFromToolCalls(response.tool_calls)
      const parsed = parsedFromTool ?? parseChangeVote(cleanVoteContent)
      const amendment = deps.changeVoteSession.value.amendmentDepth
        ? null
        : (parsedFromTool?.amendment ?? extractAmendment(cleanVoteContent))
      const vote: ReviewChangeVote = {
        agentId: agent.id,
        agentName: agent.name,
        vote: parsed.vote,
        reason: parsed.reason,
        amendment: amendment ?? undefined,
        createdAt: new Date().toISOString(),
      }
      deps.changeVoteSession.value.votes.push(vote)
      deps.messages.value.push({
        id: deps.createId('agent'),
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
      agent.lastSeenMessageIndex = deps.messages.value.length
      deps.setAgentStatus(agent.id, 'idle', false)
    } catch (error: any) {
      if (abortController.signal.aborted || error?.name === 'AbortError') return
      const vote: ReviewChangeVote = {
        agentId: agent.id,
        agentName: agent.name,
        vote: 'reject',
        reason: error?.message ? `Vote failed: ${error.message}` : 'Vote failed, so the agent cannot approve the change.',
        createdAt: new Date().toISOString(),
      }
      if (deps.changeVoteSession.value?.id === sessionId) deps.changeVoteSession.value.votes.push(vote)
      deps.addSystemMessage(`${agent.name} failed to vote on the change: ${vote.reason}`)
      deps.setAgentStatus(agent.id, 'blocked', false)
    } finally {
      deps.activeAbortControllers.delete(agent.id)
      if (agent.status === 'speaking') deps.setAgentStatus(agent.id, 'idle', false)
      deps.scheduleSave()
    }
  }

  async function normalizeApprovedChangeWithSkillAgent(session: ReviewChangeVoteSession): Promise<ReviewChangeVoteSession> {
    providerManager.setProviders(deps.providerStore.providers)
    const model = deps.providerStore.getAvailableModelRefForRole('skillAgent')
      ?? deps.providerStore.getAvailableModelRefForRole('chapterPlanner')
      ?? deps.providerStore.getDefaultModelRefForRole('skillAgent')
    if (!model) return session

    try {
      const sessionId = deps.changeVoteSession.value?.id || session.id
      pushExecutionLedger(sessionId, { phase: 'plan', step: 'skill_agent_normalization', status: 'running', detail: 'Start Skill Agent planning/normalization' })
      setExecutionStatus(sessionId, 'Skill Agent is planning the execution steps.', 'running')
      const content = await providerManager.chat(
        [
          ...buildSkillAgentMessages(session, deps.context(), deps.selectedContextElements.value),
          {
            role: 'user',
            content: [
              'Return a JSON object that includes:',
              '- status_line: one concise status sentence for UI progress.',
              '- execution_steps: array of 2-6 concise step sentences.',
              '- target/action/scope/purpose/content: normalized executable action payload.',
              'If action is read, content may be "N/A".',
            ].join('\n'),
          },
        ],
        model,
        1800,
        0.15
      )
      const parsed = parseLooseJson(stripReasoningText(content))
      const statusLine = typeof parsed?.status_line === 'string' && parsed.status_line.trim()
        ? parsed.status_line.trim()
        : 'Skill Agent finished planning and prepared an executable action.'
      if (sessionId) setExecutionStatus(sessionId, statusLine, 'running')
      if (Array.isArray(parsed?.execution_steps) && parsed.execution_steps.length && sessionId) {
        const stepsText = parsed.execution_steps
          .map((step: unknown) => String(step || '').trim())
          .filter(Boolean)
          .slice(0, 6)
          .map((step: string, index: number) => `${index + 1}. ${step}`)
          .join('\n')
        if (stepsText) {
          deps.messages.value.push({
            id: deps.createId('system'),
            role: 'system',
            content: `Skill Agent plan:\n${stepsText}`,
            tool: createToolMessage('skill_agent_plan', 'success', 'Skill Agent execution plan', statusLine, stepsText),
            createdAt: new Date().toISOString(),
          })
        }
      }
      const target = parsed?.target === 'master-outline' || parsed?.target === 'chapter-plan' || parsed?.target === 'characters' || parsed?.target === 'consensus'
        ? parsed.target as ReviewChangeTarget
        : session.request.target
      const action = normalizeChangeAction(parsed?.action ?? session.request.action)
      const normalizedContent = typeof parsed?.content === 'string'
        ? parsed.content
        : JSON.stringify(parsed?.content ?? session.request.content, null, 2)
      const normalized: ReviewChangeRequest = {
        target,
        action,
        scope: typeof parsed?.scope === 'string' && parsed.scope.trim() ? parsed.scope.trim() : session.request.scope,
        purpose: typeof parsed?.purpose === 'string' && parsed.purpose.trim() ? parsed.purpose.trim() : session.request.purpose,
        content: normalizedContent,
      }
      deps.messages.value.push({
        id: deps.createId('system'),
        role: 'system',
        content: `Project Change Tool normalized the approved proposal before execution.${parsed?.verification ? `\nVerification plan: ${parsed.verification}` : ''}`,
        tool: createToolMessage('normalize_project_change', 'success', 'Proposal normalized', normalized.scope, normalized.purpose, session.request.content, normalized.content),
        createdAt: new Date().toISOString(),
      })
      pushExecutionLedger(sessionId, {
        phase: 'plan',
        step: 'skill_agent_normalization',
        status: 'success',
        detail: parsed?.verification ? `Verification: ${parsed.verification}` : 'Normalization finished',
      })
      return { ...session, request: normalized, executionStatus: statusLine }
    } catch (error: any) {
      deps.messages.value.push({
        id: deps.createId('system'),
        role: 'system',
        content: `Project Change Tool could not normalize with the configured skill model, so it will try local parsing. ${error?.message || ''}`.trim(),
        tool: createToolMessage('normalize_project_change', 'warning', 'Normalization fallback', session.request.scope, error?.message || 'Skill model normalization failed'),
        createdAt: new Date().toISOString(),
      })
      const sessionId = deps.changeVoteSession.value?.id || session.id
      if (sessionId) setExecutionStatus(sessionId, 'Skill Agent planning failed, falling back to local execution.', 'warning')
      pushExecutionLedger(sessionId, {
        phase: 'plan',
        step: 'skill_agent_normalization',
        status: 'warning',
        detail: error?.message || 'Skill model normalization failed',
        errorClass: classifyExecutionError(error),
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
      id: deps.createId('amendment-vote'),
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
    deps.changeVoteSession.value = amendmentSession
    deps.addSystemMessage(`${proposerVote.agentName} proposed an amendment. Voting on the amendment before continuing the original proposal.`)

    for (const agent of voters.filter(item => item.id !== proposerVote.agentId)) {
      if (deps.changeVoteSession.value?.id !== amendmentSession.id) return true
      deps.setAgentStatus(agent.id, 'waiting', true)
      await runChangeVoteForAgent(agent, amendmentSession.id)
    }

    const latest = deps.changeVoteSession.value
    if (!latest || latest.id !== amendmentSession.id) return true
    const approvals = latest.votes.filter(vote => vote.vote === 'approve').length
    const majority = Math.floor(voters.length / 2) + 1
    if (approvals >= majority) {
      const restarted: ReviewChangeVoteSession = {
        ...originalSession,
        id: deps.createId('change-vote'),
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
      deps.changeVoteSession.value = restarted
      deps.addSystemMessage('Amendment approved and applied to the proposal. Restarting the original proposal vote.')
      setTimeout(() => {
        void runChangeVoteSession(restarted.id)
      }, 0)
      return true
    }

    deps.changeVoteSession.value = originalSession
    deps.addSystemMessage('Amendment rejected. Continuing the original proposal vote with the proposer\'s initial stance.')
    return false
  }

  async function applyApprovedChange(session: ReviewChangeVoteSession) {
    const project = deps.context().project
    if (!project) throw new Error('No active project is selected.')
    deps.changeVoteSession.value = {
      ...session,
      status: 'applying',
      executionContractVersion: session.executionContractVersion || 'skill-agent-v2',
      executionPhase: 'plan',
      executionState: 'running',
      executionTimeline: Array.isArray(session.executionTimeline) ? session.executionTimeline : [],
      executionLedger: Array.isArray(session.executionLedger) ? session.executionLedger : [],
    }
    deps.scheduleSave()
    pushExecutionLedger(session.id, {
      phase: 'plan',
      step: 'execution_contract_start',
      status: 'success',
      detail: 'Entered plan -> act -> verify -> report workflow',
    })
    setExecutionStatus(session.id, 'Skill Agent accepted the approved action and started execution.', 'running')
    const executableSession = await normalizeApprovedChangeWithSkillAgent(session)
    const action: ReviewChangeAction = normalizeChangeAction(executableSession.request.action)

    if (executableSession.request.target === 'consensus') {
      pushExecutionLedger(session.id, { phase: 'act', step: 'apply_consensus', status: 'running' })
      setExecutionStatus(session.id, 'Skill Agent finalized consensus write-back.', 'success')
      const result = action === 'read'
        ? 'Project Change Tool returned the current meeting consensus context without changing project files.'
        : 'Project Change Tool recorded the approved meeting consensus.'
      deps.messages.value.push({
        id: deps.createId('system'),
        role: 'system',
        content: `${result}\nAll agents must treat this consensus as accepted meeting guidance until the user requests a new direction.`,
        tool: createToolMessage('record_meeting_consensus', 'success', 'Meeting consensus recorded', executableSession.request.scope, executableSession.request.purpose, '', executableSession.request.content),
        createdAt: new Date().toISOString(),
      })
      rememberAcceptedChangeForAllAgents(deps.agents.value, executableSession, result)
      markAppliedWriteRequest(executableSession.request)
      pushExecutionLedger(session.id, { phase: 'report', step: 'consensus_report', status: 'success' })
      deps.changeVoteSession.value = { ...executableSession, status: 'applied', result, completedAt: new Date().toISOString() }
      return
    }

    if (executableSession.request.target === 'master-outline') {
      const before = project.outline || ''
      if (action === 'read') {
        pushExecutionLedger(session.id, { phase: 'act', step: 'read_master_outline', status: 'running' })
        setExecutionStatus(session.id, 'Skill Agent completed read-only fetch for master outline.', 'success')
        const result = 'Project Change Tool returned the current master outline without modifying project files.'
        deps.messages.value.push({
          id: deps.createId('system'),
          role: 'system',
          content: result,
          tool: createToolMessage('read_master_outline', 'success', 'Master outline fetched', executableSession.request.scope, executableSession.request.purpose, '', before),
          createdAt: new Date().toISOString(),
        })
        deps.changeVoteSession.value = { ...executableSession, request: { ...executableSession.request, action }, status: 'applied', result, completedAt: new Date().toISOString() }
        pushExecutionLedger(session.id, { phase: 'report', step: 'read_master_outline_report', status: 'success' })
        return
      }
      setExecutionStatus(session.id, 'Skill Agent is applying master outline update to project storage.', 'running')
      const nextOutline = action === 'delete' ? '' : executableSession.request.content
      await runWithExecutionRetry(
        session.id,
        'act',
        'write_master_outline',
        async () => {
          const saved = await deps.projectStore.updateProject(project.id, { outline: nextOutline })
          if (saved === null) throw new Error('Failed to save master outline change to the project file.')
        },
        {
          retries: 1,
          shouldRetry: (errorClass) => errorClass === 'conflict' || errorClass === 'unknown',
        }
      )
      await runWithExecutionRetry(
        session.id,
        'verify',
        'verify_master_outline_persistence',
        async () => {
          await deps.verifyProjectPersistence(
            project.id,
            reloaded => (reloaded.outline || '') === nextOutline,
            'The master outline change did not persist to the project file.'
          )
        },
        {
          retries: 2,
          shouldRetry: (errorClass) => errorClass === 'persist_mismatch',
          beforeRetry: async () => {
            await deps.projectStore.updateProject(project.id, { outline: nextOutline })
          },
        }
      )
      setExecutionStatus(session.id, 'Skill Agent verified master outline persistence.', 'success')
      const result = 'Project Change Tool applied the approved change to the master outline.'
      deps.messages.value.push({
        id: deps.createId('system'),
        role: 'system',
        content: `${result}\nAll agents must treat this applied change as accepted source-of-truth. Do not revert it unless the user explicitly requests a new change.`,
        tool: createToolMessage(action === 'delete' ? 'clear_master_outline' : 'replace_master_outline', 'success', action === 'delete' ? 'Master outline cleared' : 'Master outline updated', executableSession.request.scope, executableSession.request.purpose, before, nextOutline),
        createdAt: new Date().toISOString(),
      })
      rememberAcceptedChangeForAllAgents(deps.agents.value, executableSession, result)
      markAppliedWriteRequest({ ...executableSession.request, action })
      pushExecutionLedger(session.id, { phase: 'report', step: 'write_master_outline_report', status: 'success' })
      deps.changeVoteSession.value = { ...executableSession, request: { ...executableSession.request, action }, status: 'applied', result, completedAt: new Date().toISOString() }
      return
    }

    if (executableSession.request.target === 'characters') {
      if (action === 'read') {
        pushExecutionLedger(session.id, { phase: 'act', step: 'read_characters', status: 'running' })
        setExecutionStatus(session.id, 'Skill Agent completed read-only fetch for characters.', 'success')
        const result = 'Project Change Tool returned the current characters without modifying project files.'
        deps.messages.value.push({
          id: deps.createId('system'),
          role: 'system',
          content: result,
          tool: createToolMessage('read_characters', 'success', 'Characters fetched', executableSession.request.scope, executableSession.request.purpose, '', JSON.stringify(project.characters, null, 2)),
          createdAt: new Date().toISOString(),
        })
        deps.changeVoteSession.value = { ...executableSession, request: { ...executableSession.request, action }, status: 'applied', result, completedAt: new Date().toISOString() }
        pushExecutionLedger(session.id, { phase: 'report', step: 'read_characters_report', status: 'success' })
        return
      }
      const before = JSON.stringify(project.characters, null, 2)
      let merged = [...project.characters]
      let affectedNames: string[] = []
      if (action === 'delete') {
        setExecutionStatus(session.id, 'Skill Agent is resolving character delete targets.', 'running')
        const { ids, names } = parseCharacterDeleteMatchers(executableSession.request.content)
        if (!ids.size && !names.size) {
          throw new Error('Character delete needs at least one character id or name in content.')
        }
        merged = project.characters.filter(character => {
          const byId = ids.has(character.id)
          const byName = names.has(character.name.trim().toLowerCase())
          return !(byId || byName)
        })
        affectedNames = project.characters
          .filter(character => !merged.some(item => item.id === character.id))
          .map(character => character.name.trim())
      } else {
        setExecutionStatus(session.id, 'Skill Agent is normalizing character payload and merge plan.', 'running')
        const rawCharacters = parseCharacterPayload(executableSession.request.content)
        if (!rawCharacters.length) throw new Error('Character changes need at least one inferable character name and description.')
        const existingByName = new Map(project.characters.map(character => [character.name.trim().toLowerCase(), character]))
        const incoming = rawCharacters.map((item: any, index: number) => normalizeReviewCharacter(item, project.characters.length + index))
        affectedNames = incoming.map(character => character.name.trim())
        for (const character of incoming) {
          const key = character.name.trim().toLowerCase()
          const existing = existingByName.get(key)
          if (existing) {
            if (action === 'create') continue
            const index = merged.findIndex(item => item.id === existing.id)
            merged[index] = { ...existing, ...character, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() }
          } else {
            merged.push(character)
          }
        }
      }
      await runWithExecutionRetry(
        session.id,
        'act',
        'write_characters',
        async () => {
          const saved = await deps.projectStore.updateProject(project.id, { characters: merged })
          if (saved === null) throw new Error('Failed to save character changes to the project file.')
        },
        {
          retries: 1,
          shouldRetry: (errorClass) => errorClass === 'conflict' || errorClass === 'unknown',
        }
      )
      const affectedNameSet = new Set(affectedNames.map(name => name.toLowerCase()).filter(Boolean))
      await runWithExecutionRetry(
        session.id,
        'verify',
        'verify_characters_persistence',
        async () => {
          await deps.verifyProjectPersistence(
            project.id,
            reloaded => {
              if (!Array.isArray(reloaded.characters)) return false
              if (action === 'delete') {
                return [...affectedNameSet].every(name => !reloaded.characters.some(character => character?.name?.trim?.().toLowerCase() === name))
              }
              if (action === 'create') {
                return [...affectedNameSet].every(name => reloaded.characters.some(character => character?.name?.trim?.().toLowerCase() === name))
              }
              return [...affectedNameSet].every(name => reloaded.characters.some(character => character?.name?.trim?.().toLowerCase() === name))
            },
            'The character change did not persist to the project file.'
          )
        },
        {
          retries: 2,
          shouldRetry: (errorClass) => errorClass === 'persist_mismatch',
          beforeRetry: async () => {
            await deps.projectStore.updateProject(project.id, { characters: merged })
          },
        }
      )
      setExecutionStatus(session.id, 'Skill Agent verified character persistence.', 'success')
      const after = JSON.stringify(merged, null, 2)
      const changeCount = action === 'delete' ? Math.max(0, project.characters.length - merged.length) : Math.max(0, merged.length - (action === 'create' ? project.characters.length : 0))
      const result = action === 'delete'
        ? `Project Change Tool removed ${changeCount} character${changeCount === 1 ? '' : 's'} from the project.`
        : `Project Change Tool applied the approved character change (${affectedNames.length} character${affectedNames.length === 1 ? '' : 's'} affected).`
      deps.messages.value.push({
        id: deps.createId('system'),
        role: 'system',
        content: `${result}\nAll agents must treat this applied change as accepted source-of-truth. Do not revert it unless the user explicitly requests a new change.`,
        tool: createToolMessage(action === 'delete' ? 'delete_characters' : action === 'create' ? 'create_characters' : 'update_characters', 'success', action === 'delete' ? 'Characters removed' : action === 'create' ? 'Characters created' : 'Characters updated', executableSession.request.scope, executableSession.request.purpose, before, after),
        createdAt: new Date().toISOString(),
      })
      rememberAcceptedChangeForAllAgents(deps.agents.value, executableSession, result)
      markAppliedWriteRequest({ ...executableSession.request, action })
      pushExecutionLedger(session.id, { phase: 'report', step: 'write_characters_report', status: 'success' })
      deps.changeVoteSession.value = { ...executableSession, request: { ...executableSession.request, action }, status: 'applied', result, completedAt: new Date().toISOString() }
      return
    }

    const chapter = deps.context().chapter
    if (action === 'read') {
      pushExecutionLedger(session.id, { phase: 'act', step: 'read_chapter_plan', status: 'running' })
      setExecutionStatus(session.id, 'Skill Agent is reading chapter plan context.', 'running')
      const scopeMode = parseChapterPlanReadScopeSafe(executableSession.request.scope)
      if (scopeMode.mode === 'all') {
        const summary = (project.chapters || []).map(item => summarizeChapterOutline(item))
        const result = 'Project Change Tool returned all chapter plans without modifying project files.'
        deps.messages.value.push({
          id: deps.createId('system'),
          role: 'system',
          content: result,
          tool: createToolMessage('read_all_chapter_outlines', 'success', 'All chapter plans fetched', executableSession.request.scope, executableSession.request.purpose, '', JSON.stringify(summary, null, 2)),
          createdAt: new Date().toISOString(),
        })
        deps.changeVoteSession.value = { ...executableSession, request: { ...executableSession.request, action }, status: 'applied', result, completedAt: new Date().toISOString() }
        setExecutionStatus(session.id, 'Skill Agent completed all-chapter read.', 'success')
        pushExecutionLedger(session.id, { phase: 'report', step: 'read_all_chapter_plan_report', status: 'success' })
        return
      }

      if (scopeMode.mode === 'indices' && Array.isArray(scopeMode.indices) && scopeMode.indices.length > 0) {
        const matched = (project.chapters || []).filter(item => scopeMode.indices!.includes(item.index))
        const missing = scopeMode.indices.filter(index => !matched.some(item => item.index === index))
        if (!matched.length) {
          throw new Error(`None of the requested chapters were found: ${scopeMode.indices.map(i => `Chapter ${i + 1}`).join(', ')}.`)
        }
        const payload = matched.map(item => summarizeChapterOutline(item))
        const chapterLabel = matched.map(item => `Chapter ${item.index + 1}`).join(', ')
        const result = `Project Change Tool returned ${chapterLabel} plan${matched.length > 1 ? 's' : ''} without modifying project files.${missing.length ? ` Missing: ${missing.map(i => `Chapter ${i + 1}`).join(', ')}.` : ''}`
        deps.messages.value.push({
          id: deps.createId('system'),
          role: 'system',
          content: result,
          tool: createToolMessage(
            matched.length > 1 ? 'read_multiple_chapter_outlines' : 'read_chapter_outline',
            missing.length ? 'warning' : 'success',
            matched.length > 1 ? 'Multiple chapter plans fetched' : 'Chapter plan fetched',
            executableSession.request.scope,
            executableSession.request.purpose,
            '',
            JSON.stringify(payload, null, 2)
          ),
          createdAt: new Date().toISOString(),
        })
        deps.changeVoteSession.value = { ...executableSession, request: { ...executableSession.request, action }, status: 'applied', result, completedAt: new Date().toISOString() }
        setExecutionStatus(session.id, 'Skill Agent completed scoped chapter-plan read.', missing.length ? 'warning' : 'success')
        pushExecutionLedger(session.id, { phase: 'report', step: 'read_scoped_chapter_plan_report', status: missing.length ? 'warning' : 'success' })
        return
      }

      const currentChapter = chapter ?? (project.chapters || [])[0]
      if (!currentChapter) {
        throw new Error('No chapters exist in this project, so no current chapter plan can be read.')
      }
      const result = `Project Change Tool returned the current Chapter ${currentChapter.index + 1} plan without modifying project files.`
      deps.messages.value.push({
        id: deps.createId('system'),
        role: 'system',
        content: result,
        tool: createToolMessage('read_chapter_outline', 'success', 'Chapter plan fetched', executableSession.request.scope, executableSession.request.purpose, '', JSON.stringify(currentChapter.outline, null, 2)),
        createdAt: new Date().toISOString(),
      })
      deps.changeVoteSession.value = { ...executableSession, request: { ...executableSession.request, action }, status: 'applied', result, completedAt: new Date().toISOString() }
      setExecutionStatus(session.id, 'Skill Agent completed current-chapter read.', 'success')
      pushExecutionLedger(session.id, { phase: 'report', step: 'read_current_chapter_plan_report', status: 'success' })
      return
    }
    if (!chapter) throw new Error('No chapter is selected for chapter-plan write changes.')
    setExecutionStatus(session.id, `Skill Agent is preparing Chapter ${chapter.index + 1} patch.`, 'running')
    const tryBuildChapterOutline = async () => {
      if (action === 'delete') return applyChapterPlanDelete(chapter, executableSession.request)
      return normalizeChapterOutlinePatch(chapter, executableSession.request)
    }

    let normalizedOutline: Chapter['outline']
    try {
      normalizedOutline = await tryBuildChapterOutline()
    } catch (firstError: any) {
      const firstReason = firstError?.message || 'Unknown chapter plan normalization error.'
      setExecutionStatus(session.id, `Skill Agent local normalization failed: ${firstReason}`, 'warning')

      if (action !== 'delete') {
        setExecutionStatus(session.id, 'Skill Agent is retrying chapter-plan normalization with strict schema repair.', 'running')
        const repaired = await normalizeApprovedChangeWithSkillAgent({
          ...executableSession,
          request: {
            ...executableSession.request,
            target: 'chapter-plan',
            action: 'update',
            purpose: `${executableSession.request.purpose}\n\nNormalization retry hint: return full chapter outline object with fields objective, conflict, keyEvents, characterActions, infoReveals, endingHook.`,
            content: [
              executableSession.request.content,
              '',
              'Repair instruction: output strict JSON with outline fields only.',
              '{',
              '  "outline": {',
              '    "objective": "...",',
              '    "conflict": "...",',
              '    "keyEvents": ["..."],',
              '    "characterActions": ["..."],',
              '    "infoReveals": ["..."],',
              '    "endingHook": "..."',
              '  }',
              '}',
            ].join('\n'),
          },
        })

        try {
          normalizedOutline = normalizeChapterOutlinePatch(chapter, repaired.request)
          setExecutionStatus(session.id, 'Skill Agent schema repair succeeded for chapter-plan patch.', 'success')
        } catch (secondError: any) {
          const secondReason = secondError?.message || 'Unknown chapter plan normalization error after retry.'
          const details = [
            secondReason,
            `Scope received: ${repaired.request.scope || '(empty)'}`,
            'Expected one of: outline JSON, keyEvents[2], keyEvents, characterActions, objective, conflict, infoReveals, endingHook.',
          ].join(' ')
          setExecutionStatus(session.id, `Skill Agent schema repair failed: ${details}`, 'error')
          throw new Error(`Chapter-plan normalization failed after retry. ${details}`)
        }
      } else {
        throw firstError
      }
    }
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
    await runWithExecutionRetry(
      session.id,
      'act',
      'write_chapter_plan',
      async () => {
        const saved = await deps.projectStore.updateProject(project.id, { chapters })
        if (saved === null) throw new Error('Failed to save chapter plan change to the project file.')
      },
      {
        retries: 1,
        shouldRetry: (errorClass) => errorClass === 'conflict' || errorClass === 'unknown',
      }
    )
    const expectedOutline = normalizeOutlineForCompare(normalizedOutline)
    await runWithExecutionRetry(
      session.id,
      'verify',
      'verify_chapter_plan_persistence',
      async () => {
        await deps.verifyProjectPersistence(
          project.id,
          reloaded => Array.isArray(reloaded.chapters)
            && reloaded.chapters.some(item => {
              if (item?.id === chapter.id) {
                return JSON.stringify(normalizeOutlineForCompare(item?.outline)) === JSON.stringify(expectedOutline)
              }
              if (typeof item?.index === 'number' && item.index === chapter.index) {
                return JSON.stringify(normalizeOutlineForCompare(item?.outline)) === JSON.stringify(expectedOutline)
              }
              return false
            }),
          'The chapter plan change did not persist to the project file.'
        )
      },
      {
        retries: 2,
        shouldRetry: (errorClass) => errorClass === 'persist_mismatch',
        beforeRetry: async () => {
          await deps.projectStore.updateProject(project.id, { chapters })
        },
      }
    )
    setExecutionStatus(session.id, `Skill Agent verified Chapter ${chapter.index + 1} persistence.`, 'success')
    const after = JSON.stringify({ title: chapter.title, outline: normalizedOutline }, null, 2)
    const result = action === 'delete'
      ? `Project Change Tool deleted the requested fields from Chapter ${chapter.index + 1} plan.`
      : `Project Change Tool applied the approved change to Chapter ${chapter.index + 1} plan.`
    deps.messages.value.push({
      id: deps.createId('system'),
      role: 'system',
      content: `${result}\nAll agents must treat this applied change as accepted source-of-truth. Do not revert it unless the user explicitly requests a new change.`,
      tool: createToolMessage(action === 'delete' ? 'delete_chapter_outline_fields' : 'rewrite_chapter_outline', 'success', action === 'delete' ? 'Chapter plan fields removed' : 'Chapter plan updated', executableSession.request.scope, executableSession.request.purpose, before, after),
      createdAt: new Date().toISOString(),
    })
    rememberAcceptedChangeForAllAgents(deps.agents.value, executableSession, result)
    markAppliedWriteRequest({ ...executableSession.request, action })
    pushExecutionLedger(session.id, { phase: 'report', step: 'write_chapter_plan_report', status: 'success' })
    deps.changeVoteSession.value = { ...executableSession, request: { ...executableSession.request, action }, status: 'applied', result, completedAt: new Date().toISOString() }
  }

  async function runChangeVoteSession(sessionId: string) {
    const voters = changeVoters()
    const majority = Math.floor(voters.length / 2) + 1
    if (!voters.length) {
      if (deps.changeVoteSession.value?.id === sessionId) {
        deps.changeVoteSession.value.status = 'rejected'
        deps.changeVoteSession.value.error = 'No enabled meeting agents are available to vote.'
        deps.changeVoteSession.value.completedAt = new Date().toISOString()
        deps.addChangeVoteSummaryMessage(deps.changeVoteSession.value, 'Project change vote ended without eligible voters. Open this card to inspect the final proposal state.')
        deps.scheduleSave()
      }
      return
    }

    for (const agent of voters) {
      if (deps.changeVoteSession.value?.id !== sessionId || deps.changeVoteSession.value.status !== 'voting') return
      deps.setAgentStatus(agent.id, 'waiting', true)
      await runChangeVoteForAgent(agent, sessionId)
      const session = deps.changeVoteSession.value
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
          appliedResult = deps.changeVoteSession.value?.result || 'Approved change was applied.'
        } catch (error: any) {
          const failureReason = error?.message || 'Failed to apply approved change.'
          deps.changeVoteSession.value = {
            ...session,
            status: 'failed',
            error: failureReason,
            completedAt: new Date().toISOString(),
          }
          deps.addSystemMessage(`Project Change Tool failed to apply approved change: ${failureReason}`)
          if (deps.changeVoteSession.value) {
            deps.addChangeVoteSummaryMessage(deps.changeVoteSession.value, 'Project change vote passed, but execution failed. Open this card to inspect the proposal, votes, and failure detail.')
          }
          setTimeout(() => {
            deps.requestAllAgents([
              'The approved project change failed during tool execution. This is a tool/application error, not a reason to end the meeting.',
              'Retry by proposing a corrected request_project_action with clearer actionable content.',
              'Preserve the same user-facing intent unless there is a concrete reason to adjust it.',
              'For target: characters, content can be JSON, bullets, or prose, but must include inferable names and descriptions.',
              'For target: chapter-plan, content should clearly include the chapter outline fields; JSON is preferred but the skill tool can normalize prose.',
              `Failed target: ${session.request.target}`,
              `Failed scope: ${session.request.scope}`,
              `Failure reason: ${failureReason}`,
            ].join('\n'), { mandatoryBrainstorm: false })
          }, 0)
        }
        deps.scheduleSave()
        if (deps.changeVoteSession.value?.status === 'applied') {
          deps.addChangeVoteSummaryMessage(deps.changeVoteSession.value, 'Project change vote completed. Open this card to inspect the proposal, votes, and applied result.')
          setTimeout(() => {
            deps.requestAllAgents(buildPostToolReviewFocus(session, appliedResult), { mandatoryBrainstorm: false })
          }, 0)
        }
        return
      }
      if (rejections >= majority) {
        const refinementRound = session.refinementRound || 0
        if (!session.amendmentDepth && refinementRound < MAX_REFINEMENT_ROUNDS) {
          const nextSession: ReviewChangeVoteSession = {
            ...session,
            id: deps.createId('change-vote'),
            votes: [],
            refinementRound: refinementRound + 1,
            status: 'voting',
          }
          deps.changeVoteSession.value = nextSession
          deps.addSystemMessage(`Proposal entered refinement round ${nextSession.refinementRound}/${MAX_REFINEMENT_ROUNDS}. Agents should amend weak points instead of rejecting by default.`)
          setTimeout(() => {
            void runChangeVoteSession(nextSession.id)
          }, 0)
          return
        }
        deps.changeVoteSession.value = {
          ...session,
          status: 'rejected',
          result: 'The proposed change did not receive majority approval.',
          completedAt: new Date().toISOString(),
        }
        deps.addSystemMessage('Project change was rejected by majority vote.')
        deps.addChangeVoteSummaryMessage(deps.changeVoteSession.value, 'Project change vote was rejected. Open this card to inspect the proposal and vote breakdown.')
        deps.scheduleSave()
        setTimeout(() => {
          deps.requestAllAgents([
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

    const session = deps.changeVoteSession.value
    if (!session || session.id !== sessionId || session.status !== 'voting') return
    const approvals = session.votes.filter(vote => vote.vote === 'approve').length
    const rejections = session.votes.filter(vote => vote.vote === 'reject').length
    const isImprovementMode = session.request.action !== 'delete'
    const canPassByImprovement = isImprovementMode && approvals > 0 && approvals >= rejections

    if (canPassByImprovement) {
      let appliedResult = ''
      try {
        await applyApprovedChange(session)
        appliedResult = deps.changeVoteSession.value?.result || 'Approved action was applied.'
      } catch (error: any) {
        const failureReason = error?.message || 'Failed to apply approved action.'
        deps.changeVoteSession.value = {
          ...session,
          status: 'failed',
          error: failureReason,
          completedAt: new Date().toISOString(),
        }
        deps.addSystemMessage(`Project Action Tool failed to apply approved action: ${failureReason}`)
        if (deps.changeVoteSession.value) {
          deps.addChangeVoteSummaryMessage(deps.changeVoteSession.value, 'Project action vote passed in improvement mode, but execution failed. Open this card to inspect the proposal, votes, and failure detail.')
        }
      }
      deps.scheduleSave()
      if (deps.changeVoteSession.value?.status === 'applied') {
        deps.addSystemMessage('No strict majority was reached, but improvement-mode policy approved this action because support was not lower than opposition.')
        deps.addChangeVoteSummaryMessage(deps.changeVoteSession.value, 'Project action vote completed in improvement mode. Open this card to inspect the proposal, votes, and applied result.')
        setTimeout(() => {
          deps.requestAllAgents(buildPostToolReviewFocus(session, appliedResult), { mandatoryBrainstorm: false })
        }, 0)
      }
      return
    }

    deps.changeVoteSession.value = {
      ...session,
      status: 'rejected',
      result: 'The proposed action did not improve consensus (support was lower than opposition).',
      completedAt: new Date().toISOString(),
    }
    deps.addSystemMessage('Project action was rejected because support was lower than opposition.')
    deps.addChangeVoteSummaryMessage(deps.changeVoteSession.value, 'Project action vote ended without majority and without improvement-mode pass. Open this card to inspect the proposal and vote breakdown.')
    deps.scheduleSave()
    setTimeout(() => {
      deps.requestAllAgents([
        'The proposed action did not pass. Continue the meeting.',
        'Try to improve the proposal using targeted amendments or propose a clearer action request.',
        `Rejected target: ${session.request.target}`,
        `Rejected scope: ${session.request.scope}`,
        `Rejected purpose: ${session.request.purpose}`,
      ].join('\n'), { mandatoryBrainstorm: false })
    }, 0)
  }

  return {
    requestChangeVote,
    flushPendingChangeRequest,
    runChangeVoteSession,
  }
}
