import type {
  AgentMessage,
  AgentToolCall,
} from '@mariozechner/pi-agent-core'
import type {
  AssistantMessage,
  Message,
  ToolResultMessage,
} from '@mariozechner/pi-ai'
import { estimateTokens } from '@/services/context'

export interface PiContextTransformOptions {
  contextTokens: number | null | undefined
  maxOutputTokens: number
  toolCount?: number
  threshold?: number
  preserveRecentGroups?: number
}

export interface PiContextTransformReport {
  compressed: boolean
  compressedGroups: number
  originalTokens: number
  newTokens: number
  savedTokens: number
}

interface MessageGroup {
  messages: AgentMessage[]
  tokenEstimate: number
  compressible: boolean
}

const MESSAGE_OVERHEAD_TOKENS = 8
const TOOL_OVERHEAD_TOKENS = 18
const DEFAULT_CONTEXT_WINDOW = 128_000

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return message.role === 'assistant'
}

function isToolResultMessage(message: AgentMessage): message is ToolResultMessage {
  return message.role === 'toolResult'
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content.map((block: any) => {
    if (block?.type === 'text') return String(block.text ?? '')
    if (block?.type === 'thinking') return `[Thinking] ${String(block.thinking ?? '')}`
    if (block?.type === 'toolCall') {
      return `[Tool call ${String(block.name ?? 'unknown')}]: ${JSON.stringify(block.arguments ?? {})}`
    }
    if (block?.type === 'image') return '[Image attachment]'
    return ''
  }).filter(Boolean).join('\n')
}

function estimatePiMessageTokens(message: AgentMessage): number {
  const contentTokens = estimateTokens(contentToText((message as any).content))
  if (message.role === 'toolResult') {
    return MESSAGE_OVERHEAD_TOKENS + TOOL_OVERHEAD_TOKENS + contentTokens + estimateTokens(message.toolCallId)
  }
  if (message.role === 'assistant') {
    return MESSAGE_OVERHEAD_TOKENS + contentTokens + estimateTokens(message.model) + estimateTokens(message.provider)
  }
  return MESSAGE_OVERHEAD_TOKENS + contentTokens
}

function estimatePiMessagesTokens(messages: AgentMessage[]): number {
  return messages.reduce((total, message) => total + estimatePiMessageTokens(message), 0)
}

function previewText(value: string, limit = 420): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized
}

function summarizeGroup(group: AgentMessage[]): string {
  const parts: string[] = []
  for (const message of group) {
    if (isAssistantMessage(message)) {
      const toolCalls = message.content.filter((block): block is AgentToolCall => block.type === 'toolCall')
      const text = previewText(contentToText(message.content.filter((block: any) => block.type !== 'toolCall')))
      if (text) parts.push(`[Assistant]: ${text}`)
      for (const toolCall of toolCalls) {
        parts.push(`[Tool call ${toolCall.name}]: ${previewText(JSON.stringify(toolCall.arguments ?? {}), 260)}`)
      }
      continue
    }

    if (isToolResultMessage(message)) {
      parts.push(`[Tool result ${message.toolName || 'unknown'}]: ${previewText(contentToText(message.content), 360)}`)
      continue
    }

    const text = previewText(contentToText((message as any).content))
    if (text) parts.push(`[User]: ${text}`)
  }
  return parts.join('\n')
}

function summarizeGroups(groups: MessageGroup[]): AgentMessage {
  const message = groups.flatMap(group => group.messages)
  const summary = groups
    .map(group => summarizeGroup(group.messages))
    .filter(Boolean)
    .join('\n\n')

  return {
    role: 'user',
    content: `[Pi context summary — ${message.length} earlier messages condensed]\n\n${summary || 'Earlier workflow context was condensed.'}`,
    timestamp: Date.now(),
  }
}

function getToolCallIds(message: AssistantMessage): Set<string> {
  return new Set(
    message.content
      .filter((block): block is AgentToolCall => block.type === 'toolCall')
      .map(block => block.id)
      .filter(Boolean)
  )
}

function groupMessages(messages: AgentMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  let index = 0

  while (index < messages.length) {
    const message = messages[index]
    if (isAssistantMessage(message)) {
      const toolCallIds = getToolCallIds(message)
      if (toolCallIds.size > 0) {
        const groupMessages: AgentMessage[] = [message]
        const matchedToolCallIds = new Set<string>()
        let cursor = index + 1
        while (cursor < messages.length && isToolResultMessage(messages[cursor])) {
          const toolResult = messages[cursor] as ToolResultMessage
          if (!toolCallIds.has(toolResult.toolCallId)) break
          groupMessages.push(toolResult)
          matchedToolCallIds.add(toolResult.toolCallId)
          cursor++
        }

        groups.push({
          messages: groupMessages,
          tokenEstimate: estimatePiMessagesTokens(groupMessages),
          // Incomplete tool rounds are kept intact until a later turn completes them.
          compressible: matchedToolCallIds.size === toolCallIds.size,
        })
        index = cursor
        continue
      }
    }

    if (isToolResultMessage(message)) {
      // The runtime normally never creates an orphan. Keeping it protected here
      // prevents a malformed external transcript from being made worse by a summary.
      groups.push({
        messages: [message],
        tokenEstimate: estimatePiMessageTokens(message),
        compressible: false,
      })
      index++
      continue
    }

    groups.push({
      messages: [message],
      tokenEstimate: estimatePiMessageTokens(message),
      compressible: true,
    })
    index++
  }

  return groups
}

function flattenGroups(groups: MessageGroup[]): AgentMessage[] {
  return groups.flatMap(group => group.messages)
}

