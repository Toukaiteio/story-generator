import type { StoryProject } from '@/types/project'
import type { Chapter } from '@/types/chapter'
import type { Character } from '@/types/character'
import type { ToolCallStatusItem } from '@/components/ui/ToolCallStatus.vue'
import type {
  ReviewAgentState,
  ReviewContextElement,
  ReviewProposal,
  ReviewAskUserRequest,
  ReviewChangeRequest,
  ReviewChangeAmendment,
  ReviewChangeVoteSession,
  ReviewEndVoteValue,
  ReviewChangeTarget,
} from './types'
import { createId } from './definitions'

export function toStringList(value: unknown) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[,，;；]/).map(item => item.trim()).filter(Boolean)
  return []
}

export function parseLooseJson(value: string): any {
  const text = value.trim()
  if (!text) throw new Error('JSON content is empty.')
  try {
    return JSON.parse(text)
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
    if (fenced) return JSON.parse(fenced)
    const firstArray = text.indexOf('[')
    const lastArray = text.lastIndexOf(']')
    if (firstArray !== -1 && lastArray > firstArray) {
      return JSON.parse(text.slice(firstArray, lastArray + 1))
    }
    const firstObject = text.indexOf('{')
    const lastObject = text.lastIndexOf('}')
    if (firstObject !== -1 && lastObject > firstObject) {
      return JSON.parse(text.slice(firstObject, lastObject + 1))
    }
    throw new Error('Could not find valid JSON content.')
  }
}

export function normalizeReviewCharacter(raw: any, fallbackIndex: number): Character {
  const now = new Date().toISOString()
  const description = typeof raw?.description === 'string' ? raw.description.trim() : ''
  return {
    id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : createId('character'),
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : `Character ${fallbackIndex + 1}`,
    role: raw?.role === 'protagonist' || raw?.role === 'antagonist' || raw?.role === 'minor' ? raw.role : 'supporting',
    personality: toStringList(raw?.personality),
    appearance: typeof raw?.appearance === 'string' ? raw.appearance.trim() : description,
    backstory: typeof raw?.backstory === 'string' ? raw.backstory.trim() : description,
    motivation: typeof raw?.motivation === 'string' ? raw.motivation.trim() : '',
    goals: typeof raw?.goals === 'string' ? raw.goals.trim() : '',
    conflicts: typeof raw?.conflicts === 'string' ? raw.conflicts.trim() : '',
    currentState: typeof raw?.currentState === 'string' ? raw.currentState.trim() : description,
    relations: Array.isArray(raw?.relations) ? raw.relations : [],
    createdAt: typeof raw?.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: now,
  }
}

function extractCharactersFromText(value: string): any[] {
  const text = value.trim()
  if (!text) return []
  const candidates: any[] = []
  const headingPattern = /(?:^|\n)\s*(?:[-*]\s*)?(?:name\s*:\s*)?([A-Z][A-Za-z0-9' -]{1,40}|[一-鿿ぁ-んァ-ヶー]{1,20})\s*(?:[:：\-]\s*)?([\s\S]*?)(?=\n\s*(?:[-*]\s*)?(?:name\s*:\s*)?(?:[A-Z][A-Za-z0-9' -]{1,40}|[一-鿿ぁ-んァ-ヶー]{1,20})\s*(?:[:：\-]\s*)|\n{2,}|$)/g
  for (const match of text.matchAll(headingPattern)) {
    const name = match[1]?.trim()
    const body = match[2]?.trim()
    if (!name || name.length > 48) continue
    if (/^(target|scope|purpose|content|role|personality|description)$/i.test(name)) continue
    if (!body || body.length < 8) continue
    candidates.push({
      name,
      description: body,
      personality: body.match(/personality\s*[:：]\s*([^\n]+)/i)?.[1] || '',
      role: body.match(/role\s*[:：]\s*([^\n]+)/i)?.[1] || 'supporting',
    })
  }

  if (candidates.length) return candidates

  const nameLine = text.match(/(?:add|include|create|新增|添加)[\s\S]{0,120}?(?:characters?|members?|角色|成员)[\s\S]{0,80}?(?:named|called|包括|名为)?\s*([^.\n]+)/i)?.[1]
  if (nameLine) {
    return nameLine
      .split(/[,，、/&]| and /i)
      .map(name => name.trim().replace(/^["'“”]+|["'“”。.]+$/g, ''))
      .filter(name => name.length >= 2 && name.length <= 40)
      .map(name => ({ name, description: text, role: 'supporting' }))
  }

  return []
}

export function parseCharacterPayload(value: string): any[] {
  try {
    const parsed = parseLooseJson(value)
    const rawCharacters = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.characters)
        ? parsed.characters
        : parsed?.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)
          ? Object.entries(parsed.data).map(([name, details]) => ({
            name,
            ...(details && typeof details === 'object' ? details as Record<string, unknown> : { description: String(details ?? '') }),
          }))
          : []
    if (rawCharacters.length) return rawCharacters
  } catch {
    // Fall through to natural-language extraction.
  }
  return extractCharactersFromText(value)
}

