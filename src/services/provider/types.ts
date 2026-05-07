import type { ChatMessage } from '@/types/provider'
import type { ToolDefinition, ToolCall, ToolResult } from './tools'

export interface StreamCallbacks {
  onToken: (token: string) => void
  onComplete: (fullText: string) => void
  onError: (error: Error) => void
}

export interface FunctionCallingCallbacks {
  onToolCall: (toolCall: ToolCall) => void
  onToolResult: (result: ToolResult) => void
  onComplete: (response: FunctionCallingResponse) => void
  onError: (error: Error) => void
}

export interface FunctionCallingResponse {
  content: string | null
  reasoning_content?: string | null
  tool_calls: ToolCall[]
  finish_reason: 'stop' | 'tool_calls' | 'length'
}

export interface StreamWithToolsCallbacks extends Omit<StreamCallbacks, 'onComplete'> {
  onToolCall: (toolCall: ToolCall) => void
  onToolResult: (result: ToolResult) => void
  onComplete: (response: FunctionCallingResponse) => void
}

export interface ProviderAdapter {
  chat(messages: ChatMessage[], options: ChatOptions): Promise<string>
  chatWithTools(messages: ChatMessage[], options: ChatOptions, tools: ToolDefinition[]): Promise<FunctionCallingResponse>
  stream(messages: ChatMessage[], options: ChatOptions, callbacks: StreamCallbacks): Promise<void>
  streamWithTools(messages: ChatMessage[], options: ChatOptions, tools: ToolDefinition[], callbacks: StreamWithToolsCallbacks): Promise<void>
}

export interface ChatOptions {
  model: string
  maxTokens: number
  temperature: number
  apiKey: string
  baseUrl: string
}
