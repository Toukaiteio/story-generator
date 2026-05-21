import type { StoryProject } from '@/types/project'

import type { Chapter } from '@/types/chapter'

import type { Character } from '@/types/character'

import type { ToolCallStatusItem } from '@/components/ui/ToolCallStatus.vue'

import type {

  ReviewAgentState,

  ReviewContextElement,

  ReviewProposal,

  ReviewAskUserRequest,

  ReviewChangeAction,

  ReviewChangeRequest,

  ReviewChangeAmendment,

  ReviewActionVoteSession,

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

  const MAX_NAME_LENGTH = 48

  const headingPattern = /(?:^|\n)\s*(?:[-*]\s*)?(?:name\s*:\s*)?([A-Z][A-Za-z0-9' -]{1,40}|[一-鿿ぁ-んァ-ヶー]{1,20})\s*(?:[:：\-]\s*)?([\s\S]*?)(?=\n\s*(?:[-*]\s*)?(?:name\s*:\s*)?(?:[A-Z][A-Za-z0-9' -]{1,40}|[一-鿿ぁ-んァ-ヶー]{1,20})\s*(?:[:：\-]\s*)|\n{2,}|$)/g

  for (const match of text.matchAll(headingPattern)) {

    const name = match[1]?.trim()

    const body = match[2]?.trim()

    if (!name || name.length > MAX_NAME_LENGTH) continue

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



  const action = normalizeChangeAction(parsed?.action)

  const data = parsed?.data ?? parsed?.content

  const scope = typeof parsed?.scope === 'string' && parsed.scope.trim()

    ? parsed.scope.trim()

    : `${action} ${target}`

  const purpose = typeof parsed?.purpose === 'string' && parsed.purpose.trim()

    ? parsed.purpose.trim()

    : `Apply the requested ${action} change to ${target}.`

  const content = typeof data === 'string' ? data : JSON.stringify(data ?? parsed, null, 2)

  const normalizedContent = content.trim() || (action === 'read' ? 'N/A' : '')

  if (!normalizedContent) return null



  return { target, action, scope, purpose, content: normalizedContent }

}



export function normalizeChangeAction(value: unknown): ReviewChangeAction {

  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''

  if (normalized === 'create' || normalized === 'read' || normalized === 'update' || normalized === 'delete') {

    return normalized

  }

  return 'update'

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



  const inferred = inferOutlineFromStructuredText(content)

  if (inferred) {

    return {

      objective: inferred.objective ?? base.objective,

      conflict: inferred.conflict ?? base.conflict,

      keyEvents: inferred.keyEvents ?? base.keyEvents,

      characterActions: inferred.characterActions ?? base.characterActions,

      infoReveals: inferred.infoReveals ?? base.infoReveals,

      endingHook: inferred.endingHook ?? base.endingHook,

    }

  }



  // REVIEW-009: Return original outline as fallback instead of throwing,

  // so callers can handle gracefully when input is not parseable.

  return base

}



function inferOutlineFromStructuredText(content: string): Partial<Chapter['outline']> | null {

  const text = content.trim()

  if (!text) return null



  const sections = splitStructuredSections(text)

  if (!sections.size) return null



  const parseList = (value: string) => value

    .split(/\r?\n/)

    .map(item => item.replace(/^[-*\d.)\s]+/, '').trim())

    .filter(Boolean)



  const outline: Partial<Chapter['outline']> = {}



  const objective = firstSection(sections, ['objective', '目标', '章节目标'])

  if (objective) outline.objective = objective



  const conflict = firstSection(sections, ['conflict', '冲突', '核心冲突'])

  if (conflict) outline.conflict = conflict



  const keyEvents = firstSection(sections, ['keyevents', 'key events', '关键事件'])

  if (keyEvents) outline.keyEvents = parseList(keyEvents)



  const characterActions = firstSection(sections, ['characteractions', 'character actions', '角色行动'])

  if (characterActions) outline.characterActions = parseList(characterActions)



  const infoReveals = firstSection(sections, ['inforeveals', 'info reveals', '信息揭示'])

  if (infoReveals) outline.infoReveals = parseList(infoReveals)



  const endingHook = firstSection(sections, ['endinghook', 'ending hook', '结尾钩子'])

  if (endingHook) outline.endingHook = endingHook



  const hasAny = Boolean(

    outline.objective

    || outline.conflict

    || (outline.keyEvents && outline.keyEvents.length)

    || (outline.characterActions && outline.characterActions.length)

    || (outline.infoReveals && outline.infoReveals.length)

    || outline.endingHook

  )



  return hasAny ? outline : null

}



