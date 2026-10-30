import { injectCustomSystemPrompt } from '@/services/systemPrompt'
import type { ChatMessage, ProviderModelRef } from '@/types/provider'
import type { ToolCall, ToolDefinition, ToolResult } from '@/services/provider/tools'
import { runPiAgent, type PiToolStatus } from './piRuntime'

export interface LoopCallbacks {
  onToken?: (token: string) => void
  onReasoningToken?: (token: string) => void
  onToolStatus?: (status: PiToolStatus) => void
}

export interface AgentLoopRequest {
  modelRef: ProviderModelRef
  /**
   * Stable run prefix: the system directive plus immutable project context
   * blocks. Built once per run and never rewritten, so provider prompt caches
   * hit across rounds and identical runs share the same prefix.
   */
  system: string
  contextBlocks?: string[]
  /** Prior conversation turns, appended verbatim before the new prompt. */
  history?: ChatMessage[]
  prompt: string
  tools?: ToolDefinition[]
  executeTool?: (toolCall: ToolCall) => Promise<ToolResult>
  maxTokens?: number
  temperature?: number
  maxRounds?: number
  signal?: AbortSignal
  contextTokens?: number | null
}

export interface AgentLoopResult {
  content: string
  messages: ChatMessage[]
}

/**
 * The shared agent loop. Every interactive AI flow goes through here so context
 * assembly, message ordering, and tool handling stay uniform.
 */
export async function runAgentLoop(
  request: AgentLoopRequest,
  callbacks: LoopCallbacks = {},
): Promise<AgentLoopResult> {
  const context = request.contextBlocks?.filter(Boolean).join('\n\n') ?? ''
  const system = injectCustomSystemPrompt(context ? `${request.system}\n\n${context}` : request.system)

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    ...(request.history ?? []),
    { role: 'user', content: request.prompt },
  ]

  const result = await runPiAgent({
    modelRef: request.modelRef,
    messages,
    tools: request.tools,
    maxTokens: request.maxTokens ?? 4096,
    temperature: request.temperature ?? 0.7,
    contextTokens: request.contextTokens ?? undefined,
    signal: request.signal,
    executeTool: request.executeTool,
    onToken: token => callbacks.onToken?.(token),
    onReasoningToken: token => callbacks.onReasoningToken?.(token),
    onToolStatus: status => callbacks.onToolStatus?.(status),
    streamAssistantText: Boolean(callbacks.onToken),
    maxRounds: request.maxRounds ?? 4,
    workflowName: 'Agent loop',
  })

  return { content: result.content, messages: result.messages }
}

/** Single-shot loop variant for structured JSON answers. */
export async function runStructuredLoop(
  request: Omit<AgentLoopRequest, 'tools' | 'executeTool'>,
): Promise<Record<string, any>> {
  const { content } = await runAgentLoop(request)
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error('The model response did not contain a JSON object.')
  }
  return JSON.parse(content.slice(start, end + 1))
}
