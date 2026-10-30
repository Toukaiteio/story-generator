import { Agent } from '@mariozechner/pi-agent-core'
import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  AgentToolCall,
} from '@mariozechner/pi-agent-core'
import {
  createAssistantMessageEventStream,
} from '@mariozechner/pi-ai'
import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Context as PiContext,
  Message as PiMessage,
  Model,
  SimpleStreamOptions,
  ToolCall as PiToolCall,
} from '@mariozechner/pi-ai'
import type { ProviderModelRef, ChatMessage } from '@/types/provider'
import type { ToolCall, ToolDefinition, ToolResult } from '@/services/provider/tools'
import type { FunctionCallingResponse } from '@/services/provider/types'
import { providerManager } from '@/services/provider'
import { createPiContextTransformer, type PiContextTransformReport } from './piContext'

export interface PiToolStatus {
  callId: string
  name: string
  args?: Record<string, any>
  status: 'running' | 'success' | 'error'
  detail?: string
  result?: ToolResult
}

export interface PiAgentRunOptions {
  modelRef: ProviderModelRef
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  maxTokens: number
  temperature: number
  contextTokens?: number | null
  signal?: AbortSignal
  executeTool?: (toolCall: ToolCall, signal?: AbortSignal) => Promise<ToolResult>
  onToken?: (token: string) => void
  onReasoningToken?: (token: string) => void
  onToolStatus?: (status: PiToolStatus) => void
  streamAssistantText?: boolean | (() => boolean)
  forceToolName?: () => string | null
  finalToolNames?: string[] | (() => string[])
  stopAfterToolCallRound?: () => boolean | Promise<boolean>
  getToolResultContent?: () => string | null
  workflowName?: string
  maxRounds?: number
  requestContinuation?: (request: {
    workflow: string
    rounds: number
    finalToolNames: string[]
  }) => Promise<boolean>
  onTurnEnd?: (turn: {
    message: AgentMessage
    toolCalls: ToolCall[]
    round: number
  }) => Promise<{ steer?: string; followUp?: string } | void> | { steer?: string; followUp?: string } | void
  preserveRecentGroups?: number
}

export interface PiAgentRunResult {
  content: string
  toolCalls: ToolCall[]
  messages: ChatMessage[]
  compression: PiContextTransformReport
  assistantMessage: AssistantMessage | null
}

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((block: any) => {
    if (block?.type === 'text') return String(block.text ?? '')
    if (block?.type === 'thinking') return String(block.thinking ?? '')
    if (block?.type === 'image') return '[Image attachment]'
    return ''
  }).filter(Boolean).join('')
}