function splitStructuredSections(text: string): Map<string, string> {

  const lines = text.split(/\r?\n/)

  const map = new Map<string, string>()

  let currentKey = ''

  let buffer: string[] = []



  const flush = () => {

    if (!currentKey) return

    const merged = buffer.join('\n').trim()

    if (merged) map.set(normalizeSectionKey(currentKey), merged)

  }



  for (const rawLine of lines) {

    const line = rawLine.trim()

    const match = line.match(/^([A-Za-z ]+|[\u4e00-\u9fa5]{2,8})\s*[:：]\s*(.*)$/)

    if (!match) {

      if (currentKey) buffer.push(rawLine)

      continue

    }

    flush()

    currentKey = match[1]

    buffer = [match[2] || '']

  }

  flush()

  return map

}



function normalizeSectionKey(key: string) {

  return key.toLowerCase().replace(/\s+/g, '').trim()

}



function firstSection(map: Map<string, string>, aliases: string[]) {

  for (const alias of aliases) {

    const value = map.get(normalizeSectionKey(alias))

    if (value) return value

  }

  return ''

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

  const blocks = [

    ...extractTaggedBlocks(content, 'REQUEST_ACTION'),

    ...extractTaggedBlocks(content, 'REQUEST_CHANGE'),

  ]

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

    const pattern = new RegExp(`^${name}\\s*:\\s*([\\s\\S]*?)(?=^(?:action|target|scope|purpose|content)\\s*:|$)`, 'im')

    return block.match(pattern)?.[1]?.trim() || ''

  }

  const action = normalizeChangeAction(readField('action'))

  const targetRaw = readField('target')

  const target: ReviewChangeTarget | null = targetRaw === 'master-outline' || targetRaw === 'chapter-plan' || targetRaw === 'characters' || targetRaw === 'consensus' ? targetRaw : null

  const scope = readField('scope')

  const purpose = readField('purpose')

  const changeContent = readField('content')

  const normalizedContent = changeContent || (action === 'read' ? 'N/A' : '')

    if (!target || !scope || !purpose || !normalizedContent) continue

    requests.push({ target, action, scope, purpose, content: normalizedContent })

  }



  return requests

}



