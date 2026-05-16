import type { ChatMessage } from '@/types/provider'

/** Approximate tokens per character for mixed CJK/English content. */
const CHARS_PER_TOKEN_EN = 4
const CHARS_PER_TOKEN_CJK = 1.5
const MESSAGE_OVERHEAD_TOKENS = 4
const TOOL_FIELD_OVERHEAD_TOKENS = 8

export interface ContextBudget {
  /** Total context window in tokens. */
  total: number
  /** Reserved for the model's response. */
  reservedForOutput: number
  /** Usable budget for input messages. */
  available: number
}

export interface CompressionResult {
  messages: ChatMessage[]
  compressedCount: number
  savedTokens: number
}

export interface SmartCompressionOptions {
  threshold?: number
  preserveRecentGroups?: number
}

export interface SmartCompressionResult extends CompressionResult {
  originalTokens: number
  newTokens: number
  compressedGroups: number
}

export interface ToolCallContinuityResult {
  messages: ChatMessage[]
  strippedAssistantToolCalls: number
  droppedOrphanToolMessages: number
}

type MessageGroupKind = 'system' | 'single' | 'tool-round'

interface MessageGroup {
  kind: MessageGroupKind
  messages: ChatMessage[]
  tokenEstimate: number
  compressible: boolean
}

/**
 * Estimates token count for a piece of text.
 * Uses a simple heuristic: CJK characters ~1.5 tokens each, others ~0.25 tokens each.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    // CJK Unified Ideographs + common ranges
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++
    } else {
      other++
    }
  }
  return Math.ceil(cjk / CHARS_PER_TOKEN_CJK + other / CHARS_PER_TOKEN_EN)
}

export function estimateMessageTokens(message: ChatMessage): number {
  let total = MESSAGE_OVERHEAD_TOKENS + estimateTokens(message.content || '')

  if (message.reasoning_content) {
    total += estimateTokens(message.reasoning_content)
  }

  if (message.role === 'tool') {
    total += TOOL_FIELD_OVERHEAD_TOKENS + estimateTokens(message.tool_call_id || '')
  }

  for (const toolCall of message.tool_calls || []) {
    total += TOOL_FIELD_OVERHEAD_TOKENS
    total += estimateTokens(toolCall.id || '')
    total += estimateTokens(toolCall.function?.name || '')
    total += estimateTokens(toolCall.function?.arguments || '')
  }

  return total
}

/**
 * Estimates total tokens for an array of chat messages.
 */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
}

/**
 * Calculates the context budget given a total context window and output reservation.
 */
export function calculateBudget(contextTokens: number, outputTokens: number): ContextBudget {
  const reservedForOutput = Math.min(outputTokens, Math.floor(contextTokens * 0.4))
  return {
    total: contextTokens,
    reservedForOutput,
    available: contextTokens - reservedForOutput,
  }
}

function previewText(value: string | null | undefined, limit = 360): string {
  const text = (value || '').replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function summarizeToolRound(messages: ChatMessage[]): string {
  const assistant = messages.find(message => message.role === 'assistant')
  const toolNames = (assistant?.tool_calls || [])
    .map(toolCall => toolCall.function.name)
    .filter(Boolean)

  const parts = [`[Assistant tool round]: ${toolNames.length ? `called ${toolNames.join(', ')}` : 'called tools'}.`]

  for (const toolCall of assistant?.tool_calls || []) {
    const args = previewText(toolCall.function.arguments, 180)
    if (args) {
      parts.push(`[Tool args ${toolCall.function.name}]: ${args}`)
    }
  }

  for (const message of messages) {
    if (message.role !== 'tool') continue
    const result = previewText(message.content, 220)
    parts.push(`[Tool result ${message.tool_call_id || 'unknown'}]: ${result}`)
  }

  return parts.join('\n')
}

/**
 * Summarizes a set of messages into a single condensed message.
 * Extracts key information from each message and merges them.
 */
function summarizeMessages(messages: ChatMessage[]): string {
  const parts: string[] = []
  for (let index = 0; index < messages.length; index++) {
    const msg = messages[index]
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      const groupMessages = [msg]
      const expectedIds = new Set(msg.tool_calls.map(toolCall => toolCall.id))
      let cursor = index + 1
      while (cursor < messages.length && messages[cursor].role === 'tool' && expectedIds.has(messages[cursor].tool_call_id || '')) {
        groupMessages.push(messages[cursor])
        cursor++
      }
      parts.push(summarizeToolRound(groupMessages))
      index = cursor - 1
      continue
    }

    if (msg.role === 'tool') {
      parts.push(`[Tool result ${msg.tool_call_id || 'unknown'}]: ${previewText(msg.content, 220)}`)
      continue
    }

    const role = msg.role === 'system' ? 'System' : msg.role === 'user' ? 'User' : 'Assistant'
    const snippets = [previewText(msg.content, 420)]
    if (msg.reasoning_content) {
      snippets.push(`[Reasoning]: ${previewText(msg.reasoning_content, 220)}`)
    }
    parts.push(`[${role}]: ${snippets.filter(Boolean).join('\n')}`)
  }
  return `[Context compressed — ${messages.length} earlier messages summarized]\n\n${parts.join('\n\n')}`
}

