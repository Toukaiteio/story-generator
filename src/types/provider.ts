import type { ID } from './common'

export type ProviderType = 'openai' | 'anthropic' | 'google'
export type ModelSource = 'builtin' | 'remote' | 'custom'
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'max'

export interface ProviderModelRef {
  providerId: ID
  modelId: string
}

export interface ReasoningConfig {
  enabled: boolean
  effort: ReasoningEffort
}

export interface ModelConfig {
  id: string
  name: string
  tier: 'expert' | 'standard'
  maxTokens: number
  contextTokens?: number | null
  contextTokensSource?: 'api' | 'manual' | 'fallback' | null
  supportsStreaming: boolean
  supportsEmbeddings: boolean
  embeddingDimensions?: number | null
  source: ModelSource
  reasoning: ReasoningConfig
}

export interface ProviderConfig {
  id: ID
  type: ProviderType
  name: string
  apiKey?: string | null
  baseUrl: string
  models: ModelConfig[]
  isActive: boolean
  lastSyncedAt?: string | null
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  reasoning_content?: string | null
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
}

export interface UnifiedRequest {
  messages: ChatMessage[]
  model: string
  maxTokens: number
  temperature: number
  stream: boolean
}

export interface UnifiedResponse {
  content: string
  finishReason: string
  usage: { promptTokens: number; completionTokens: number }
  model: string
  provider: ProviderType
}
