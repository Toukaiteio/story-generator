import type { ChatMessage } from '@/types/provider'
import type { ProviderAdapter, ChatOptions, StreamCallbacks, FunctionCallingResponse, StreamWithToolsCallbacks, ToolCallOptions } from './types'
import type { ToolDefinition, ToolCall } from './tools'
import { providerFetch } from './transport'
import {
  appendToolArgumentFragment,
  createToolArgumentsBuffer,
  finalizeToolArguments,
  type ToolArgumentsBuffer,
} from './toolArgs'

type ResponsesInputItem = Record<string, unknown>
type PendingFunctionCall = {
  itemId: string
  callId: string
  name: string
  buffer: ToolArgumentsBuffer
}

function readResponseArguments(source: any): unknown {
  const candidates = [source?.arguments, source?.parameters, source?.input]
  let fallback: unknown
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue
    if (fallback === undefined) fallback = candidate
    if (typeof candidate === 'string') {
      if (candidate.trim()) return candidate
      continue
    }
    return candidate
  }
  return fallback
}

function appendResponseArguments(target: PendingFunctionCall, fragment: unknown) {
  appendToolArgumentFragment(target.buffer, fragment)
}

function finalizePendingArguments(target: PendingFunctionCall): string {
  return finalizeToolArguments(target.buffer)
    ?? (target.buffer.argumentsText + target.buffer.stringTail)
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
    if (choice === undefined) return undefined
    if (choice === 'auto' || choice === 'none' || choice === 'required') return choice
    return {
      type: 'function',
      name: choice.function.name,
    }
  }

  private parseResponse(data: any): FunctionCallingResponse {
    const textParts: string[] = []
    const reasoningParts: string[] = []
    const toolCalls: ToolCall[] = []

    for (const item of data?.output ?? []) {
      if (item?.type === 'message' && Array.isArray(item.content)) {
        for (const content of item.content) {
          if (typeof content?.text === 'string') textParts.push(content.text)
        }
      }

      if ((item?.type === 'reasoning' || item?.type === 'reasoning_summary') && Array.isArray(item.summary)) {
        for (const summary of item.summary) {
          if (typeof summary?.text === 'string') reasoningParts.push(summary.text)
        }
      }

      if (item?.type === 'reasoning' && Array.isArray(item.content)) {
        for (const content of item.content) {
          if (typeof content?.text === 'string') reasoningParts.push(content.text)
        }
      }

      if (item?.type === 'function_call') {
        const argumentValue = readResponseArguments(item)
        const rawArguments = typeof argumentValue === 'string' ? argumentValue.trim() : ''
        let args: Record<string, any>
        try {
          const parsed = rawArguments ? JSON.parse(rawArguments) : argumentValue ?? {}
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Tool arguments must be a JSON object')
          }
          args = parsed as Record<string, any>
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          throw new Error(`Failed to parse arguments for tool ${String(item.name || 'unknown')}: ${reason}`)
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
      reasoning_content: reasoningParts.join('') || null,
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
      const toolChoice = this.buildToolChoice(toolOptions)
      if (toolChoice !== undefined) {
        body.tool_choice = toolChoice
      }
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

    const response = await providerFetch(url, {
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

  private parseFunctionCall(item: any, argumentOverride?: unknown): ToolCall | null {
    if (!item || item.type !== 'function_call') return null

    let args: Record<string, any>
    try {
      const rawArguments = argumentOverride ?? readResponseArguments(item) ?? '{}'
      const parsed = typeof rawArguments === 'string' ? JSON.parse(rawArguments || '{}') : rawArguments ?? {}
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Tool arguments must be a JSON object')
      }
      args = parsed as Record<string, any>
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to parse streamed arguments for tool ${String(item.name || 'unknown')}: ${reason}`)
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
    const response = await providerFetch(url, {
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
    let reasoningContent = ''
    let fullText = ''
    const completed = { response: null as FunctionCallingResponse | null }
    let finishReason: FunctionCallingResponse['finish_reason'] = 'stop'
    let outputLimitReached = false
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
        reasoningContent += event.delta
        callbacks.onReasoningToken?.(event.delta)
        return
      }

      if (type === 'response.output_item.added' && event.item?.type === 'function_call') {
        const item = event.item
        const itemId = String(item.id || event.item_id || event.output_index || pendingCalls.size)
        const pending: PendingFunctionCall = {
          itemId,
          callId: String(item.call_id || item.id || itemId),
          name: String(item.name || ''),
          buffer: createToolArgumentsBuffer(),
        }
        const initialArguments = readResponseArguments(item)
        if (initialArguments !== undefined && initialArguments !== null) {
          appendResponseArguments(pending, initialArguments)
        }
        pendingCalls.set(itemId, pending)
        return
      }

      if (type === 'response.function_call_arguments.delta') {
        const itemId = String(event.item_id || '')
        const current = pendingCalls.get(itemId)
        if (current) appendResponseArguments(current, event.delta ?? event.arguments ?? event.parameters)
        return
      }

      if (type === 'response.function_call_arguments.done') {
        const itemId = String(event.item_id || '')
        const current = pendingCalls.get(itemId) ?? {
          itemId,
          callId: String(event.call_id || itemId),
          name: String(event.name || ''),
          buffer: createToolArgumentsBuffer(),
        }
        if (event.arguments !== undefined || event.parameters !== undefined) {
          const argumentValue = event.arguments ?? event.parameters
          if (typeof argumentValue === 'string') {
            // The done event carries the authoritative complete arguments.
            if (argumentValue.trim() || !current.buffer.argumentsText.trim()) {
              current.buffer = createToolArgumentsBuffer()
              appendResponseArguments(current, argumentValue)
            }
          } else if (argumentValue && typeof argumentValue === 'object') {
            current.buffer = createToolArgumentsBuffer()
            appendResponseArguments(current, argumentValue)
          }
        }
        if (typeof event.name === 'string') {
          current.name = event.name
        }
        const toolCall = this.parseFunctionCall({
          type: 'function_call',
          id: current.itemId,
          call_id: current.callId,
          name: current.name,
          arguments: finalizePendingArguments(current),
        })
        if (toolCall) {
          toolCalls.push(toolCall)
        }
        pendingCalls.delete(itemId)
        return
      }

      if (type === 'response.output_item.done' && event.item?.type === 'function_call') {
        const toolCall = this.parseFunctionCall(event.item)
        if (toolCall && !toolCalls.some(existing => existing.id === toolCall.id)) {
          toolCalls.push(toolCall)
        }
        return
      }

      if (type === 'response.completed' && event.response) {
        completed.response = this.parseResponse(event.response)
        return
      }

      if (type === 'response.incomplete') {
        finishReason = 'length'
        outputLimitReached = true
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

      // Flush a final SSE frame even when the upstream response does not end
      // with a newline.
      buffer += decoder.decode()
      for (const line of buffer.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const raw = trimmed.slice(6)
        if (raw === '[DONE]') continue
        handleEvent(JSON.parse(raw))
      }

      const completedResponse = completed.response
      const finalToolCalls = toolCalls.length ? toolCalls : completedResponse?.tool_calls ?? []
      callbacks.onComplete({
        content: fullText || completedResponse?.content || null,
        reasoning_content: reasoningContent || completedResponse?.reasoning_content || null,
        tool_calls: finalToolCalls,
        finish_reason: finalToolCalls.length ? 'tool_calls' : completedResponse?.finish_reason ?? finishReason,
      })
    } catch (error: any) {
      const reason = error instanceof Error ? error.message : String(error)
      const lengthHint = outputLimitReached
        ? ' The provider stopped at the output token limit, so the tool arguments may be incomplete. Use a section edit or a model with a larger output limit.'
        : ''
      callbacks.onError(new Error(`${reason}${lengthHint}`))
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