function groupMessagesForChatCompletions(messages: ChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  let index = 0

  while (index < messages.length) {
    const message = messages[index]

    if (index === 0 && message.role === 'system') {
      groups.push({
        kind: 'system',
        messages: [message],
        tokenEstimate: estimateMessageTokens(message),
        compressible: false,
      })
      index++
      continue
    }

    if (message.role === 'assistant' && message.tool_calls?.length) {
      const expectedIds = new Set(message.tool_calls.map(toolCall => toolCall.id))
      const seenIds = new Set<string>()
      const groupMessages = [message]
      let cursor = index + 1

      while (cursor < messages.length && messages[cursor].role === 'tool') {
        const toolCallId = messages[cursor].tool_call_id || ''
        if (!expectedIds.has(toolCallId)) break
        seenIds.add(toolCallId)
        groupMessages.push(messages[cursor])
        cursor++
      }

      groups.push({
        kind: 'tool-round',
        messages: groupMessages,
        tokenEstimate: estimateMessagesTokens(groupMessages),
        compressible: seenIds.size === expectedIds.size,
      })
      index = cursor
      continue
    }

    groups.push({
      kind: 'single',
      messages: [message],
      tokenEstimate: estimateMessageTokens(message),
      compressible: message.role !== 'tool',
    })
    index++
  }

  return groups
}

function flattenGroups(groups: MessageGroup[]): ChatMessage[] {
  return groups.flatMap(group => group.messages)
}

/**
 * Ensures assistant tool-call messages and tool result messages stay protocol-safe.
 *
 * Rules:
 * 1. A tool message without a directly preceding assistant tool-call round is dropped.
 * 2. An assistant message with incomplete tool results has its tool_calls stripped.
 *    The assistant content/reasoning is kept when present.
 */
export function sanitizeToolCallContinuity(messages: ChatMessage[]): ToolCallContinuityResult {
  const sanitized: ChatMessage[] = []
  let strippedAssistantToolCalls = 0
  let droppedOrphanToolMessages = 0

  let index = 0
  while (index < messages.length) {
    const message = messages[index]

    if (message.role === 'tool') {
      droppedOrphanToolMessages++
      index++
      continue
    }

    if (message.role !== 'assistant' || !message.tool_calls?.length) {
      sanitized.push(message)
      index++
      continue
    }

    const expectedIds = new Set(
      message.tool_calls
        .map(toolCall => String(toolCall.id || '').trim())
        .filter(Boolean)
    )
    if (!expectedIds.size) {
      const stripped = { ...message }
      delete stripped.tool_calls
      const hasContent = typeof stripped.content === 'string' && stripped.content.trim().length > 0
      const hasReasoning = typeof stripped.reasoning_content === 'string' && stripped.reasoning_content.trim().length > 0
      if (hasContent || hasReasoning) sanitized.push(stripped)
      strippedAssistantToolCalls++
      index++
      continue
    }

    const matchedToolMessages: ChatMessage[] = []
    const matchedIds = new Set<string>()
    let cursor = index + 1
    while (cursor < messages.length && messages[cursor].role === 'tool') {
      const toolMessage = messages[cursor]
      const toolCallId = String(toolMessage.tool_call_id || '').trim()
      if (!expectedIds.has(toolCallId)) break
      matchedIds.add(toolCallId)
      matchedToolMessages.push(toolMessage)
      cursor++
    }

    if (matchedIds.size === expectedIds.size) {
      sanitized.push(message)
      sanitized.push(...matchedToolMessages)
    } else {
      const stripped = { ...message }
      delete stripped.tool_calls
      const hasContent = typeof stripped.content === 'string' && stripped.content.trim().length > 0
      const hasReasoning = typeof stripped.reasoning_content === 'string' && stripped.reasoning_content.trim().length > 0
      if (hasContent || hasReasoning) sanitized.push(stripped)
      strippedAssistantToolCalls++
      droppedOrphanToolMessages += matchedToolMessages.length
    }

    index = cursor
  }

  return {
    messages: sanitized,
    strippedAssistantToolCalls,
    droppedOrphanToolMessages,
  }
}