function parseToolArguments(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function chatMessagesToPi(messages: ChatMessage[]): { systemPrompt: string; messages: PiMessage[] } {
  const systemMessages = messages.filter(message => message.role === 'system')
  const systemPrompt = systemMessages.map(message => message.content ?? '').filter(Boolean).join('\n\n')
  const toolNames = new Map<string, string>()
  let timestamp = Date.now() - messages.length

  const converted: PiMessage[] = []
  for (const message of messages) {
    const messageTimestamp = timestamp++
    if (message.role === 'system') continue

    if (message.role === 'user') {
      converted.push({
        role: 'user',
        content: message.content ?? '',
        timestamp: messageTimestamp,
      })
      continue
    }

    if (message.role === 'assistant') {
      const content: any[] = []
      if (message.reasoning_content?.trim()) {
        content.push({ type: 'thinking', thinking: message.reasoning_content })
      }
      if (message.content?.trim()) {
        content.push({ type: 'text', text: message.content })
      }
      for (const toolCall of message.tool_calls ?? []) {
        const id = toolCall.id || `tool-call-${messageTimestamp}-${content.length}`
        const name = toolCall.function?.name || 'unknown'
        toolNames.set(id, name)
        content.push({
          type: 'toolCall',
          id,
          name,
          arguments: parseToolArguments(toolCall.function?.arguments),
        })
      }
      converted.push({
        role: 'assistant',
        content,
        api: 'openai-completions',
        provider: 'story-generator',
        model: 'transcript',
        usage: EMPTY_USAGE,
        stopReason: message.tool_calls?.length ? 'toolUse' : 'stop',
        timestamp: messageTimestamp,
      })
      continue
    }

    converted.push({
      role: 'toolResult',
      toolCallId: message.tool_call_id || `tool-call-${messageTimestamp}`,
      toolName: toolNames.get(message.tool_call_id || '') || 'unknown',
      content: [{ type: 'text', text: message.content ?? '' }],
      isError: false,
      timestamp: messageTimestamp,
    })
  }

  return { systemPrompt, messages: converted }
}

function piMessagesToChat(messages: PiMessage[], systemPrompt: string): ChatMessage[] {
  const result: ChatMessage[] = []
  if (systemPrompt.trim()) result.push({ role: 'system', content: systemPrompt })

  for (const message of messages) {
    if (message.role === 'user') {
      result.push({ role: 'user', content: textFromContent(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      const text = message.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => String(block.text ?? ''))
        .join('')
      const reasoning = message.content
        .filter((block: any) => block.type === 'thinking')
        .map((block: any) => String(block.thinking ?? ''))
        .join('')
      const toolCalls = message.content
        .filter((block): block is PiToolCall => block.type === 'toolCall')
        .map(toolCall => ({
          id: toolCall.id,
          type: 'function' as const,
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments ?? {}),
          },
        }))
      result.push({
        role: 'assistant',
        content: text || null,
        reasoning_content: reasoning || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      })
      continue
    }
    result.push({
      role: 'tool',
      tool_call_id: message.toolCallId,
      content: textFromContent(message.content),
    })
  }
  return result
}

function providerApi(type: string): string {
  if (type === 'anthropic') return 'anthropic-messages'
  if (type === 'google') return 'google-generative-ai'
  if (type === 'openai-responses') return 'openai-responses'
  return 'openai-completions'
}

function thinkingLevel(model: { reasoning?: { enabled?: boolean; effort?: string } }): 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' {
  if (!model.reasoning?.enabled) return 'off'
  if (model.reasoning.effort === 'max') return 'xhigh'
  if (model.reasoning.effort === 'minimal') return 'minimal'
  if (model.reasoning.effort === 'low') return 'low'
  if (model.reasoning.effort === 'medium') return 'medium'
  return 'high'
}

function createPiModel(modelRef: ProviderModelRef, maxTokens: number): Model<any> {
  const match = providerManager.getModelConfigForRef(modelRef)
  if (!match) {
    throw new Error(`No active provider found for model: ${modelRef.providerId}/${modelRef.modelId}`)
  }

  return {
    id: match.model.id,
    name: match.model.name,
    api: providerApi(match.provider.type),
    provider: match.provider.id,
    baseUrl: match.provider.baseUrl,
    reasoning: match.model.reasoning.enabled,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: match.model.contextTokens && match.model.contextTokens > 0 ? match.model.contextTokens : 128_000,
    maxTokens: maxTokens || match.model.maxTokens,
  } as Model<any>
}

function makeAssistantMessage(model: Model<any>, content: any[], stopReason: AssistantMessage['stopReason'], errorMessage?: string): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  }
}

function getFinalToolNames(options: PiAgentRunOptions): string[] {
  const names = typeof options.finalToolNames === 'function'
    ? options.finalToolNames()
    : options.finalToolNames ?? []
  return names.filter(Boolean)
}

function getAssistantToolCalls(message: AgentMessage): ToolCall[] {
  if (message.role !== 'assistant') return []
  return message.content
    .filter((block): block is AgentToolCall => block.type === 'toolCall')
    .map(block => ({ id: block.id, name: block.name, arguments: block.arguments ?? {} }))
}

