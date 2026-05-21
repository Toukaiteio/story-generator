import type { ChatMessage, ProviderConfig } from '@/types/provider'
import type { ProviderModelRef } from '@/types/provider'
import type { ProviderAdapter, ChatOptions, StreamCallbacks, FunctionCallingResponse, StreamWithToolsCallbacks, ToolCallOptions } from './types'
import type { ToolDefinition, ToolCall, ToolResult } from './tools'
import { OpenAIAdapter } from './openai'
import { OpenAIResponsesAdapter } from './openaiResponses'
import { AnthropicAdapter } from './anthropic'
import { GoogleAdapter } from './google'
import { buildContinueMessages, createParagraphGuard, guardResponseText } from './responseGuard'
import { applyDsmlCompatToFunctionResponse } from './dsmlCompat'
import { calculateBudget, estimateMessageTokens, estimateMessagesTokens, fitMessagesToContextSmart, sanitizeToolCallContinuity } from '@/services/context'

type ToolChoiceCompatState = {
  canFallback: boolean
  active: boolean
  instruction: string | null
  downgradedOptions?: ToolCallOptions
}

const adapters: Record<string, ProviderAdapter> = {
  openai: new OpenAIAdapter(),
  'openai-responses': new OpenAIResponsesAdapter(),
  anthropic: new AnthropicAdapter(),
  google: new GoogleAdapter(),
}

export class ProviderManager {
  private providers: ProviderConfig[] = []
  private maxRetries = 3
  private maxGuardContinuations = 2
  private compressionThreshold = 0.6
  private compressionPreserveRecentGroups = 6
  private unknownContextCompressionTriggerTokens = 200000
  private unknownContextVirtualWindowTokens = 220000
  private unknownContextForcedInputLimitTokens = 190000

  setProviders(providers: ProviderConfig[]) {
    this.providers = providers
  }

  private getAdapter(type: string): ProviderAdapter {
    const adapter = adapters[type]
    if (!adapter) throw new Error(`Unknown provider type: ${type}`)
    return adapter
  }

  private resolveModelConfig(provider: ProviderConfig, modelRef: ProviderModelRef) {
    return provider.models.find(model =>
      model.id === modelRef.modelId ||
      model.id === `${modelRef.providerId}/${modelRef.modelId}` ||
      (modelRef.modelId.includes('/') && model.id === modelRef.modelId.split('/').pop()) ||
      model.id.split('/').pop() === modelRef.modelId
    ) ?? null
  }

  private getProviderForModel(modelRef: ProviderModelRef): { provider: ProviderConfig; adapter: ProviderAdapter; model: ProviderConfig['models'][number] } | null {
    const provider = this.providers.find(item => item.id === modelRef.providerId && item.isActive)
    if (!provider) return null

    const model = this.resolveModelConfig(provider, modelRef)
    if (!model) return null

    return { provider, adapter: this.getAdapter(provider.type), model }
  }

  private buildToolChoiceCompatState(toolOptions?: ToolCallOptions): ToolChoiceCompatState {
    const hasExplicitToolChoice = !!toolOptions && Object.prototype.hasOwnProperty.call(toolOptions, 'toolChoice')
    const toolChoice = toolOptions?.toolChoice
    if (!hasExplicitToolChoice || toolChoice === undefined) {
      return {
        canFallback: false,
        active: false,
        instruction: null,
        downgradedOptions: toolOptions,
      }
    }

    const targetToolName = typeof toolChoice === 'object'
      ? toolChoice.function?.name?.trim()
      : toolChoice === 'required'
        ? 'any available'
        : ''
    const instruction = targetToolName && targetToolName !== 'any available'
      ? `Tool-choice compatibility fallback is active. This model endpoint does not support strict tool_choice in thinking mode. You must call the function tool "${targetToolName}" as the next action and place the final structured result in that tool call arguments.`
      : 'Tool-choice compatibility fallback is active. This model endpoint does not support strict tool_choice in thinking mode. You must call one of the available function tools as the next action and place the final structured result in that tool call arguments.'
    const downgradedOptions = { ...(toolOptions ?? {}) } as ToolCallOptions
    delete (downgradedOptions as Partial<ToolCallOptions>).toolChoice

    return {
      canFallback: true,
      active: false,
      instruction,
      downgradedOptions,
    }
  }

