import type { ChatMessage } from '@/types/provider'
import type { ProviderAdapter, ChatOptions, StreamCallbacks, FunctionCallingResponse, StreamWithToolsCallbacks, ToolCallOptions } from './types'
import type { ToolDefinition, ToolCall } from './tools'

type ResponsesInputItem = Record<string, unknown>
type PendingFunctionCall = {
  itemId: string
  callId: string
  name: string
  arguments: string
}

export class OpenAIResponsesAdapter implements ProviderAdapter {
  private buildHeaders(options: ChatOptions): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${options.apiKey}`,
    }
  }

  private buildBaseUrl(options: ChatOptions): string {
    return (options.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  }

  private toResponsesInput(messages: ChatMessage[]): ResponsesInputItem[] {
    const input: ResponsesInputItem[] = []

    for (const message of messages) {
      if (message.role === 'tool') {
        if (!message.tool_call_id) continue
        input.push({
          type: 'function_call_output',
          call_id: message.tool_call_id,
          output: message.content ?? '',
        })
        continue
      }

      if (message.role === 'assistant') {
        if (message.content?.trim()) {
          input.push({
            role: 'assistant',
            content: message.content,
          })
        }

        for (const toolCall of message.tool_calls ?? []) {
          if (!toolCall.id || toolCall.type !== 'function' || !toolCall.function?.name) continue
          input.push({
            type: 'function_call',
            id: toolCall.id,
            call_id: toolCall.id,
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
          })
        }
        continue
      }

      input.push({
        role: message.role,
        content: message.content ?? '',
      })
    }

    return input
  }

  private buildTools(tools: ToolDefinition[]) {
    return tools.map(tool => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }))
  }

  private buildToolChoice(toolOptions?: ToolCallOptions) {
    const choice = toolOptions?.toolChoice
    if (!choice || choice === 'auto' || choice === 'none') return choice ?? 'auto'
    return {
      type: 'function',
      name: choice.function.name,
    }
  }

  private parseResponse(data: any): FunctionCallingResponse {
    const textParts: string[] = []
    const toolCalls: ToolCall[] = []

    for (const item of data?.output ?? []) {
      if (item?.type === 'message' && Array.isArray(item.content)) {
        for (const content of item.content) {
          if (typeof content?.text === 'string') textParts.push(content.text)
        }
      }

      if (item?.type === 'function_call') {
        let args: any = {}
        try {
          args = typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments ?? {}
        } catch (error) {
          console.error('Failed to parse Responses tool call arguments:', error)
        }

        const id = String(item.call_id || item.id || `call_${toolCalls.length + 1}`)
        toolCalls.push({
          id,
          name: String(item.name || ''),
          arguments: args,
        })
      }
    }

    const status = data?.status
    const incompleteReason = data?.incomplete_details?.reason
    return {
      content: textParts.join('') || data?.output_text || null,
      tool_calls: toolCalls.filter(toolCall => toolCall.name),
      finish_reason: toolCalls.length
        ? 'tool_calls'
        : status === 'incomplete' || incompleteReason === 'max_output_tokens'
          ? 'length'
          : 'stop',
    }
  }

  private buildRequestBody(
    messages: ChatMessage[],
    options: ChatOptions,
    tools?: ToolDefinition[],
    toolOptions?: ToolCallOptions
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: options.model,
      input: this.toResponsesInput(messages),
      max_output_tokens: options.maxTokens,
      temperature: options.temperature,
    }

    if (tools?.length) {
      body.tools = this.buildTools(tools)
      body.tool_choice = this.buildToolChoice(toolOptions)
    }

    return body
  }

  private async createResponse(
    messages: ChatMessage[],
    options: ChatOptions,
    tools?: ToolDefinition[],
    toolOptions?: ToolCallOptions
  ): Promise<FunctionCallingResponse> {
    const url = `${this.buildBaseUrl(options)}/responses`

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(options),
      signal: options.signal,
      body: JSON.stringify(this.buildRequestBody(messages, options, tools, toolOptions)),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI Responses API error: ${response.status} - ${error}`)
    }

    return this.parseResponse(await response.json())
  }

  private parseFunctionCall(item: any, argumentOverride?: string): ToolCall | null {
    if (!item || item.type !== 'function_call') return null

    let args: any = {}
    try {
      const rawArguments = argumentOverride ?? item.arguments ?? '{}'
      args = typeof rawArguments === 'string' ? JSON.parse(rawArguments || '{}') : rawArguments ?? {}
    } catch (error) {
      console.error('Failed to parse Responses streamed tool call arguments:', error)
    }

    const id = String(item.call_id || item.id || '')
    const name = String(item.name || '')
    if (!id || !name) return null

    return {
      id,
      name,
      arguments: args,
    }
  }

  private async streamResponse(
    messages: ChatMessage[],
    options: ChatOptions,
    callbacks: StreamWithToolsCallbacks,
    tools?: ToolDefinition[],
    toolOptions?: ToolCallOptions
  ): Promise<void> {
    const url = `${this.buildBaseUrl(options)}/responses`
    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(options),
      signal: options.signal,
      body: JSON.stringify({
        ...this.buildRequestBody(messages, options, tools, toolOptions),
        stream: true,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      callbacks.onError(new Error(`OpenAI Responses API error: ${response.status} - ${error}`))
      return
    }

    const reader = response.body?.getReader()
    if (!reader) {
      callbacks.onError(new Error('No response body'))
      return
    }

    const decoder = new TextDecoder()
    const pendingCalls = new Map<string, PendingFunctionCall>()
    const toolCalls: ToolCall[] = []
    let fullText = ''
    const completed = { response: null as FunctionCallingResponse | null }
    let finishReason: FunctionCallingResponse['finish_reason'] = 'stop'
    let buffer = ''

    const handleEvent = (event: any) => {
      const type = event?.type

      if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
        fullText += event.delta
        callbacks.onToken(event.delta)
        return
      }

      if (
        (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') &&
        typeof event.delta === 'string'
      ) {
        callbacks.onReasoningToken?.(event.delta)
        return
      }

      if (type === 'response.output_item.added' && event.item?.type === 'function_call') {
        const item = event.item
        const itemId = String(item.id || event.item_id || event.output_index || pendingCalls.size)
        pendingCalls.set(itemId, {
          itemId,
          callId: String(item.call_id || item.id || itemId),
          name: String(item.name || ''),
          arguments: typeof item.arguments === 'string' ? item.arguments : '',
        })
        return
      }

      if (type === 'response.function_call_arguments.delta') {
        const itemId = String(event.item_id || '')
        const current = pendingCalls.get(itemId)
        if (current && typeof event.delta === 'string') {
          current.arguments += event.delta
        }
        return
      }

      if (type === 'response.function_call_arguments.done') {
        const itemId = String(event.item_id || '')
        const current = pendingCalls.get(itemId) ?? {
          itemId,
          callId: String(event.call_id || itemId),
          name: String(event.name || ''),
          arguments: '',
        }
        if (typeof event.arguments === 'string') {
          current.arguments = event.arguments
        }
        if (typeof event.name === 'string') {
          current.name = event.name
        }
        const toolCall = this.parseFunctionCall({
          type: 'function_call',
          id: current.itemId,
          call_id: current.callId,
          name: current.name,
          arguments: current.arguments,
        })
        if (toolCall) {
          toolCalls.push(toolCall)
          callbacks.onToolCall(toolCall)
        }
        pendingCalls.delete(itemId)
        return
      }

      if (type === 'response.output_item.done' && event.item?.type === 'function_call') {
        const toolCall = this.parseFunctionCall(event.item)
        if (toolCall && !toolCalls.some(existing => existing.id === toolCall.id)) {
          toolCalls.push(toolCall)
          callbacks.onToolCall(toolCall)
        }
        return
      }

      if (type === 'response.completed' && event.response) {
        completed.response = this.parseResponse(event.response)
        return
      }

      if (type === 'response.incomplete') {
        finishReason = 'length'
        return
      }

      if (type === 'response.failed' || type === 'error') {
        const message = event?.response?.error?.message || event?.error?.message || 'OpenAI Responses stream failed'
        throw new Error(message)
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const raw = trimmed.slice(6)
          if (raw === '[DONE]') continue
          handleEvent(JSON.parse(raw))
        }
      }

      const completedResponse = completed.response
      const finalToolCalls = toolCalls.length ? toolCalls : completedResponse?.tool_calls ?? []
      callbacks.onComplete({
        content: fullText || completedResponse?.content || null,
        tool_calls: finalToolCalls,
        finish_reason: finalToolCalls.length ? 'tool_calls' : completedResponse?.finish_reason ?? finishReason,
      })
    } catch (error: any) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<string> {
    const response = await this.createResponse(messages, options)
    return response.content ?? ''
  }

  async chatWithTools(messages: ChatMessage[], options: ChatOptions, tools: ToolDefinition[], toolOptions?: ToolCallOptions): Promise<FunctionCallingResponse> {
    return this.createResponse(messages, options, tools, toolOptions)
  }

  async stream(messages: ChatMessage[], options: ChatOptions, callbacks: StreamCallbacks): Promise<void> {
    await this.streamResponse(messages, options, {
      onToken: callbacks.onToken,
      onToolCall: () => {},
      onToolResult: () => {},
      onComplete: response => callbacks.onComplete(response.content ?? ''),
      onError: callbacks.onError,
    })
  }

  async streamWithTools(messages: ChatMessage[], options: ChatOptions, tools: ToolDefinition[], callbacks: StreamWithToolsCallbacks, toolOptions?: ToolCallOptions): Promise<void> {
    await this.streamResponse(messages, options, callbacks, tools, toolOptions)
  }
}