function extractTaggedBlocks(content: string, tag: string) {
  const pattern = new RegExp(`\\[${tag}\\]([\\s\\S]*?)(?=\\[\\/${tag}\\]|\\[${tag}\\]|$)`, 'gi')
  return [...content.matchAll(pattern)]
    .map(match => match[1]?.trim() || '')
    .filter(Boolean)
}

function normalizeJsonStyleChangeRequest(parsed: any): ReviewChangeRequest | null {
  const target: ReviewChangeTarget | null = parsed?.target === 'master-outline' || parsed?.target === 'chapter-plan' || parsed?.target === 'characters' || parsed?.target === 'consensus'
    ? parsed.target
    : null
  if (!target) return null

  const action = typeof parsed?.action === 'string' && parsed.action.trim() ? parsed.action.trim() : 'update'
  const data = parsed?.data ?? parsed?.content
  const scope = typeof parsed?.scope === 'string' && parsed.scope.trim()
    ? parsed.scope.trim()
    : `${action} ${target}`
  const purpose = typeof parsed?.purpose === 'string' && parsed.purpose.trim()
    ? parsed.purpose.trim()
    : `Apply the requested ${action} change to ${target}.`
  const content = typeof data === 'string' ? data : JSON.stringify(data ?? parsed, null, 2)
  if (!content.trim()) return null

  return { target, scope, purpose, content }
}

export function normalizeChapterOutlinePatch(chapter: Chapter, request: ReviewChangeRequest): Chapter['outline'] {
  const base: Chapter['outline'] = {
    objective: chapter.outline?.objective ?? '',
    conflict: chapter.outline?.conflict ?? '',
    keyEvents: Array.isArray(chapter.outline?.keyEvents) ? [...chapter.outline.keyEvents] : [],
    characterActions: Array.isArray(chapter.outline?.characterActions) ? [...chapter.outline.characterActions] : [],
    infoReveals: Array.isArray(chapter.outline?.infoReveals) ? [...chapter.outline.infoReveals] : [],
    endingHook: chapter.outline?.endingHook ?? '',
  }

  let parsed: any = null
  try {
    parsed = parseLooseJson(request.content)
  } catch {
    parsed = null
  }

  const nextOutline = parsed?.outline && typeof parsed.outline === 'object' ? parsed.outline : parsed
  if (nextOutline && typeof nextOutline === 'object' && !Array.isArray(nextOutline)) {
    return {
      objective: typeof nextOutline.objective === 'string' ? nextOutline.objective : base.objective,
      conflict: typeof nextOutline.conflict === 'string' ? nextOutline.conflict : base.conflict,
      keyEvents: Array.isArray(nextOutline.keyEvents) ? nextOutline.keyEvents.map(String) : base.keyEvents,
      characterActions: Array.isArray(nextOutline.characterActions) ? nextOutline.characterActions.map(String) : base.characterActions,
      infoReveals: Array.isArray(nextOutline.infoReveals) ? nextOutline.infoReveals.map(String) : base.infoReveals,
      endingHook: typeof nextOutline.endingHook === 'string' ? nextOutline.endingHook : base.endingHook,
    }
  }

  const scope = request.scope.trim()
  const content = request.content.trim()
  const indexedListMatch = scope.match(/^(keyEvents|characterActions|infoReveals)\s*\[\s*(\d+)\s*\]/i)
  if (indexedListMatch) {
    const field = indexedListMatch[1] as 'keyEvents' | 'characterActions' | 'infoReveals'
    const index = Number(indexedListMatch[2])
    const list = [...base[field]]
    while (list.length <= index) list.push('')
    list[index] = content
    return { ...base, [field]: list }
  }

  const listFieldMatch = scope.match(/^(keyEvents|characterActions|infoReveals)\b/i)
  if (listFieldMatch) {
    const field = listFieldMatch[1] as 'keyEvents' | 'characterActions' | 'infoReveals'
    const items = content
      .split(/\r?\n/)
      .map(item => item.replace(/^[-*\d.)\s]+/, '').trim())
      .filter(Boolean)
    return { ...base, [field]: items.length ? items : [...base[field], content].filter(Boolean) }
  }

  if (/^objective\b/i.test(scope)) return { ...base, objective: content }
  if (/^conflict\b/i.test(scope)) return { ...base, conflict: content }
  if (/^endingHook\b/i.test(scope)) return { ...base, endingHook: content }

  throw new Error('Chapter plan changes need either outline JSON or a supported field scope such as keyEvents[2], characterActions, objective, conflict, infoReveals, or endingHook.')
}

