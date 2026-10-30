import { handleRelationshipQueryTool } from '@/services/relationship/tools'
import type { ToolCall, ToolDefinition } from '@/services/provider'
import type { FunctionCallingResponse } from '@/services/provider/types'
import type { ChatMessage, ProviderModelRef } from '@/types/provider'
import type { StoryProject } from '@/types/project'
import { runPiAgent } from '@/services/agent/piRuntime'

export interface ToolWorkflowContinuationRequest {
  workflow: string
  rounds: number
  finalToolNames: string[]
}

export interface RelationshipToolWorkflowOptions {
  project?: StoryProject | null
  finalToolNames: string[]
  maxTokens?: number
  temperature?: number
  maxRounds: number
  contextTokens?: number | null
  signal?: AbortSignal
  finalToolResultContent?: (toolCall: ToolCall) => string
  requestContinuation: (request: ToolWorkflowContinuationRequest) => Promise<boolean>
}

export function getToolCall(toolCalls: ToolCall[], name: string) {
  return toolCalls.find(toolCall => toolCall.name === name) ?? null
}

export async function chatWithRelationshipTools(
  messages: ChatMessage[],
  modelRef: ProviderModelRef,
  tools: ToolDefinition[],
  options: RelationshipToolWorkflowOptions
) {
  return chatWithRelationshipToolsInPlace([...messages], modelRef, tools, options)
}

export async function chatWithRelationshipToolsInPlace(
  currentMessages: ChatMessage[],
  modelRef: ProviderModelRef,
  tools: ToolDefinition[],
  options: RelationshipToolWorkflowOptions
): Promise<FunctionCallingResponse> {
  const finalToolNames = new Set(options.finalToolNames)
  const result = await runPiAgent({
    modelRef,
    messages: currentMessages,
    tools,
    maxTokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.2,
    contextTokens: options.contextTokens,
    signal: options.signal,
    finalToolNames: options.finalToolNames,
    maxRounds: options.maxRounds,
    workflowName: options.finalToolNames.join(' / ') || 'Assistant tool workflow',
    requestContinuation: options.requestContinuation,
    executeTool: async toolCall => {
      if (finalToolNames.has(toolCall.name)) {
        return {
          tool_call_id: toolCall.id,
          content: options.finalToolResultContent?.(toolCall) ?? JSON.stringify({ ok: true, tool: toolCall.name }),
        }
      }

      const relationshipResult = options.project
        ? await handleRelationshipQueryTool(toolCall, options.project)
        : null
      return {
        tool_call_id: toolCall.id,
        content: relationshipResult?.content ?? JSON.stringify({ error: `Unsupported tool: ${toolCall.name}` }),
      }
    },
  })

  const assistant = result.assistantMessage
  const reasoning = assistant?.content
    .filter((block: any) => block.type === 'thinking')
    .map((block: any) => String(block.thinking ?? ''))
    .join('') || null
  const content = assistant?.content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => String(block.text ?? ''))
    .join('') || null

  return {
    content,
    reasoning_content: reasoning,
    tool_calls: result.toolCalls,
    finish_reason: result.toolCalls.length ? 'tool_calls' : 'stop',
  }
}
