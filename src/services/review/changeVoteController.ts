import type { Ref } from 'vue'
import { providerManager } from '@/services/provider'
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
  function changeVoters() {
    return deps.agents.value.filter(agent => agent.enabled)
  }

  function requestChangeVote(agent: ReviewAgentState, request: ReviewChangeRequest) {
    const normalizedRequest = deps.normalizeChangeRequestCompat(request)
    if (!normalizedRequest) return
    if (deps.changeVoteSession.value?.status === 'voting' || deps.changeVoteSession.value?.status === 'applying') {
      deps.pendingChangeRequests.value.push({ agent, request: normalizedRequest })
      deps.addSystemMessage(`${agent.name} created an additional proposal. It was queued until the active change vote finishes.`)
      return
    }
    if (!deps.brainstormRoundCompleted.value) {
      deps.pendingChangeRequests.value.push({ agent, request: normalizedRequest })
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
      request: normalizedRequest,
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
        `[Change request: ${normalizedRequest.target}]`,
        `Action: ${normalizedRequest.action}`,
        `Scope: ${normalizedRequest.scope}`,
        `Purpose: ${normalizedRequest.purpose}`,
        'The request will be applied automatically if a majority of meeting agents approve.',
      ].join('\n'),
      tool: createToolMessage('request_project_change', 'pending', 'Change vote requested', `${agent.name} requested a project change`, normalizedRequest.content),
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
      const content = await providerManager.chat(
        buildChangeVoteMessages(agent, deps.messages.value, deps.context(), deps.currentFocus.value, deps.selectedContextElements.value, session),
        model,
        700,
        0.2,
        abortController.signal
      )
      if (deps.changeVoteSession.value?.id !== sessionId || abortController.signal.aborted) return
      const cleanVoteContent = stripReasoningText(content)
      const parsed = parseChangeVote(cleanVoteContent)
      const amendment = deps.changeVoteSession.value.amendmentDepth ? null : extractAmendment(cleanVoteContent)
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
      const content = await providerManager.chat(
        buildSkillAgentMessages(session, deps.context(), deps.selectedContextElements.value),
        model,
        1800,
        0.15
      )
      const parsed = parseLooseJson(stripReasoningText(content))
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
      return { ...session, request: normalized }
    } catch (error: any) {
      deps.messages.value.push({
        id: deps.createId('system'),
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
    deps.changeVoteSession.value = { ...session, status: 'applying' }
    deps.scheduleSave()
    const executableSession = await normalizeApprovedChangeWithSkillAgent(session)
    const action: ReviewChangeAction = normalizeChangeAction(executableSession.request.action)

    if (executableSession.request.target === 'consensus') {
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
      deps.changeVoteSession.value = { ...executableSession, status: 'applied', result, completedAt: new Date().toISOString() }
      return
    }

    if (executableSession.request.target === 'master-outline') {
      const before = project.outline || ''
      if (action === 'read') {
        const result = 'Project Change Tool returned the current master outline without modifying project files.'
        deps.messages.value.push({
          id: deps.createId('system'),
          role: 'system',
          content: result,
          tool: createToolMessage('read_master_outline', 'success', 'Master outline fetched', executableSession.request.scope, executableSession.request.purpose, '', before),
          createdAt: new Date().toISOString(),
        })
        deps.changeVoteSession.value = { ...executableSession, request: { ...executableSession.request, action }, status: 'applied', result, completedAt: new Date().toISOString() }
        return
      }
      const nextOutline = action === 'delete' ? '' : executableSession.request.content
      const saved = await deps.projectStore.updateProject(project.id, { outline: nextOutline })
      if (saved === null) throw new Error('Failed to save master outline change to the project file.')
      await deps.verifyProjectPersistence(
        project.id,
        reloaded => (reloaded.outline || '') === nextOutline,
        'The master outline change did not persist to the project file.'
      )
      const result = 'Project Change Tool applied the approved change to the master outline.'
      deps.messages.value.push({
        id: deps.createId('system'),
        role: 'system',
        content: `${result}\nAll agents must treat this applied change as accepted source-of-truth. Do not revert it unless the user explicitly requests a new change.`,
        tool: createToolMessage(action === 'delete' ? 'clear_master_outline' : 'replace_master_outline', 'success', action === 'delete' ? 'Master outline cleared' : 'Master outline updated', executableSession.request.scope, executableSession.request.purpose, before, nextOutline),
        createdAt: new Date().toISOString(),
      })
      rememberAcceptedChangeForAllAgents(deps.agents.value, executableSession, result)
      deps.changeVoteSession.value = { ...executableSession, request: { ...executableSession.request, action }, status: 'applied', result, completedAt: new Date().toISOString() }
      return
    }

    if (executableSession.request.target === 'characters') {
      if (action === 'read') {
        const result = 'Project Change Tool returned the current characters without modifying project files.'
        deps.messages.value.push({
          id: deps.createId('system'),
          role: 'system',
          content: result,
          tool: createToolMessage('read_characters', 'success', 'Characters fetched', executableSession.request.scope, executableSession.request.purpose, '', JSON.stringify(project.characters, null, 2)),
          createdAt: new Date().toISOString(),
        })
        deps.changeVoteSession.value = { ...executableSession, request: { ...executableSession.request, action }, status: 'applied', result, completedAt: new Date().toISOString() }
        return
      }
      const before = JSON.stringify(project.characters, null, 2)
      let merged = [...project.characters]
      let affectedNames: string[] = []
      if (action === 'delete') {
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
      const saved = await deps.projectStore.updateProject(project.id, { characters: merged })
      if (saved === null) throw new Error('Failed to save character changes to the project file.')
      const affectedNameSet = new Set(affectedNames.map(name => name.toLowerCase()).filter(Boolean))
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
      deps.changeVoteSession.value = { ...executableSession, request: { ...executableSession.request, action }, status: 'applied', result, completedAt: new Date().toISOString() }
      return
    }

    const chapter = deps.context().chapter
    if (!chapter) throw new Error('No chapter is selected for chapter-plan changes.')
    if (action === 'read') {
      const result = `Project Change Tool returned the current Chapter ${chapter.index + 1} plan without modifying project files.`
      deps.messages.value.push({
        id: deps.createId('system'),
        role: 'system',
        content: result,
        tool: createToolMessage('read_chapter_outline', 'success', 'Chapter plan fetched', executableSession.request.scope, executableSession.request.purpose, '', JSON.stringify(chapter.outline, null, 2)),
        createdAt: new Date().toISOString(),
      })
      deps.changeVoteSession.value = { ...executableSession, request: { ...executableSession.request, action }, status: 'applied', result, completedAt: new Date().toISOString() }
      return
    }
    const normalizedOutline = action === 'delete'
      ? applyChapterPlanDelete(chapter, executableSession.request)
      : normalizeChapterOutlinePatch(chapter, executableSession.request)
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
    const saved = await deps.projectStore.updateProject(project.id, { chapters })
    if (saved === null) throw new Error('Failed to save chapter plan change to the project file.')
    const expectedOutline = normalizeOutlineForCompare(normalizedOutline)
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
  }

  return {
    requestChangeVote,
    flushPendingChangeRequest,
    runChangeVoteSession,
  }
}
