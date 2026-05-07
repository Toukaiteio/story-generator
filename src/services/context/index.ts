import type { ChatMessage } from '@/types/provider'

/** Approximate tokens per character for mixed CJK/English content. */
const CHARS_PER_TOKEN_EN = 4
const CHARS_PER_TOKEN_CJK = 1.5

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

/**
 * Estimates total tokens for an array of chat messages.
 */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
  // Each message has ~4 tokens of overhead (role, formatting)
  const overhead = messages.length * 4
  const content = messages.reduce((sum, m) => sum + estimateTokens(m.content || ''), 0)
  return overhead + content
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

/**
 * Summarizes a set of messages into a single condensed message.
 * Extracts key information from each message and merges them.
 */
function summarizeMessages(messages: ChatMessage[]): string {
  const parts: string[] = []
  for (const msg of messages) {
    const role = msg.role === 'system' ? 'System' : msg.role === 'user' ? 'User' : msg.role === 'tool' ? 'Tool' : 'Assistant'
    const content = msg.content || ''
    // Take first 500 chars of each message as a summary
    const snippet = content.length > 500
      ? content.slice(0, 500) + '...'
      : content
    parts.push(`[${role}]: ${snippet}`)
  }
  return `[Context compressed — ${messages.length} earlier messages summarized]\n\n${parts.join('\n\n')}`
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
  threshold: number = 0.85
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

/**
 * High-level helper: given messages and a model's context limit,
 * returns a compressed message array that fits within budget.
 */
export function fitToContext(
  messages: ChatMessage[],
  contextTokens: number | null | undefined,
  maxOutputTokens: number,
  threshold: number = 0.85
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