export function extractFocusProposal(agent: ReviewAgentState, content: string): ReviewProposal | null {
  const focus = content.match(/\[PROPOSE_FOCUS:\s*([^\]]+)\]/i)
  if (focus?.[1]?.trim()) {
    return {
      id: createId('proposal'),
      type: 'focus',
      agentId: agent.id,
      agentName: agent.name,
      content: focus[1].trim(),
      reason: 'Agent proposed updating the meeting focus.',
      createdAt: new Date().toISOString(),
    }
  }

  return null
}

export function extractEndRequest(content: string) {
  const end = content.match(/\[REQUEST_END:\s*([^\]]+)\]/i)
  if (end?.[1]?.trim()) {
    return end[1].trim()
  }

  return null
}

export function extractAskUserRequest(content: string): ReviewAskUserRequest | null {
  const block = content.match(/\[ASK_USER\]([\s\S]*?)\[\/ASK_USER\]/i)?.[1]
  if (!block?.trim()) return null
  const readField = (name: string) => {
    const pattern = new RegExp(`^${name}\\s*:\\s*([\\s\\S]*?)(?=^(?:question|options|reason)\\s*:|$)`, 'im')
    return block.match(pattern)?.[1]?.trim() || ''
  }
  const question = readField('question')
  const reason = readField('reason')
  const rawOptions = readField('options')
  const options = rawOptions
    .split(/\r?\n|[|]/)
    .map(item => item.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 6)
  if (!question || options.length < 2) return null
  return { question, options, reason: reason || 'Agents need user clarification before proceeding.' }
}

export function extractChangeRequests(content: string): ReviewChangeRequest[] {
  const blocks = extractTaggedBlocks(content, 'REQUEST_CHANGE')
  const requests: ReviewChangeRequest[] = []

  for (const block of blocks) {
    if (!block.trim()) continue

    try {
      const parsed = parseLooseJson(block)
      const normalized = normalizeJsonStyleChangeRequest(parsed)
      if (normalized) {
        requests.push(normalized)
        continue
      }
    } catch {
      // Fall back to field-style block parsing.
    }

  const readField = (name: string) => {
    const pattern = new RegExp(`^${name}\\s*:\\s*([\\s\\S]*?)(?=^(?:target|scope|purpose|content)\\s*:|$)`, 'im')
    return block.match(pattern)?.[1]?.trim() || ''
  }
  const targetRaw = readField('target')
  const target: ReviewChangeTarget | null = targetRaw === 'master-outline' || targetRaw === 'chapter-plan' || targetRaw === 'characters' || targetRaw === 'consensus' ? targetRaw : null
  const scope = readField('scope')
  const purpose = readField('purpose')
  const changeContent = readField('content')
    if (!target || !scope || !purpose || !changeContent) continue
    requests.push({ target, scope, purpose, content: changeContent })
  }

  return requests
}

export function extractChangeRequest(content: string): ReviewChangeRequest | null {
  return extractChangeRequests(content)[0] ?? null
}