/**
 * Compresses messages to fit within the available context budget.
 *
 * Strategy:
 * 1. Always preserve the system message (first message if role=system)
 * 2. Always preserve the last user message (the current request)
 * 3. If still over budget, summarize older messages from oldest to newest
 *    until the total fits within the budget.
 *
 * @param messages - The full message array
 * @param budget - The available context budget in tokens
 * @param threshold - Start compressing when usage exceeds this fraction (0-1) of budget
 */
export function compressMessages(
  messages: ChatMessage[],
  budget: ContextBudget,
  threshold: number = 0.6
): CompressionResult {
  const totalTokens = estimateMessagesTokens(messages)

  if (totalTokens <= budget.available * threshold) {
    return { messages, compressedCount: 0, savedTokens: 0 }
  }

  // Separate system message, middle messages, and last user message
  const hasSystem = messages.length > 0 && messages[0].role === 'system'
  const systemMsg = hasSystem ? messages[0] : null
  const rest = hasSystem ? messages.slice(1) : [...messages]

  // Find the last user message to always preserve it
  let lastUserIdx = -1
  for (let i = rest.length - 1; i >= 0; i--) {
    if (rest[i].role === 'user') {
      lastUserIdx = i
      break
    }
  }

  const preserveEnd = lastUserIdx >= 0 ? rest.slice(lastUserIdx) : [rest[rest.length - 1]]
  const candidates = lastUserIdx >= 0 ? rest.slice(0, lastUserIdx) : rest.slice(0, -1)

  if (candidates.length === 0) {
    // Nothing to compress
    return { messages, compressedCount: 0, savedTokens: 0 }
  }

  // Compress from oldest to newest until we fit
  let compressCount = 0
  let currentTokens = totalTokens

  for (let i = 0; i < candidates.length; i++) {
    if (currentTokens <= budget.available * threshold) break
    compressCount++
    const removedTokens = estimateMessagesTokens(candidates.slice(i, i + 1))
    // The summary will be shorter, estimate ~30% of original
    const summaryTokens = Math.ceil(removedTokens * 0.3)
    currentTokens = currentTokens - removedTokens + summaryTokens
  }

  if (compressCount === 0) {
    return { messages, compressedCount: 0, savedTokens: 0 }
  }

  const toCompress = candidates.slice(0, compressCount)
  const remaining = candidates.slice(compressCount)
  const summary = summarizeMessages(toCompress)

  const result: ChatMessage[] = [
    ...(systemMsg ? [systemMsg] : []),
    { role: 'user' as const, content: summary },
    ...remaining,
    ...preserveEnd,
  ]

  const newTokens = estimateMessagesTokens(result)
  const savedTokens = totalTokens - newTokens

  return {
    messages: result,
    compressedCount: compressCount,
    savedTokens,
  }
}

