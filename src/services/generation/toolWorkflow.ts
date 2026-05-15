import { fitMessagesToContextSmart } from '@/services/context'
import { providerManager } from '@/services/provider'
import { handleRelationshipQueryTool } from '@/services/relationship/tools'
import type { ToolCall, ToolDefinition } from '@/services/provider'
import type { FunctionCallingResponse } from '@/services/provider/types'
import type { ChatMessage, ProviderModelRef } from '@/types/provider'
import type { StoryProject } from '@/types/project'

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
  const allToolCalls: ToolCall[] = []
  const softRoundLimit = options.maxRounds
  const hardRoundLimit = Math.max(softRoundLimit * 4, softRoundLimit + 24)
  const maxConsecutiveNoToolRounds = 6
  const finalToolNames = new Set(options.finalToolNames)

  let round = 0
  let totalRounds = 0
  let consecutiveNoToolRounds = 0
  let softLimitReached = false
  while (true) {
    const forcedFinalTool = options.finalToolNames.length && consecutiveNoToolRounds >= 2
      ? options.finalToolNames[0]
      : null

    if (!softLimitReached && totalRounds >= softRoundLimit - 1) {
      softLimitReached = true
      currentMessages.push({
        role: 'user',
        content: `Checkpoint: this tool workflow has used ${totalRounds + 1} rounds. Continue only if the next tool call materially advances the task. If no more lookup is needed, call one of these final reporting tools now: ${options.finalToolNames.join(', ')}. If no issues are found, call the final reporting tool with {"issues": []}. Do not answer in text.`,
      })
    }

    const outboundMessages = fitMessagesToContextSmart(
      currentMessages,
      options.contextTokens,
      options.maxTokens ?? 4096,
      { threshold: 0.6, preserveRecentGroups: 4 }
    ).messages

    const response = await providerManager.chatWithTools(
      outboundMessages,
      modelRef,
      tools,
      options.maxTokens ?? 4096,
      options.temperature ?? 0.2,
      forcedFinalTool
        ? { toolChoice: { type: 'function', function: { name: forcedFinalTool } } }
        : undefined,
      options.signal
    )

    allToolCalls.push(...response.tool_calls)
    if (!response.tool_calls.length) {
      consecutiveNoToolRounds += 1
      if (response.content?.trim()) {
        currentMessages.push({
          role: 'assistant',
          content: response.content,
        })
      }
      currentMessages.push({
        role: 'user',
        content: consecutiveNoToolRounds >= 2
          ? `Your previous response still did not call a required final tool. The next request will force the tool choice where supported. Call ${options.finalToolNames[0]} now and put the result in its arguments.`
          : `Your previous response was invalid because it did not call a required final tool. Do not answer in text. Call one of these tools now: ${options.finalToolNames.join(', ')}. If there are no issues or no results, call the tool with an empty result array.`,
      })
      round += 1
      totalRounds += 1
      if (consecutiveNoToolRounds >= maxConsecutiveNoToolRounds) {
        throw new Error(`Assistant tool workflow stalled: the model did not call ${options.finalToolNames.join(' or ')} after ${consecutiveNoToolRounds} consecutive correction attempts.`)
      }

      if (totalRounds >= hardRoundLimit) {
        const shouldContinue = await options.requestContinuation({
          workflow: options.finalToolNames.join(' / '),
          rounds: totalRounds,
          finalToolNames: options.finalToolNames,
        })

        if (!shouldContinue) {
          throw new Error(`Assistant tool workflow stopped after ${totalRounds} rounds before calling ${options.finalToolNames.join(' or ')}.`)
        }

        round = 0
        totalRounds = 0
        softLimitReached = false
      }
      continue
    }

    consecutiveNoToolRounds = 0
    const finalToolCall = response.tool_calls.find(toolCall => finalToolNames.has(toolCall.name))
    if (finalToolCall) {
      currentMessages.push({
        role: 'assistant',
        content: null,
        reasoning_content: response.reasoning_content ?? null,
        tool_calls: response.tool_calls.map(toolCall => ({
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
          },
        })),
      })
      for (const toolCall of response.tool_calls) {
        currentMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: options.finalToolResultContent?.(toolCall) ?? JSON.stringify({ ok: true, tool: toolCall.name }),
        })
      }
      return { ...response, tool_calls: allToolCalls }
    }

    currentMessages.push({
      role: 'assistant',
      content: response.content || null,
      reasoning_content: response.reasoning_content ?? null,
      tool_calls: response.tool_calls.map(toolCall => ({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.arguments),
        },
      })),
    })

    for (const toolCall of response.tool_calls) {
      const relationshipResult = options.project
        ? await handleRelationshipQueryTool(toolCall, options.project)
        : null
      currentMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: relationshipResult?.content ?? JSON.stringify({ error: `Unsupported tool: ${toolCall.name}` }),
      })
    }

    round += 1
    totalRounds += 1
    if (totalRounds >= hardRoundLimit) {
      const shouldContinue = await options.requestContinuation({
        workflow: options.finalToolNames.join(' / '),
        rounds: totalRounds,
        finalToolNames: options.finalToolNames,
      })

      if (!shouldContinue) {
        throw new Error(`Assistant tool workflow stopped after ${totalRounds} rounds before calling ${options.finalToolNames.join(' or ')}.`)
      }

      round = 0
      totalRounds = 0
      softLimitReached = false
      currentMessages.push({
        role: 'user',
        content: `Continue the tool workflow. Tool round counter has been reset. Prefer reporting with ${options.finalToolNames.join(' or ')} as soon as you have enough information; only use more lookup tools if necessary.`,
      })
    }
  }
}