  private isToolChoiceThinkingModeCompatibilityError(error: unknown): boolean {
    const message = String((error as any)?.message ?? error ?? '').toLowerCase()
    if (!message.includes('tool_choice')) return false
    if (message.includes('thinking mode') && (message.includes('required') || message.includes('object'))) return true
    if (message.includes('does not support being set to required or object')) return true
    if (message.includes('does not support this tool_choice')) return true
    if (message.includes('does not support tool_choice')) return true
    if (message.includes('tool_choice is not supported')) return true
    if (message.includes('invalidparameter') && message.includes('tool_choice')) return true
    return false
  }

  private withToolChoiceCompatInstruction(messages: ChatMessage[], instruction: string | null): ChatMessage[] {
    if (!instruction) return messages
    const marker = 'Tool-choice compatibility fallback is active.'
    const firstSystemIndex = messages.findIndex(message => message.role === 'system')
    if (firstSystemIndex >= 0) {
      const target = messages[firstSystemIndex]
      const currentContent = target.content ?? ''
      if (currentContent.includes(marker)) return messages
      const next = [...messages]
      next[firstSystemIndex] = {
        ...target,
        content: currentContent ? `${currentContent}\n\n${instruction}` : instruction,
      }
      return next
    }
    return [{ role: 'system', content: instruction }, ...messages]
  }

  private fitMessagesToModelContext(
    messages: ChatMessage[],
    contextTokens: number | null | undefined,
    maxOutputTokens: number
  ): ChatMessage[] {
    const hasConfiguredContext = !!(contextTokens && contextTokens > 0)
    let effectiveContextTokens = contextTokens ?? null
    if (!hasConfiguredContext) {
      const totalTokens = estimateMessagesTokens(messages)
      if (totalTokens < this.unknownContextCompressionTriggerTokens) {
        return sanitizeToolCallContinuity(messages).messages
      }
      effectiveContextTokens = Math.max(
        this.unknownContextVirtualWindowTokens,
        Math.ceil(totalTokens * 1.05)
      )
    }

    if (!effectiveContextTokens || effectiveContextTokens <= 0) {
      return sanitizeToolCallContinuity(messages).messages
    }
    const { messages: fitted } = fitMessagesToContextSmart(
      messages,
      effectiveContextTokens,
      maxOutputTokens,
      {
        threshold: this.compressionThreshold,
        preserveRecentGroups: this.compressionPreserveRecentGroups,
      }
    )
    const budget = calculateBudget(effectiveContextTokens, maxOutputTokens)
    const maxInputTokens = hasConfiguredContext
      ? budget.available
      : Math.min(budget.available, this.unknownContextForcedInputLimitTokens)
    const continuitySafeFitted = sanitizeToolCallContinuity(fitted).messages
    const fittedTokens = estimateMessagesTokens(continuitySafeFitted)
    if (fittedTokens <= maxInputTokens) return continuitySafeFitted

    const longestUserIndex = continuitySafeFitted
      .map((message, index) => ({ index, tokens: message.role === 'user' ? estimateMessageTokens(message) : -1 }))
      .sort((a, b) => b.tokens - a.tokens)[0]?.index

    if (longestUserIndex == null || longestUserIndex < 0) return fitted
    const target = continuitySafeFitted[longestUserIndex]
    const source = String(target.content || '')
    if (!source.trim()) return continuitySafeFitted

    const otherTokens = fittedTokens - estimateMessageTokens(target)
    const maxContentTokens = Math.max(80, maxInputTokens - otherTokens - 12)
    const notice = hasConfiguredContext
      ? '\n\n[Context truncated to fit model token window.]'
      : '\n\n[Context truncated by fallback high-token safeguard.]'
    let low = 0
    let high = source.length
    let best = ''
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      const candidate = `${source.slice(0, mid).trimEnd()}${notice}`
      const candidateMsg: ChatMessage = { ...target, content: candidate }
      if (estimateMessageTokens(candidateMsg) <= maxContentTokens) {
        best = candidate
        low = mid + 1
      } else {
        high = mid - 1
      }
    }