export function fitMessagesToContextSmart(
  messages: ChatMessage[],
  contextTokens: number | null | undefined,
  maxOutputTokens: number,
  options: SmartCompressionOptions = {}
): { messages: ChatMessage[]; compressed: boolean; details: SmartCompressionResult } {
  const emptyDetails: SmartCompressionResult = {
    messages,
    compressedCount: 0,
    savedTokens: 0,
    originalTokens: estimateMessagesTokens(messages),
    newTokens: estimateMessagesTokens(messages),
    compressedGroups: 0,
  }

  if (!contextTokens || contextTokens <= 0) {
    return { messages, compressed: false, details: emptyDetails }
  }

  const threshold = options.threshold ?? 0.6
  const preserveRecentGroups = options.preserveRecentGroups ?? 4
  const budget = calculateBudget(contextTokens, maxOutputTokens)
  const totalTokens = emptyDetails.originalTokens

  if (totalTokens <= budget.available * threshold) {
    return { messages, compressed: false, details: emptyDetails }
  }

  const groups = groupMessagesForChatCompletions(messages)
  const protectedIndexes = new Set<number>()

  if (groups[0]?.kind === 'system') {
    protectedIndexes.add(0)
  }

  const recentStart = Math.max(0, groups.length - preserveRecentGroups)
  for (let index = recentStart; index < groups.length; index++) {
    protectedIndexes.add(index)
  }

  for (let index = groups.length - 1; index >= 0; index--) {
    if (groups[index].messages.some(message => message.role === 'user')) {
      protectedIndexes.add(index)
      break
    }
  }

  groups.forEach((group, index) => {
    if (!group.compressible) protectedIndexes.add(index)
  })

  let compressThrough = -1
  let bestMessages = messages
  let bestTokens = totalTokens

  for (let index = 0; index < groups.length; index++) {
    if (protectedIndexes.has(index)) continue
    compressThrough = index
    const compressed = buildSmartCompressedMessages(groups, protectedIndexes, compressThrough)
    const compressedTokens = estimateMessagesTokens(compressed)
    bestMessages = compressed
    bestTokens = compressedTokens
    if (compressedTokens <= budget.available * threshold) break
  }

  if (compressThrough < 0) {
    return { messages, compressed: false, details: emptyDetails }
  }

  const compressedGroups = groups.filter((_, index) => index <= compressThrough && !protectedIndexes.has(index)).length
  const compressedMessageCount = groups
    .filter((_, index) => index <= compressThrough && !protectedIndexes.has(index))
    .reduce((sum, group) => sum + group.messages.length, 0)
  const details: SmartCompressionResult = {
    messages: bestMessages,
    compressedCount: compressedMessageCount,
    savedTokens: totalTokens - bestTokens,
    originalTokens: totalTokens,
    newTokens: bestTokens,
    compressedGroups,
  }

  return {
    messages: bestMessages,
    compressed: compressedGroups > 0,
    details,
  }
}

function buildSmartCompressedMessages(groups: MessageGroup[], protectedIndexes: Set<number>, compressThrough: number): ChatMessage[] {
  const compressedGroups: MessageGroup[] = []
  const resultGroups: MessageGroup[] = []

  groups.forEach((group, index) => {
    if (index <= compressThrough && !protectedIndexes.has(index)) {
      compressedGroups.push(group)
      return
    }
    resultGroups.push(group)
  })

  if (compressedGroups.length === 0) {
    return flattenGroups(resultGroups)
  }

  const systemGroup = resultGroups[0]?.kind === 'system' ? resultGroups.shift() : null
  const messagesToSummarize = flattenGroups(compressedGroups)
  const summaryMessage: ChatMessage = {
    role: 'user',
    content: summarizeMessages(messagesToSummarize),
  }

  return [
    ...(systemGroup ? systemGroup.messages : []),
    summaryMessage,
    ...flattenGroups(resultGroups),
  ]
}

/**
 * High-level helper: given messages and a model's context limit,
 * returns a compressed message array that fits within budget.
 */
export function fitToContext(
  messages: ChatMessage[],
  contextTokens: number | null | undefined,
  maxOutputTokens: number,
  threshold: number = 0.6
): { messages: ChatMessage[]; compressed: boolean; details: CompressionResult } {
  if (!contextTokens || contextTokens <= 0) {
    // No context limit known — pass through as-is
    return {
      messages,
      compressed: false,
      details: { messages, compressedCount: 0, savedTokens: 0 },
    }
  }

  const budget = calculateBudget(contextTokens, maxOutputTokens)
  const result = compressMessages(messages, budget, threshold)

  return {
    messages: result.messages,
    compressed: result.compressedCount > 0,
    details: result,
  }
}