export function inferImplicitChangeRequest(

  content: string,

  options: { hasChapter?: boolean } = {}

): ReviewChangeRequest | null {

  const cleaned = sanitizePublicAgentMessage(stripMeetingControlBlocks(content || ''))

  if (!cleaned) return null



  const targetHints = {

    chapterPlan: /(chapter[\s-]*(?:plan|outline)|章节(?:规划|计划|大纲)|当前章|本章)/i,

    characters: /(characters?|角色|人物|成员|cast)/i,

    masterOutline: /(master[\s-]*outline|主线大纲|故事大纲|主大纲|整体大纲|全局大纲)/i,

  }

  const editVerb = /(rewrite|revise|update|modify|replace|refine|improve|写入|重写|修改|更新|完善|调整|补充|新增|删除)/i

  if (!editVerb.test(cleaned)) return null



  let target: ReviewChangeTarget | null = null

  if (targetHints.chapterPlan.test(cleaned) && options.hasChapter) {

    target = 'chapter-plan'

  } else if (targetHints.masterOutline.test(cleaned)) {

    target = 'master-outline'

  } else if (targetHints.characters.test(cleaned)) {

    target = 'characters'

  } else if (targetHints.chapterPlan.test(cleaned)) {

    // If chapter hints exist but no chapter is selected, fall back to master outline.

    target = 'master-outline'

  }

  if (!target) return null



  const firstSentence = cleaned

    .split(/\r?\n+/)

    .map(line => line.trim())

    .find(Boolean) || 'Apply synthesized meeting change.'



  return {

    target,

    action: 'update',

    scope: target === 'chapter-plan' ? 'chapter-plan' : target,

    purpose: firstSentence.slice(0, 220),

    content: cleaned,

  }

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



export function parseActionVote(content: string): { vote: ReviewEndVoteValue; reason: string } {

  const marker = content.match(/\[CHANGE_VOTE:\s*(yes|no|approve|reject)\s*\]/i)

  const normalized = marker?.[1]?.toLowerCase()

  if (normalized === 'yes' || normalized === 'approve') {

    const reason = content

      .replace(/\[CHANGE_VOTE:\s*(?:yes|no|approve|reject)\s*\]/ig, '')

      .replace(/^Reason\s*:\s*/im, '')

      .trim()

    return {

      vote: 'approve' as ReviewEndVoteValue,

      reason: `${reason || 'The proposed change is safe and useful.'} [Warning: agent did not use submit_action_vote function call; vote was inferred from text marker. Agents must always call submit_action_vote to cast a vote.]`,

    }

  }

  if (normalized === 'no' || normalized === 'reject') {

    const reason = content

      .replace(/\[CHANGE_VOTE:\s*(?:yes|no|approve|reject)\s*\]/ig, '')

      .replace(/^Reason\s*:\s*/im, '')

      .trim()

    return {

      vote: 'reject' as ReviewEndVoteValue,

      reason: `${reason || 'The proposed change needs more discussion.'} [Warning: agent did not use submit_action_vote function call; vote was inferred from text marker. Agents must always call submit_action_vote to cast a vote.]`,

    }

  }



  const approvePatterns = /\b(?:i\s+(?:will\s+)?vote\s+(?:yes|approve)|vote\s*[:=]\s*(?:yes|approve)|my\s+vote\s+is\s+(?:yes|approve)|i\s+approve|i\s+(?:will\s+)?support|投票\s*(?:赞成|通[过過]|支持)|我\s*(?:赞成|通[过過]|支持))/i

  const rejectPatterns = /\b(?:i\s+(?:will\s+)?vote\s+(?:no|reject)|vote\s*[:=]\s*(?:no|reject)|my\s+vote\s+is\s+(?:no|reject)|i\s+reject|i\s+(?:will\s+)?oppose|投票\s*(?:反对|拒绝|否决)|我\s*(?:反对|拒绝|否决))/i



  const hasApprove = approvePatterns.test(content)

  const hasReject = rejectPatterns.test(content)



  if (hasApprove && !hasReject) {

    const reason = content

      .replace(/\[CHANGE_VOTE:\s*(?:yes|no|approve|reject)\s*\]/ig, '')

      .replace(/^Reason\s*:\s*/im, '')

      .trim()

    return {

      vote: 'approve' as ReviewEndVoteValue,

      reason: `${reason || 'The proposed change is safe and useful.'} [Warning: agent did not use submit_action_vote function call; vote was inferred from text. Agents must always call submit_action_vote to cast a vote.]`,

    }

  }



  const reason = content

    .replace(/\[CHANGE_VOTE:\s*(?:yes|no|approve|reject)\s*\]/ig, '')

    .replace(/^Reason\s*:\s*/im, '')

    .trim()

  return {

    vote: 'reject' as ReviewEndVoteValue,

    reason: `${reason || 'The proposed change needs more discussion.'} [Warning: agent did not use submit_action_vote function call; vote was inferred from text. Agents must always call submit_action_vote to cast a vote.]`,

  }

}



export function extractAmendment(content: string): ReviewChangeAmendment | null {

  const block = content.match(/\[AMENDMENT\]([\s\S]*?)\[\/AMENDMENT\]/i)?.[1]

  if (block?.trim()) {

    const readField = (name: string) => {

      const pattern = new RegExp(`^${name}\\s*:\\s*([\\s\\S]*?)(?=^(?:action|scope|purpose|content)\\s*:|$)`, 'im')

      return block.match(pattern)?.[1]?.trim() || ''

    }

    const actionRaw = readField('action')

    const action = actionRaw === 'delete' || actionRaw === 'insert' ? actionRaw : 'modify'

    const scope = readField('scope')

    const purpose = readField('purpose')

    const amendmentContent = readField('content')

    if (scope && purpose && amendmentContent) {

      return { action, scope, purpose, content: amendmentContent }

    }

  }



  const jsonAmendment = content.match(/```json\s*([\s\S]*?)```/i)?.[1]?.trim()

    ?? content.match(/\{[\s\S]*?"action"\s*:\s*"?(?:modify|delete|insert)"?[\s\S]*?"scope"\s*:[\s\S]*?"purpose"\s*:[\s\S]*?"content"\s*:[\s\S]*?\}/i)?.[0]?.trim()

  if (jsonAmendment) {

    try {

      const parsed = JSON.parse(jsonAmendment)

      if (parsed && typeof parsed === 'object') {

        const action = parsed.action === 'delete' || parsed.action === 'insert' ? parsed.action : 'modify'

        const scope = typeof parsed.scope === 'string' ? parsed.scope.trim() : ''

        const purpose = typeof parsed.purpose === 'string' ? parsed.purpose.trim() : ''

        const amendmentContent = typeof parsed.content === 'string' ? parsed.content.trim() : ''

        if (scope && purpose && amendmentContent) {

          return { action, scope, purpose, content: amendmentContent }

        }

      }

    } catch {}

  }



  return null

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

    .replace(/\[REQUEST_ACTION\][\s\S]*?\[\/REQUEST_ACTION\]/gi, '')

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

  const cleaned = content

    .replace(/^\s*\[[^\]]*?\bAgent\]\s*/i, '')

    .split(/\r?\n/)

    .filter(line => !/^\s*(?:Current Meeting Opening \/ Focus|Speaking Permission|Current Phase|Recent Public Meeting Context|New Public Messages Since Your Last Turn|Your Private Memory|Tool Usage Instruction|Rules)\s*:/i.test(line))

    .join('\n')

    .replace(/\n{3,}/g, '\n\n')

    .trim()

  if (!cleaned) return ''

  if (

    /^(let me|让我|我先).{0,80}(?:查看|检查|复查|read|check|review).{0,80}(?:故事配置|story configuration|完整的故事配置)/i.test(cleaned)

    || /^(i need to|需要先).{0,80}(?:查看|检查|read|check).{0,80}(?:配置|configuration)/i.test(cleaned)

  ) {

    return ''

  }

  return cleaned

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



export function rememberAcceptedChangeForAllAgents(agents: ReviewAgentState[], session: ReviewActionVoteSession, result: string) {

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



export function buildPostToolReviewFocus(session: ReviewActionVoteSession, result: string) {

  return [

    `${result}`,

    'Continue the meeting instead of stopping automatically.',

    'Review whether the applied change or consensus satisfies the latest user request.',

    'If more work is needed, propose the next change or consensus vote.',

    'If the issue is truly resolved, call request_end_meeting with a concise reason.',

    'Do not repeat an already-applied write proposal; propose only the next delta if needed.',

    `Accepted target: ${session.request.target}`,

    `Accepted scope: ${session.request.scope}`,

  ].join('\n')

}

