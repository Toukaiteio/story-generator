import type { ChatMessage, ProviderConfig } from '@/types/provider'
import type { ProviderModelRef } from '@/types/provider'
import type { ProviderAdapter, ChatOptions, StreamCallbacks, FunctionCallingResponse, FunctionCallingCallbacks, StreamWithToolsCallbacks, ToolCallOptions } from './types'
import type { ToolDefinition, ToolCall, ToolResult } from './tools'
import { OpenAIAdapter } from './openai'
import { OpenAIResponsesAdapter } from './openaiResponses'
import { AnthropicAdapter } from './anthropic'
import { GoogleAdapter } from './google'
import { buildContinueMessages, createParagraphGuard, guardResponseText } from './responseGuard'

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

  getProviderConfigForModel(modelRef: ProviderModelRef): ProviderConfig | null {
    return this.getProviderForModel(modelRef)?.provider ?? null
  }

  getModelConfigForRef(modelRef: ProviderModelRef): { provider: ProviderConfig; model: ProviderConfig['models'][number] } | null {
    const match = this.getProviderForModel(modelRef)
    if (!match) return null
    return { provider: match.provider, model: match.model }
  }

  async chat(messages: ChatMessage[], model: ProviderModelRef, maxTokens = 4096, temperature = 0.7): Promise<string> {
    const match = this.getProviderForModel(model)
    if (!match) throw new Error(`No active provider found for model: ${model.providerId}/${model.modelId}`)

    const options: ChatOptions = {
      model: match.model.id,
      maxTokens,
      temperature,
      apiKey: match.provider.apiKey ?? '',
      baseUrl: match.provider.baseUrl,
    }

    let lastError: Error | null = null
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        let currentMessages = messages
        let collected = ''
        for (let continuation = 0; continuation <= this.maxGuardContinuations; continuation++) {
          const raw = await match.adapter.chat(currentMessages, options)
          const guarded = guardResponseText(raw)
          collected = collected ? `${collected}\n\n${guarded.text}` : guarded.text
          if (!guarded.detectedRefusal || continuation >= this.maxGuardContinuations) {
            return collected
          }
          currentMessages = buildContinueMessages(currentMessages, guarded.text)
        }
        return collected
      } catch (e: any) {
        lastError = e
        if (attempt < this.maxRetries - 1) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000))
        }
      }
    }

    throw lastError || new Error('Chat failed after retries')
  }

  async chatWithTools(messages: ChatMessage[], model: ProviderModelRef, tools: ToolDefinition[], maxTokens = 4096, temperature = 0.7, toolOptions?: ToolCallOptions): Promise<FunctionCallingResponse> {
    const match = this.getProviderForModel(model)
    if (!match) throw new Error(`No active provider found for model: ${model.providerId}/${model.modelId}`)

    const options: ChatOptions = {
      model: match.model.id,
      maxTokens,
      temperature,
      apiKey: match.provider.apiKey ?? '',
      baseUrl: match.provider.baseUrl,
    }

    let lastError: Error | null = null
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        let currentMessages = messages
        let combinedContent = ''
        for (let continuation = 0; continuation <= this.maxGuardContinuations; continuation++) {
          const response = await match.adapter.chatWithTools(currentMessages, options, tools, toolOptions)
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
          currentMessages = buildContinueMessages(currentMessages, guarded.text)
        }
        return { content: combinedContent || null, tool_calls: [], finish_reason: 'stop' }
      } catch (e: any) {
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
          const paragraphGuard = createParagraphGuard(token => callbacks.onToken(token))
          await match.adapter.stream(streamMessages, options, {
            ...callbacks,
            onToken: token => {
              paragraphGuard.push(token)
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
          return runStream(buildContinueMessages(streamMessages, guarded.text), continuation + 1, nextAggregate)
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

    let lastError: Error | null = null
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const runStreamWithTools = async (
          streamMessages: ChatMessage[],
          continuation: number,
          aggregateText = ''
        ): Promise<FunctionCallingResponse> => {
          const paragraphGuard = createParagraphGuard(token => callbacks.onToken(token))
          let completedResponse: FunctionCallingResponse | null = null
          await match.adapter.streamWithTools(streamMessages, options, tools, {
            ...callbacks,
            onToken: token => {
              paragraphGuard.push(token)
            },
            onComplete: response => {
              completedResponse = response
            },
          }, toolOptions)

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
            buildContinueMessages(streamMessages, guarded.text),
            continuation + 1,
            nextAggregate
          )
        }

        const finalResponse = await runStreamWithTools(messages, 0)
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