export function parseEndVote(content: string): { vote: ReviewEndVoteValue; reason: string } {
  const marker = content.match(/\[END_VOTE:\s*(yes|no|approve|reject)\s*\]/i)
  const normalized = marker?.[1]?.toLowerCase()
  const vote: ReviewEndVoteValue = normalized === 'yes' || normalized === 'approve' ? 'approve' : 'reject'
  const reason = content
    .replace(/\[END_VOTE:\s*(?:yes|no|approve|reject)\s*\]/ig, '')
    .replace(/^Reason\s*:\s*/im, '')
    .trim()

  return {
    vote,
    reason: reason || (vote === 'approve' ? 'The agent agrees the meeting goal is resolved.' : 'The agent thinks unresolved issues remain.'),
  }
}

export function parseChangeVote(content: string): { vote: ReviewEndVoteValue; reason: string } {
  const marker = content.match(/\[CHANGE_VOTE:\s*(yes|no|approve|reject)\s*\]/i)
  const normalized = marker?.[1]?.toLowerCase()
  const vote: ReviewEndVoteValue = normalized === 'yes' || normalized === 'approve' ? 'approve' : 'reject'
  const reason = content
    .replace(/\[CHANGE_VOTE:\s*(?:yes|no|approve|reject)\s*\]/ig, '')
    .replace(/^Reason\s*:\s*/im, '')
    .trim()

  return {
    vote,
    reason: reason || (vote === 'approve' ? 'The proposed change is safe and useful.' : 'The proposed change needs more discussion.'),
  }
}

export function extractAmendment(content: string): ReviewChangeAmendment | null {
  const block = content.match(/\[AMENDMENT\]([\s\S]*?)\[\/AMENDMENT\]/i)?.[1]
  if (!block?.trim()) return null
  const readField = (name: string) => {
    const pattern = new RegExp(`^${name}\\s*:\\s*([\\s\\S]*?)(?=^(?:action|scope|purpose|content)\\s*:|$)`, 'im')
    return block.match(pattern)?.[1]?.trim() || ''
  }
  const actionRaw = readField('action')
  const action = actionRaw === 'delete' || actionRaw === 'insert' ? actionRaw : 'modify'
  const scope = readField('scope')
  const purpose = readField('purpose')
  const amendmentContent = readField('content')
  if (!scope || !purpose || !amendmentContent) return null
  return { action, scope, purpose, content: amendmentContent }
}

export function applyAmendmentToRequest(request: ReviewChangeRequest, amendment: ReviewChangeAmendment): ReviewChangeRequest {
  if (amendment.action === 'delete') {
    return {
      ...request,
      scope: `${request.scope}\nDelete: ${amendment.scope}`,
      purpose: `${request.purpose}\nAmendment purpose: ${amendment.purpose}`,
      content: `${request.content}\n\nDeletion amendment:\n${amendment.content}`,
    }
  }
  if (amendment.action === 'insert') {
    return {
      ...request,
      scope: `${request.scope}\nInsert: ${amendment.scope}`,
      purpose: `${request.purpose}\nAmendment purpose: ${amendment.purpose}`,
      content: `${request.content}\n\nInsertion amendment:\n${amendment.content}`,
    }
  }
  return {
    ...request,
    scope: amendment.scope,
    purpose: amendment.purpose,
    content: amendment.content,
  }
}