function sanitizeToolContinuity(messages: AgentMessage[]): AgentMessage[] {
  const sanitized: AgentMessage[] = []
  let expectedToolIds = new Set<string>()
  let pendingToolIds = new Set<string>()

  for (const message of messages) {
    if (isToolResultMessage(message)) {
      if (!expectedToolIds.has(message.toolCallId) || pendingToolIds.has(message.toolCallId)) continue
      pendingToolIds.add(message.toolCallId)
      sanitized.push(message)
      continue
    }

    if (isAssistantMessage(message)) {
      expectedToolIds = getToolCallIds(message)
      pendingToolIds = new Set<string>()
    } else {
      expectedToolIds = new Set<string>()
      pendingToolIds = new Set<string>()
    }
    sanitized.push(message)
  }

  return sanitized
}

function truncateOldContent(messages: AgentMessage[], maxTokens: number): AgentMessage[] {
  let currentTokens = estimatePiMessagesTokens(messages)
  if (currentTokens <= maxTokens) return messages

  const next = messages.map(message => ({ ...message })) as AgentMessage[]
  const protectedIndexes = new Set<number>([
    Math.max(0, next.length - 1),
    Math.max(0, next.length - 2),
  ])

  for (let index = 0; index < next.length && currentTokens > maxTokens; index++) {
    if (protectedIndexes.has(index)) continue
    const message: any = next[index]
    if (message.role === 'assistant' && Array.isArray(message.content) && message.content.some((block: any) => block.type === 'toolCall')) {
      continue
    }
    const source = contentToText(message.content)
    if (!source || source.length < 120) continue

    const targetTokens = Math.max(80, maxTokens - (currentTokens - estimatePiMessageTokens(message)) - 16)
    const keepChars = Math.max(160, Math.floor(source.length * Math.min(1, targetTokens / Math.max(1, estimateTokens(source)))))
    const shortened = `${source.slice(0, keepChars).trimEnd()}\n[Older content truncated by Pi context manager.]`
    if (message.role === 'assistant') {
      const textBlock = message.content.find((block: any) => block.type === 'text')
      message.content = textBlock ? [{ ...textBlock, text: shortened }] : [{ type: 'text', text: shortened }]
    } else {
      message.content = shortened
    }
    currentTokens = estimatePiMessagesTokens(next)
  }

  return sanitizeToolContinuity(next)
}

export function createPiContextTransformer(options: PiContextTransformOptions): {
  transform: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>
  getReport: () => PiContextTransformReport
} {
  let report: PiContextTransformReport = {
    compressed: false,
    compressedGroups: 0,
    originalTokens: 0,
    newTokens: 0,
    savedTokens: 0,
  }

  const transform = async (messages: AgentMessage[]) => {
    const safeMessages = sanitizeToolContinuity(messages)
    const originalTokens = estimatePiMessagesTokens(safeMessages)
    const contextWindow = options.contextTokens && options.contextTokens > 0
      ? options.contextTokens
      : DEFAULT_CONTEXT_WINDOW
    const reservedOutput = Math.min(options.maxOutputTokens, Math.floor(contextWindow * 0.35))
    const toolSchemaReserve = Math.min(4096, Math.max(0, (options.toolCount ?? 0) * 180))
    const availableTokens = Math.max(1024, contextWindow - reservedOutput - toolSchemaReserve)
    const threshold = options.threshold ?? 0.62
    const targetTokens = Math.floor(availableTokens * threshold)

    if (originalTokens <= targetTokens) {
      report = {
        compressed: false,
        compressedGroups: 0,
        originalTokens,
        newTokens: originalTokens,
        savedTokens: 0,
      }
      return safeMessages
    }

    const groups = groupMessages(safeMessages)
    const preserveRecentGroups = options.preserveRecentGroups ?? 6
    const protectedIndexes = new Set<number>()
    const recentStart = Math.max(0, groups.length - preserveRecentGroups)
    for (let index = recentStart; index < groups.length; index++) protectedIndexes.add(index)
    for (let index = groups.length - 1; index >= 0; index--) {
      if (groups[index].messages.some(message => message.role === 'user')) {
        protectedIndexes.add(index)
        break
      }
    }
    groups.forEach((group, index) => {
      if (!group.compressible) protectedIndexes.add(index)
    })

    const compressedGroups: MessageGroup[] = []
    const remainingGroups: MessageGroup[] = []
    let projectedTokens = originalTokens
    for (let index = 0; index < groups.length; index++) {
      const group = groups[index]
      if (projectedTokens > targetTokens && !protectedIndexes.has(index) && group.compressible) {
        compressedGroups.push(group)
        projectedTokens -= group.tokenEstimate
        continue
      }
      remainingGroups.push(group)
    }

    let fitted = compressedGroups.length > 0
      ? [summarizeGroups(compressedGroups), ...flattenGroups(remainingGroups)]
      : safeMessages
    fitted = sanitizeToolContinuity(fitted)
    const fittedBeforeHardLimit = estimatePiMessagesTokens(fitted)
    if (fittedBeforeHardLimit > availableTokens) {
      fitted = truncateOldContent(fitted, availableTokens)
    }
    const newTokens = estimatePiMessagesTokens(fitted)
    report = {
      compressed: compressedGroups.length > 0 || newTokens < originalTokens,
      compressedGroups: compressedGroups.length,
      originalTokens,
      newTokens,
      savedTokens: Math.max(0, originalTokens - newTokens),
    }
    return fitted
  }

  return {
    transform,
    getReport: () => report,
  }
}