    if (!best) return continuitySafeFitted
    const next = [...continuitySafeFitted]
    next[longestUserIndex] = { ...target, content: best }
    return sanitizeToolCallContinuity(next).messages
  }

  getProviderConfigForModel(modelRef: ProviderModelRef): ProviderConfig | null {
    return this.getProviderForModel(modelRef)?.provider ?? null
  }

  getModelConfigForRef(modelRef: ProviderModelRef): { provider: ProviderConfig; model: ProviderConfig['models'][number] } | null {
    const match = this.getProviderForModel(modelRef)
    if (!match) return null
    return { provider: match.provider, model: match.model }
  }

  async chat(messages: ChatMessage[], model: ProviderModelRef, maxTokens = 4096, temperature = 0.7, signal?: AbortSignal): Promise<string> {
    const match = this.getProviderForModel(model)
    if (!match) throw new Error(`No active provider found for model: ${model.providerId}/${model.modelId}`)

    const options: ChatOptions = {
      model: match.model.id,
      maxTokens,
      temperature,
      apiKey: match.provider.apiKey ?? '',
      baseUrl: match.provider.baseUrl,
      signal,
    }

    let lastError: Error | null = null
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        let currentMessages = this.fitMessagesToModelContext(messages, match.model.contextTokens, maxTokens)
        let collected = ''
        for (let continuation = 0; continuation <= this.maxGuardContinuations; continuation++) {
          currentMessages = this.fitMessagesToModelContext(currentMessages, match.model.contextTokens, maxTokens)
          const raw = await match.adapter.chat(currentMessages, options)
          const guarded = guardResponseText(raw)
          collected = collected ? `${collected}\n\n${guarded.text}` : guarded.text
          if (!guarded.detectedRefusal || continuation >= this.maxGuardContinuations) {
            return collected
          }
          currentMessages = this.fitMessagesToModelContext([
            ...currentMessages,
            { role: 'user', content: 'Continue.' },
          ], match.model.contextTokens, maxTokens)
        }
        return collected
      } catch (e: any) {
        if (signal?.aborted || e?.name === 'AbortError') throw e
        lastError = e
        if (attempt < this.maxRetries - 1) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000))
        }
      }
    }

    throw lastError || new Error('Chat failed after retries')
  }

  async chatWithTools(messages: ChatMessage[], model: ProviderModelRef, tools: ToolDefinition[], maxTokens = 4096, temperature = 0.7, toolOptions?: ToolCallOptions, signal?: AbortSignal): Promise<FunctionCallingResponse> {
    const match = this.getProviderForModel(model)
    if (!match) throw new Error(`No active provider found for model: ${model.providerId}/${model.modelId}`)

    const options: ChatOptions = {
      model: match.model.id,
      maxTokens,
      temperature,
      apiKey: match.provider.apiKey ?? '',
      baseUrl: match.provider.baseUrl,
      signal,
    }

    let lastError: Error | null = null
    const toolChoiceCompat = this.buildToolChoiceCompatState(toolOptions)
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        let currentMessages = this.fitMessagesToModelContext(messages, match.model.contextTokens, maxTokens)
        let combinedContent = ''
        for (let continuation = 0; continuation <= this.maxGuardContinuations; continuation++) {
          currentMessages = this.fitMessagesToModelContext(currentMessages, match.model.contextTokens, maxTokens)
          let requestMessages = toolChoiceCompat.active
            ? this.withToolChoiceCompatInstruction(currentMessages, toolChoiceCompat.instruction)
            : currentMessages
          let requestToolOptions = toolChoiceCompat.active
            ? toolChoiceCompat.downgradedOptions
            : toolOptions

          let rawResponse: FunctionCallingResponse
          try {
            rawResponse = await match.adapter.chatWithTools(requestMessages, options, tools, requestToolOptions)
          } catch (error) {
            if (
              !toolChoiceCompat.active &&
              toolChoiceCompat.canFallback &&
              this.isToolChoiceThinkingModeCompatibilityError(error)
            ) {
              console.warn('[ProviderManager] tool_choice compatibility fallback activated (chatWithTools)', {
                providerType: match.provider.type,
                model: match.model.id,
              })
              toolChoiceCompat.active = true
              requestMessages = this.withToolChoiceCompatInstruction(currentMessages, toolChoiceCompat.instruction)
              requestToolOptions = toolChoiceCompat.downgradedOptions
              rawResponse = await match.adapter.chatWithTools(requestMessages, options, tools, requestToolOptions)
            } else {
              throw error
            }
          }
          const response = applyDsmlCompatToFunctionResponse(rawResponse)
          const guarded = guardResponseText(response.content)
          response.content = guarded.text || null
          combinedContent = combinedContent
            ? response.content
              ? `${combinedContent}\n\n${response.content}`
              : combinedContent
            : response.content || ''
          if (response.tool_calls.length > 0 || !guarded.detectedRefusal || continuation >= this.maxGuardContinuations) {
            response.content = combinedContent || response.content
            return response
          }
          currentMessages = this.fitMessagesToModelContext(
            buildContinueMessages(currentMessages, guarded.text, response.reasoning_content),
            match.model.contextTokens,
            maxTokens
          )
        }
        return { content: combinedContent || null, tool_calls: [], finish_reason: 'stop' }
      } catch (e: any) {
        if (signal?.aborted || e?.name === 'AbortError') throw e
        lastError = e
        if (attempt < this.maxRetries - 1) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000))
        }
      }
    }

    throw lastError || new Error('Chat with tools failed after retries')
  }

  async stream(
    messages: ChatMessage[],
    model: ProviderModelRef,
    callbacks: StreamCallbacks,
    maxTokens = 4096,
    temperature = 0.7,
    signal?: AbortSignal
  ): Promise<void> {
    const match = this.getProviderForModel(model)
    if (!match) throw new Error(`No active provider found for model: ${model.providerId}/${model.modelId}`)

    const options: ChatOptions = {
      model: match.model.id,
      maxTokens,
      temperature,
      apiKey: match.provider.apiKey ?? '',
      baseUrl: match.provider.baseUrl,
      signal,
    }

    let lastError: Error | null = null
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const runStream = async (streamMessages: ChatMessage[], continuation: number, aggregateText = ''): Promise<string> => {
          const fittedStreamMessages = this.fitMessagesToModelContext(streamMessages, match.model.contextTokens, maxTokens)
          const paragraphGuard = createParagraphGuard(token => callbacks.onToken(token))
          let reasoningContent = ''
          await match.adapter.stream(fittedStreamMessages, options, {
            ...callbacks,
            onToken: token => {
              paragraphGuard.push(token)
            },
            onReasoningToken: token => {
              reasoningContent += token
              callbacks.onReasoningToken?.(token)
            },
            onComplete: () => {},
          })
          const guarded = paragraphGuard.flush()
          const nextAggregate = aggregateText
            ? guarded.text
              ? `${aggregateText}\n\n${guarded.text}`
              : aggregateText
            : guarded.text
          if (!guarded.detectedRefusal || continuation >= this.maxGuardContinuations) {
            return nextAggregate
          }
          return runStream(
            this.fitMessagesToModelContext(
              buildContinueMessages(fittedStreamMessages, guarded.text, reasoningContent),
              match.model.contextTokens,
              maxTokens
            ),
            continuation + 1,
            nextAggregate
          )
        }

        const finalText = await runStream(messages, 0)
        callbacks.onComplete(finalText)
        return
      } catch (e: any) {
        if (signal?.aborted || e?.name === 'AbortError') throw e
        lastError = e
        if (attempt < this.maxRetries - 1) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000))
        }
      }
    }

    throw lastError || new Error('Stream failed after retries')
  }

  async streamWithTools(
    messages: ChatMessage[],
    model: ProviderModelRef,
    tools: ToolDefinition[],
    callbacks: StreamWithToolsCallbacks,
    maxTokens = 4096,
    temperature = 0.7,
    toolOptions?: ToolCallOptions,
    signal?: AbortSignal
  ): Promise<void> {
    const match = this.getProviderForModel(model)
    if (!match) throw new Error(`No active provider found for model: ${model.providerId}/${model.modelId}`)

    const options: ChatOptions = {
      model: match.model.id,
      maxTokens,
      temperature,
      apiKey: match.provider.apiKey ?? '',
      baseUrl: match.provider.baseUrl,
      signal,
    }

    const streamedToolCallKeys = new Set<string>()
    const toolCallKey = (toolCall: { id?: string | null; name?: string | null }) =>
      toolCall.id?.trim()
        ? `id:${toolCall.id.trim()}`
        : `name:${String(toolCall.name || '').trim()}`

    let lastError: Error | null = null
    const toolChoiceCompat = this.buildToolChoiceCompatState(toolOptions)
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const runStreamWithTools = async (
          streamMessages: ChatMessage[],
          continuation: number,
          aggregateText = ''
        ): Promise<FunctionCallingResponse> => {
          const fittedStreamMessages = this.fitMessagesToModelContext(streamMessages, match.model.contextTokens, maxTokens)
          let requestMessages = toolChoiceCompat.active
            ? this.withToolChoiceCompatInstruction(fittedStreamMessages, toolChoiceCompat.instruction)
            : fittedStreamMessages
          let requestToolOptions = toolChoiceCompat.active
            ? toolChoiceCompat.downgradedOptions
            : toolOptions
          const paragraphGuard = createParagraphGuard(token => callbacks.onToken(token))
          let completedResponse: FunctionCallingResponse | null = null
          let streamError: Error | null = null

          const executeOnce = async () => {
            streamError = null
            await match.adapter.streamWithTools(requestMessages, options, tools, {
              ...callbacks,
              onToolCall: toolCall => {
                const key = toolCallKey(toolCall)
                if (key !== 'name:') {
                  streamedToolCallKeys.add(key)
                }
                callbacks.onToolCall(toolCall)
              },
              onToken: token => {
                paragraphGuard.push(token)
              },
              onComplete: response => {
                completedResponse = response
              },
              onError: error => {
                streamError = error
              },
            }, requestToolOptions)
            if (streamError) throw streamError
          }

          try {
            await executeOnce()
          } catch (error) {
            if (
              !toolChoiceCompat.active &&
              toolChoiceCompat.canFallback &&
              this.isToolChoiceThinkingModeCompatibilityError(error)
            ) {
              console.warn('[ProviderManager] tool_choice compatibility fallback activated (streamWithTools)', {
                providerType: match.provider.type,
                model: match.model.id,
              })
              toolChoiceCompat.active = true
              requestMessages = this.withToolChoiceCompatInstruction(fittedStreamMessages, toolChoiceCompat.instruction)
              requestToolOptions = toolChoiceCompat.downgradedOptions
              completedResponse = null
              await executeOnce()
            } else {
              throw error
            }
          }

          const response = completedResponse as FunctionCallingResponse | null
          if (!response) {
            throw new Error('Stream with tools failed to complete')
          }

          const guarded = paragraphGuard.flush()
          const nextAggregate = aggregateText
            ? guarded.text
              ? `${aggregateText}\n\n${guarded.text}`
              : aggregateText
            : guarded.text
          response.content = nextAggregate || null

          if (response.tool_calls.length > 0 || !guarded.detectedRefusal || continuation >= this.maxGuardContinuations) {
            return response
          }

          return runStreamWithTools(
            this.fitMessagesToModelContext(
              buildContinueMessages(fittedStreamMessages, guarded.text, response.reasoning_content),
              match.model.contextTokens,
              maxTokens
            ),
            continuation + 1,
            nextAggregate
          )
        }

        const finalResponse = applyDsmlCompatToFunctionResponse(await runStreamWithTools(messages, 0))
        for (const toolCall of finalResponse.tool_calls) {
          const key = toolCallKey(toolCall)
          if (key !== 'name:' && streamedToolCallKeys.has(key)) {
            continue
          }
          callbacks.onToolCall(toolCall)
          if (key !== 'name:') {
            streamedToolCallKeys.add(key)
          }
        }
        callbacks.onComplete(finalResponse)
        return
      } catch (e: any) {
        if (signal?.aborted || e?.name === 'AbortError') throw e
        lastError = e
        if (attempt < this.maxRetries - 1) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000))
        }
      }
    }

    throw lastError || new Error('Stream with tools failed after retries')
  }
}

export const providerManager = new ProviderManager()
export type { ToolDefinition, ToolCall, ToolResult } from './tools'
