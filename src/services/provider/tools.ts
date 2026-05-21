export interface ToolParameter {
  type: string
  description?: string
  enum?: string[]
  properties?: Record<string, ToolParameter>
  required?: string[]
  items?: ToolParameter
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, ToolParameter>
    required: string[]
  }
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, any>
}

export interface ToolResult {
  tool_call_id: string
  content: string
}

export interface FunctionCallingOptions {
  tools: ToolDefinition[]
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }
}

export interface FunctionCallingResponse {
  content: string | null
  reasoning_content?: string | null
  tool_calls: ToolCall[]
  finish_reason: 'stop' | 'tool_calls' | 'length'
}
