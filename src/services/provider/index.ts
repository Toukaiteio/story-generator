import type { ChatMessage, ProviderConfig } from '@/types/provider'
import type { ProviderModelRef } from '@/types/provider'
import type { ProviderAdapter, ChatOptions, StreamCallbacks, FunctionCallingResponse, FunctionCallingCallbacks, StreamWithToolsCallbacks } from './types'
import type { ToolDefinition, ToolCall, ToolResult } from './tools'
import { OpenAIAdapter } from './openai'
import { AnthropicAdapter } from './anthropic'
import { GoogleAdapter } from './google'

const adapters: Record<string, ProviderAdapter> = {
  openai: new OpenAIAdapter(),
  anthropic: new AnthropicAdapter(),
  google: new GoogleAdapter(),
}

export class ProviderManager {
  private providers: ProviderConfig[] = []
  private maxRetries = 3

  setProviders(providers: ProviderConfig[]) {
    this.providers = providers
  }

  private getAdapter(type: string): ProviderAdapter {
    const adapter = adapters[type]
    if (!adapter) throw new Error(`Unknown provider type: ${type}`)
    return adapter
  }

  private getProviderForModel(modelRef: ProviderModelRef): { provider: ProviderConfig; adapter: ProviderAdapter } | null {
    const provider = this.providers.find(item => item.id === modelRef.providerId && item.isActive)
    if (!provider) return null

    const hasModel = provider.models.some(model => model.id === modelRef.modelId)
    if (!hasModel) return null

    return { provider, adapter: this.getAdapter(provider.type) }
  }

  getProviderConfigForModel(modelRef: ProviderModelRef): ProviderConfig | null {
    return this.getProviderForModel(modelRef)?.provider ?? null
  }

  getModelConfigForRef(modelRef: ProviderModelRef): { provider: ProviderConfig; model: ProviderConfig['models'][number] } | null {
    const match = this.getProviderForModel(modelRef)
    if (!match) return null
    const model = match.provider.models.find(item => item.id === modelRef.modelId) ?? null
    if (!model) return null
    return { provider: match.provider, model }
  }

  async chat(messages: ChatMessage[], model: ProviderModelRef, maxTokens = 4096, temperature = 0.7): Promise<string> {
    const match = this.getProviderForModel(model)
    if (!match) throw new Error(`No active provider found for model: ${model.providerId}/${model.modelId}`)

    const options: ChatOptions = {
      model: model.modelId,
      maxTokens,
      temperature,
      apiKey: match.provider.apiKey ?? '',
      baseUrl: match.provider.baseUrl,
    }

    let lastError: Error | null = null
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await match.adapter.chat(messages, options)
      } catch (e: any) {
        lastError = e
        if (attempt < this.maxRetries - 1) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000))
        }
      }
    }

    throw lastError || new Error('Chat failed after retries')
  }

  async chatWithTools(messages: ChatMessage[], model: ProviderModelRef, tools: ToolDefinition[], maxTokens = 4096, temperature = 0.7): Promise<FunctionCallingResponse> {
    const match = this.getProviderForModel(model)
    if (!match) throw new Error(`No active provider found for model: ${model.providerId}/${model.modelId}`)

    const options: ChatOptions = {
      model: model.modelId,
      maxTokens,
      temperature,
      apiKey: match.provider.apiKey ?? '',
      baseUrl: match.provider.baseUrl,
    }

    let lastError: Error | null = null
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await match.adapter.chatWithTools(messages, options, tools)
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
    temperature = 0.7
  ): Promise<void> {
    const match = this.getProviderForModel(model)
    if (!match) throw new Error(`No active provider found for model: ${model.providerId}/${model.modelId}`)

    const options: ChatOptions = {
      model: model.modelId,
      maxTokens,
      temperature,
      apiKey: match.provider.apiKey ?? '',
      baseUrl: match.provider.baseUrl,
    }

    let lastError: Error | null = null
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        await match.adapter.stream(messages, options, callbacks)
        return
      } catch (e: any) {
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
    temperature = 0.7
  ): Promise<void> {
    const match = this.getProviderForModel(model)
    if (!match) throw new Error(`No active provider found for model: ${model.providerId}/${model.modelId}`)

    const options: ChatOptions = {
      model: model.modelId,
      maxTokens,
      temperature,
      apiKey: match.provider.apiKey ?? '',
      baseUrl: match.provider.baseUrl,
    }

    let lastError: Error | null = null
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        await match.adapter.streamWithTools(messages, options, tools, callbacks)
        return
      } catch (e: any) {
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