export function stripReasoningText(content: string) {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:thinking|reasoning)[\s\S]*?```/gi, '')
    .replace(/^\s*(?:Thinking|Reasoning)\s*:\s*[\s\S]*?(?=\n\s*(?:Final|Answer)\s*:|\n{2,}|$)/i, '')
    .replace(/^\s*(?:Final|Answer)\s*:\s*/i, '')
    .trim()
}

export function stripMeetingControlBlocks(content: string) {
  return content
    .replace(/\[(?:SEND_MESSAGE|PUBLIC_MESSAGE)\][\s\S]*?\[\/(?:SEND_MESSAGE|PUBLIC_MESSAGE)\]/gi, '')
    .replace(/\[(?:SEND_MESSAGE|PUBLIC_MESSAGE)\]/gi, '')
    .replace(/\[REQUEST_CHANGE\][\s\S]*?\[\/REQUEST_CHANGE\]/gi, '')
    .replace(/\[ASK_USER\][\s\S]*?\[\/ASK_USER\]/gi, '')
    .replace(/\[REQUEST_END:\s*([^\]]+)\]/gi, '')
    .replace(/\[PROPOSE_FOCUS:\s*([^\]]+)\]/gi, '')
    .replace(/\[CALL_AGENT:\s*([^\]]+)\]/gi, '')
    .replace(/\[REQUEST_SPEECH\]/gi, '')
    .replace(/\[CHANGE_VOTE:\s*(?:yes|no|approve|reject)\s*\]/gi, '')
    .replace(/\[END_VOTE:\s*(?:yes|no|approve|reject)\s*\]/gi, '')
    .trim()
}

export function sanitizePublicAgentMessage(content: string) {
  return content
    .split(/\r?\n/)
    .filter(line => !/^\s*(?:Current Meeting Opening \/ Focus|Speaking Permission|Current Phase|Recent Public Meeting Context|New Public Messages Since Your Last Turn|Your Private Memory|Tool Usage Instruction|Rules)\s*:/i.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function extractPublicAgentMessage(content: string) {
  const blocks = [...content.matchAll(/\[(?:SEND_MESSAGE|PUBLIC_MESSAGE)\]([\s\S]*?)\[\/(?:SEND_MESSAGE|PUBLIC_MESSAGE)\]/gi)]
  if (blocks.length > 0) {
    return blocks.map(match => sanitizePublicAgentMessage(match[1] || ''))
      .filter(Boolean)
      .join('\n\n').trim()
  }

  const unclosedMatch = content.match(/\[(?:SEND_MESSAGE|PUBLIC_MESSAGE)\]([\s\S]*)/i)
  if (unclosedMatch) {
    const cleaned = sanitizePublicAgentMessage(stripMeetingControlBlocks(unclosedMatch[1] || ''))
    if (cleaned.length >= 5) return cleaned
  }

  const cleaned = sanitizePublicAgentMessage(stripMeetingControlBlocks(content))
  if (cleaned.length < 5) return ''
  return cleaned
}

export function extractTurnRequests(content: string): string[] {
  const agents = [...content.matchAll(/\[CALL_AGENT:\s*([^\]]+)\]/gi)].map(m => m[1].trim())
  const self = /\[REQUEST_SPEECH\]/i.test(content) ? ['self'] : []
  return [...new Set([...agents, ...self])]
}

export function parseAskUserVote(content: string): { vote: ReviewEndVoteValue; reason: string } {
  const marker = content.match(/\[ASK_USER_VOTE:\s*(yes|no|approve|reject)\s*\]/i)
  const normalized = marker?.[1]?.toLowerCase()
  const vote: ReviewEndVoteValue = normalized === 'yes' || normalized === 'approve' ? 'approve' : 'reject'
  const reason = content.replace(/\[ASK_USER_VOTE:\s*(?:yes|no|approve|reject)\s*\]/ig, '').replace(/^Reason\s*:\s*/im, '').trim()
  return { vote, reason: reason || (vote === 'approve' ? 'Clarification is needed.' : 'Clarification is not necessary.') }
}

export function createToolMessage(name: string, status: ToolCallStatusItem['status'], title: string, description: string, detail?: string, before?: string, after?: string): ToolCallStatusItem {
  return {
    id: createId('tool'),
    name,
    status,
    title,
    description,
    detail,
    before,
    after,
  }
}

export function rememberAcceptedChangeForAllAgents(agents: ReviewAgentState[], session: ReviewChangeVoteSession, result: string) {
  const memory = [
    `Accepted project change ${new Date().toLocaleString()}: ${session.request.target}.`,
    `Scope: ${session.request.scope}`,
    `Purpose: ${session.request.purpose}`,
    `Result: ${result}`,
    'Modify means agree: this applied change is now source-of-truth. Do not propose reverting it or restoring the previous version unless the user explicitly asks for a new change.',
  ].join(' ')

  for (const agent of agents) {
    agent.privateMemory = [...agent.privateMemory, memory].slice(-12)
  }
}

export function elementLink(element: ReviewContextElement, label: string) {
  return `[[${element}:${label}]]`
}

export function buildPostToolReviewFocus(session: ReviewChangeVoteSession, result: string) {
  return [
    `${result}`,
    'Continue the meeting instead of stopping automatically.',
    'Review whether the applied change or consensus satisfies the latest user request.',
    'If more work is needed, propose the next change or consensus vote.',
    'If the issue is truly resolved, request ending the meeting with [REQUEST_END: reason].',
    `Accepted target: ${session.request.target}`,
    `Accepted scope: ${session.request.scope}`,
  ].join('\n')
}