function isFinalToolBatch(message: AgentMessage, finalToolNames: string[]): boolean {
  return getAssistantToolCalls(message).some(toolCall => finalToolNames.includes(toolCall.name))
}

function toolResultReportsError(result: any): boolean {
  if (result?.isError) return true
  const details = result?.details
  const rawContent = typeof details?.content === 'string'
    ? details.content
    : typeof result?.content?.[0]?.text === 'string'
      ? result.content[0].text
      : ''
  if (!rawContent.trim()) return false
  try {
    const parsed = JSON.parse(rawContent)
    return parsed?.ok === false || typeof parsed?.error === 'string'
  } catch {
    return false
  }
}

function createProviderStream(
  modelRef: ProviderModelRef,
  model: Model<any>,
  forcedToolName: () => string | null,
  options: PiAgentRunOptions,
  streamContext: PiContext,
  streamOptions?: SimpleStreamOptions,
  onForcedCallWithoutArgs?: (forcedToolName: string) => void
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream()

  void (async () => {
    let text = ''
    let reasoning = ''
    const toolCalls: ToolCall[] = []
    let textStarted = false
    let thinkingStarted = false
    const partialContent: any[] = []
    const partial = () => makeAssistantMessage(model, [...partialContent], 'stop')
    const pushText = (token: string) => {
      if (!token) return
      if (!textStarted) {
        textStarted = true
        partialContent.push({ type: 'text', text: '' })
        stream.push({ type: 'text_start', contentIndex: partialContent.length - 1, partial: partial() })
      }
      text += token
      const textBlock = partialContent.find((block: any) => block.type === 'text')
      if (textBlock) textBlock.text = text
      stream.push({
        type: 'text_delta',
        contentIndex: partialContent.findIndex((block: any) => block.type === 'text'),
        delta: token,
        partial: partial(),
      })
    }
    const pushReasoning = (token: string) => {
      if (!token) return
      if (!thinkingStarted) {
        thinkingStarted = true
        partialContent.push({ type: 'thinking', thinking: '' })
        stream.push({ type: 'thinking_start', contentIndex: partialContent.length - 1, partial: partial() })
      }
      reasoning += token
      const thinkingBlock = partialContent.find((block: any) => block.type === 'thinking')
      if (thinkingBlock) thinkingBlock.thinking = reasoning
      stream.push({
        type: 'thinking_delta',
        contentIndex: partialContent.findIndex((block: any) => block.type === 'thinking'),
        delta: token,
        partial: partial(),
      })
    }

    stream.push({ type: 'start', partial: partial() })
    try {
      const providerMessages = piMessagesToChat(streamContext.messages, streamContext.systemPrompt ?? '')
      const providerTools: ToolDefinition[] = (streamContext.tools ?? []).map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as ToolDefinition['parameters'],
      }))
      const signal = streamOptions?.signal
      let response: FunctionCallingResponse | null = null
      let streamError: Error | null = null
      const onToolCall = (toolCall: ToolCall) => {
        const existingIndex = toolCalls.findIndex(existing =>
          toolCall.id && existing.id
            ? existing.id === toolCall.id
            : !toolCall.id && !existing.id && existing.name === toolCall.name
        )
        const incomingArguments = toolCall.arguments ?? {}
        const hasIncomingArguments = Object.keys(incomingArguments).length > 0

        // DSML recovery and OpenAI-compatible relays can report the same
        // function once with an id and once without one. If either copy has no
        // arguments, merge it into the other copy instead of executing a second
        // empty call.
        const mergeEmptyArgumentDuplicate = existingIndex < 0 && toolCall.name
          ? toolCalls.findIndex(existing =>
            existing.name === toolCall.name
            && (!hasIncomingArguments || Object.keys(existing.arguments ?? {}).length === 0)
          )
          : -1
        const resolvedIndex = existingIndex >= 0 ? existingIndex : mergeEmptyArgumentDuplicate

        if (resolvedIndex >= 0) {
          const existing = toolCalls[resolvedIndex]
          const mergedToolCall = hasIncomingArguments
            ? { ...existing, ...toolCall, arguments: incomingArguments }
            : { ...existing, id: toolCall.id || existing.id, name: toolCall.name || existing.name }
          toolCalls[resolvedIndex] = mergedToolCall

          const partialIndex = partialContent.findIndex((block: any) =>
            block.type === 'toolCall'
            && (toolCall.id ? block.id === toolCall.id : block.name === toolCall.name)
          )
          if (partialIndex >= 0) {
            partialContent[partialIndex] = {
              type: 'toolCall' as const,
              id: mergedToolCall.id,
              name: mergedToolCall.name,
              arguments: mergedToolCall.arguments ?? {},
            }
          }
          return
        }

        toolCalls.push(toolCall)
        const piToolCall = {
          type: 'toolCall' as const,
          id: toolCall.id,
          name: toolCall.name,
          arguments: incomingArguments,
        }
        partialContent.push(piToolCall)
        stream.push({ type: 'toolcall_start', contentIndex: partialContent.length - 1, partial: partial() })
        stream.push({ type: 'toolcall_end', contentIndex: partialContent.length - 1, toolCall: piToolCall, partial: partial() })
      }

      if (providerTools.length > 0) {
        await providerManager.streamWithTools(
          providerMessages,
          modelRef,
          providerTools,
          {
            onToken: pushText,
            onReasoningToken: pushReasoning,
            onToolCall,
            onToolResult: () => {},
            onComplete: value => { response = value },
            onError: error => { streamError = error },
          },
          options.maxTokens,
          streamOptions?.temperature ?? options.temperature,
          forcedToolName()
            ? { toolChoice: { type: 'function', function: { name: forcedToolName()! } } }
            : undefined,
          signal
        )
      } else {
        await providerManager.stream(
          providerMessages,
          modelRef,
          {
            onToken: pushText,
            onReasoningToken: pushReasoning,
            onComplete: value => {
              response = { content: value, tool_calls: [], finish_reason: 'stop' }
            },
            onError: error => { streamError = error },
          },
          options.maxTokens,
          streamOptions?.temperature ?? options.temperature,
          signal
        )
      }

      if (streamError) throw streamError
      const completedResponse = response as FunctionCallingResponse | null
      if (!completedResponse) throw new Error('Pi provider stream completed without a response')
      if (completedResponse.reasoning_content && completedResponse.reasoning_content.length > reasoning.length) {
        pushReasoning(completedResponse.reasoning_content.slice(reasoning.length))
      }
      if (completedResponse.content && completedResponse.content.length > text.length) {
        pushText(completedResponse.content.slice(text.length))
      }
      for (const toolCall of completedResponse.tool_calls) onToolCall(toolCall)

      // Some OpenAI-compatible relays honor a forced tool_choice but drop the
      // arguments entirely. Detect that once (only for tools whose schema
      // actually requires arguments) and let the caller disable forcing so
      // later rounds ask for the tool through the turn prompt instead.
      const requestedForcedTool = forcedToolName()
      if (requestedForcedTool && onForcedCallWithoutArgs) {
        const forcedCalls = completedResponse.tool_calls.filter(toolCall => toolCall.name === requestedForcedTool)
        const forcedDefinition = options.tools?.find(tool => tool.name === requestedForcedTool)
        const forcedToolRequiresArgs = !!forcedDefinition && (forcedDefinition.parameters.required?.length ?? 0) > 0
        if (
          forcedToolRequiresArgs
          && forcedCalls.length > 0
          && forcedCalls.every(toolCall => !toolCall.arguments || Object.keys(toolCall.arguments).length === 0)
        ) {
          onForcedCallWithoutArgs(requestedForcedTool)
        }
      }

      if (textStarted) {
        stream.push({
          type: 'text_end',
          contentIndex: partialContent.findIndex((block: any) => block.type === 'text'),
          content: text,
          partial: partial(),
        })
      }
      if (thinkingStarted) {
        stream.push({
          type: 'thinking_end',
          contentIndex: partialContent.findIndex((block: any) => block.type === 'thinking'),
          content: reasoning,
          partial: partial(),
        })
      }

      const finalContent = [
        ...(reasoning ? [{ type: 'thinking', thinking: reasoning }] : []),
        ...(text ? [{ type: 'text', text }] : []),
        ...toolCalls.map(toolCall => ({
          type: 'toolCall' as const,
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments ?? {},
        })),
      ]
      const finalMessage = makeAssistantMessage(
        model,
        finalContent,
        completedResponse.finish_reason === 'length' ? 'length' : toolCalls.length ? 'toolUse' : 'stop'
      )
      stream.push({
        type: 'done',
        reason: finalMessage.stopReason === 'length' ? 'length' : toolCalls.length ? 'toolUse' : 'stop',
        message: finalMessage,
      })
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      const aborted = streamOptions?.signal?.aborted
      const finalMessage = makeAssistantMessage(
        model,
        [
          ...(reasoning ? [{ type: 'thinking', thinking: reasoning }] : []),
          ...(text ? [{ type: 'text', text }] : []),
        ],
        aborted ? 'aborted' : 'error',
        message
      )
      stream.push({
        type: 'error',
        reason: aborted ? 'aborted' : 'error',
        error: finalMessage,
      })
    }
  })()

  return stream
}

function createPiTool(
  definition: ToolDefinition,
  executeTool: (toolCall: ToolCall, signal?: AbortSignal) => Promise<ToolResult>
): AgentTool<any> {
  return {
    name: definition.name,
    label: definition.name,
    description: definition.description,
    parameters: definition.parameters as any,
    execute: async (toolCallId, params, signal) => {
      const result = await executeTool({
        id: toolCallId,
        name: definition.name,
        arguments: (params ?? {}) as Record<string, any>,
      }, signal)
      return {
        content: [{ type: 'text', text: result.content }],
        details: result,
      }
    },
  }
}

function streamAssistantText(options: PiAgentRunOptions): boolean {
  return typeof options.streamAssistantText === 'function'
    ? options.streamAssistantText()
    : options.streamAssistantText ?? true
}

export async function runPiAgent(options: PiAgentRunOptions): Promise<PiAgentRunResult> {
  const transcript = chatMessagesToPi(options.messages)
  const modelConfig = providerManager.getModelConfigForRef(options.modelRef)
  const model = createPiModel(options.modelRef, options.maxTokens)
  const contextTransformer = createPiContextTransformer({
    contextTokens: options.contextTokens ?? modelConfig?.model.contextTokens,
    maxOutputTokens: options.maxTokens,
    toolCount: options.tools?.length ?? 0,
    preserveRecentGroups: options.preserveRecentGroups,
  })
  const executeTool = options.executeTool ?? (async (toolCall) => ({
    tool_call_id: toolCall.id,
    content: JSON.stringify({ error: `Unsupported tool: ${toolCall.name}` }),
  }))
  const tools = (options.tools ?? []).map(tool => createPiTool(tool, executeTool))

  let forcedFinalTool: string | null = null
  let forcedToolChoiceDisabled = false
  let agent: Agent
  let totalRounds = 0
  let consecutiveNoToolRounds = 0
  let softLimitReached = false
  let workflowError: Error | null = null
  let latestAssistant: AssistantMessage | null = null
  const allToolCalls: ToolCall[] = []
  const maxRounds = Math.max(1, options.maxRounds ?? 16)
  const hardRoundLimit = Math.max(maxRounds * 4, maxRounds + 24)
  const finalToolWasCalled = (message: AgentMessage) => isFinalToolBatch(message, getFinalToolNames(options))

  agent = new Agent({
    initialState: {
      systemPrompt: options.messages.find(message => message.role === 'system')?.content ?? transcript.systemPrompt,
      model,
      thinkingLevel: thinkingLevel(modelConfig?.model ?? {}),
      tools,
      messages: transcript.messages,
    },
    toolExecution: 'sequential',
    streamFn: (streamModel, streamContext, streamOptions) => createProviderStream(
      options.modelRef,
      streamModel,
      () => forcedToolChoiceDisabled ? null : (options.forceToolName?.() ?? forcedFinalTool),
      options,
      streamContext,
      streamOptions,
      forcedToolName => {
        // The relay accepts the forced name but returns no arguments; stop
        // forcing so the model can populate arguments in an unforced call.
        forcedToolChoiceDisabled = true
        forcedFinalTool = null
        console.warn('[PiRuntime] forced tool_choice dropped arguments; disabling forced calls', { tool: forcedToolName, workflow: options.workflowName })
      }
    ),
    transformContext: contextTransformer.transform,
    afterToolCall: async ({ assistantMessage, toolCall, result, isError }) => {
      const finalNames = getFinalToolNames(options)
      const batchHasFinalTool = finalNames.length > 0 && assistantMessage.content
        .filter((block): block is AgentToolCall => block.type === 'toolCall')
        .some(block => finalNames.includes(block.name))
      const toolFailed = isError || toolResultReportsError(result)
      const shouldTerminate = !toolFailed && (batchHasFinalTool || await options.stopAfterToolCallRound?.())
      if (shouldTerminate) {
        return { terminate: true }
      }
      if (toolFailed) return { isError: true }
      return undefined
    },
  })

  agent.subscribe(async (event: AgentEvent) => {
    if (event.type === 'message_update') {
      if (event.assistantMessageEvent.type === 'text_delta' && streamAssistantText(options)) {
        options.onToken?.(event.assistantMessageEvent.delta)
      }
      if (event.assistantMessageEvent.type === 'thinking_delta') {
        options.onReasoningToken?.(event.assistantMessageEvent.delta)
      }
      return
    }

    if (event.type === 'tool_execution_start') {
      options.onToolStatus?.({
        callId: event.toolCallId,
        name: event.toolName,
        args: event.args,
        status: 'running',
      })
      return
    }

    if (event.type === 'tool_execution_end') {
      const details = event.result?.details as ToolResult | undefined
      const resultText = Array.isArray(event.result?.content)
        ? event.result.content
          .map((item: any) => typeof item?.text === 'string' ? item.text : '')
          .filter(Boolean)
          .join('\n')
        : ''
      options.onToolStatus?.({
        callId: event.toolCallId,
        name: event.toolName,
        status: event.isError ? 'error' : 'success',
        result: details,
        detail: details?.content || resultText,
      })
      return
    }

    if (event.type !== 'turn_end') return

    totalRounds += 1
    latestAssistant = event.message.role === 'assistant' ? event.message : latestAssistant
    const turnToolCalls = getAssistantToolCalls(event.message)
    allToolCalls.push(...turnToolCalls)

    if (turnToolCalls.length > 0) {
      consecutiveNoToolRounds = 0
      if (getFinalToolNames(options).length && finalToolWasCalled(event.message)) {
        const action = await options.onTurnEnd?.({ message: event.message, toolCalls: turnToolCalls, round: totalRounds })
        if (action?.steer) agent.steer({ role: 'user', content: action.steer, timestamp: Date.now() })
        if (action?.followUp) agent.followUp({ role: 'user', content: action.followUp, timestamp: Date.now() })
        return
      }

      if (!softLimitReached && totalRounds >= maxRounds) {
        softLimitReached = true
        agent.steer({
          role: 'user',
          content: `Checkpoint: this tool workflow has used ${totalRounds} rounds. Continue only if the next tool call materially advances the task. If enough information is available, call one of these final tools now: ${getFinalToolNames(options).join(', ') || 'the required final tool'}.`,
          timestamp: Date.now(),
        })
      }

      if (totalRounds >= hardRoundLimit) {
        const shouldContinue = await options.requestContinuation?.({
          workflow: options.workflowName ?? 'Pi Agent workflow',
          rounds: totalRounds,
          finalToolNames: getFinalToolNames(options),
        })
        if (!shouldContinue) {
          workflowError = new Error(`${options.workflowName ?? 'Pi Agent'} tool workflow stopped after ${totalRounds} rounds.`)
          agent.abort()
          return
        }
        totalRounds = 0
        softLimitReached = false
        agent.steer({
          role: 'user',
          content: 'Continue the tool workflow. The round counter has been reset; complete the task as soon as possible.',
          timestamp: Date.now(),
        })
      }
      const action = await options.onTurnEnd?.({ message: event.message, toolCalls: turnToolCalls, round: totalRounds })
      if (action?.steer) agent.steer({ role: 'user', content: action.steer, timestamp: Date.now() })
      if (action?.followUp) agent.followUp({ role: 'user', content: action.followUp, timestamp: Date.now() })
      return
    }

    consecutiveNoToolRounds += 1
    const finalNames = getFinalToolNames(options)
    if (!finalNames.length) {
      const action = await options.onTurnEnd?.({ message: event.message, toolCalls: [], round: totalRounds })
      if (action?.steer) agent.steer({ role: 'user', content: action.steer, timestamp: Date.now() })
      if (action?.followUp) agent.followUp({ role: 'user', content: action.followUp, timestamp: Date.now() })
      return
    }

    if (consecutiveNoToolRounds >= 2) forcedFinalTool = finalNames[0]
    if (consecutiveNoToolRounds >= 6) {
      workflowError = new Error(`${options.workflowName ?? 'Pi Agent'} tool workflow stalled: the model did not call ${finalNames.join(' or ')}.`)
      agent.abort()
      return
    }

    const action = await options.onTurnEnd?.({ message: event.message, toolCalls: [], round: totalRounds })
    const followUp = action?.followUp ?? (consecutiveNoToolRounds >= 2
      ? `Your previous response still did not call a required final tool. Call ${finalNames[0]} now and put the result in its arguments.`
      : `Do not answer in plain text. Call one of these final tools now: ${finalNames.join(', ')}. Fill its required arguments with your current findings or a short summary; never send empty arguments.`)
    if (action?.steer) agent.steer({ role: 'user', content: action.steer, timestamp: Date.now() })
    agent.followUp({
      role: 'user',
      content: followUp,
      timestamp: Date.now(),
    })
  })

  const removeAbortListener = () => options.signal?.removeEventListener('abort', abortAgent)
  const abortAgent = () => agent.abort()
  options.signal?.addEventListener('abort', abortAgent, { once: true })

  try {
    const lastMessage = transcript.messages[transcript.messages.length - 1]
    if (lastMessage && (lastMessage.role === 'user' || lastMessage.role === 'toolResult')) {
      await agent.continue()
    } else {
      await agent.prompt('Continue the task using the available tools and return the requested result.')
    }
  } finally {
    removeAbortListener()
  }

  if (workflowError) throw workflowError
  if (options.signal?.aborted) {
    const error = new Error('Pi Agent run aborted')
    error.name = 'AbortError'
    throw error
  }
  if (agent.state.errorMessage) {
    throw new Error(agent.state.errorMessage)
  }

  const finalPiMessages = agent.state.messages
  const finalAssistantMessage = [...finalPiMessages].reverse().find(message => message.role === 'assistant') as AssistantMessage | undefined
  const finalContent = options.getToolResultContent?.()
    ?? (finalAssistantMessage ? textFromContent(finalAssistantMessage.content) : '')

  return {
    content: finalContent,
    toolCalls: allToolCalls,
    messages: piMessagesToChat(finalPiMessages, agent.state.systemPrompt),
    compression: contextTransformer.getReport(),
    assistantMessage: latestAssistant ?? finalAssistantMessage ?? null,
  }
}
