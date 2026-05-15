import type { ChatMessage } from '@/types/provider'
import type { ProviderAdapter, ChatOptions, StreamCallbacks, FunctionCallingResponse, StreamWithToolsCallbacks, ToolCallOptions } from './types'
import type { ToolDefinition, ToolCall } from './tools'

export class OpenAIAdapter implements ProviderAdapter {
  private normalizeMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
    const normalized: Array<Record<string, unknown>> = []

    for (const message of messages) {
      if (message.role === 'assistant') {
        const content = typeof message.content === 'string' && message.content.trim().length > 0
          ? message.content
          : undefined
        const reasoningContent = typeof message.reasoning_content === 'string' && message.reasoning_content.trim().length > 0
          ? message.reasoning_content
          : undefined
        const toolCalls = (message.tool_calls ?? []).filter(toolCall =>
          toolCall.id &&
          toolCall.type === 'function' &&
          toolCall.function?.name &&
          typeof toolCall.function.arguments === 'string'
        )

        if (!content && !toolCalls.length && !reasoningContent) {
          continue
        }

        const assistantMessage: Record<string, unknown> = {
          role: 'assistant',
        }
        assistantMessage.content = content ?? ''
        if (reasoningContent) assistantMessage.reasoning_content = reasoningContent
        if (toolCalls.length) assistantMessage.tool_calls = toolCalls
        normalized.push(assistantMessage)
        continue
      }

      if (message.role === 'tool') {
        if (!message.tool_call_id) {
          continue
        }

        normalized.push({
          role: 'tool',
          tool_call_id: message.tool_call_id,
          content: message.content ?? '',
        })
        continue
      }

      normalized.push({
        role: message.role,
        content: message.content ?? '',
      })
    }

    return normalized
  }

  private buildHeaders(options: ChatOptions): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${options.apiKey}`,
    }
  }

  private buildBaseUrl(options: ChatOptions): string {
    const baseUrl = options.baseUrl || 'https://api.openai.com/v1'
    // Remove trailing slash
    return baseUrl.replace(/\/+$/, '')
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<string> {
    const url = `${this.buildBaseUrl(options)}/chat/completions`
    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(options),
      signal: options.signal,
      body: JSON.stringify({
        model: options.model,
        messages: this.normalizeMessages(messages),
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        stream: false,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error: ${response.status} - ${error}`)
    }

    const data = await response.json()
    return data.choices[0]?.message?.content ?? ''
  }

  async chatWithTools(messages: ChatMessage[], options: ChatOptions, tools: ToolDefinition[], toolOptions?: ToolCallOptions): Promise<FunctionCallingResponse> {
    const url = `${this.buildBaseUrl(options)}/chat/completions`
    const body: Record<string, unknown> = {
      model: options.model,
      messages: this.normalizeMessages(messages),
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      stream: false,
      tools: tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
    }
    if (toolOptions && Object.prototype.hasOwnProperty.call(toolOptions, 'toolChoice') && toolOptions.toolChoice !== undefined) {
      body.tool_choice = toolOptions.toolChoice
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(options),
      signal: options.signal,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error: ${response.status} - ${error}`)
    }

    const data = await response.json()
    const choice = data.choices[0]
    const message = choice?.message

    const toolCalls: ToolCall[] = []
    if (message?.tool_calls) {
      for (const toolCall of message.tool_calls) {
        try {
          const args = typeof toolCall.function.arguments === 'string'
            ? JSON.parse(toolCall.function.arguments)
            : toolCall.function.arguments
          toolCalls.push({
            id: toolCall.id,
            name: toolCall.function.name,
            arguments: args,
          })
        } catch (e) {
          console.error('Failed to parse tool call arguments:', e)
        }
      }
    }

    return {
      content: message?.content ?? null,
      reasoning_content: message?.reasoning_content ?? null,
      tool_calls: toolCalls,
      finish_reason: choice?.finish_reason === 'tool_calls' ? 'tool_calls' : choice?.finish_reason === 'length' ? 'length' : 'stop',
    }
  }

  async stream(messages: ChatMessage[], options: ChatOptions, callbacks: StreamCallbacks): Promise<void> {
    const url = `${this.buildBaseUrl(options)}/chat/completions`
    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(options),
      signal: options.signal,
      body: JSON.stringify({
        model: options.model,
        messages: this.normalizeMessages(messages),
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        stream: true,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      callbacks.onError(new Error(`OpenAI API error: ${response.status} - ${error}`))
      return
    }

    const reader = response.body?.getReader()
    if (!reader) {
      callbacks.onError(new Error('No response body'))
      return
    }

    const decoder = new TextDecoder()
    let fullText = ''
    let reasoningContent = ''
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === 'data: [DONE]') continue
          if (!trimmed.startsWith('data: ')) continue

          try {
            const json = JSON.parse(trimmed.slice(6))
            const content = json.choices?.[0]?.delta?.content
            if (content) {
              fullText += content
              callbacks.onToken(content)
            }

            const reasoningDelta = json.choices?.[0]?.delta?.reasoning_content
            if (reasoningDelta) {
              reasoningContent += reasoningDelta
              callbacks.onReasoningToken?.(reasoningDelta)
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      callbacks.onComplete(fullText)
    } catch (e: any) {
      callbacks.onError(e)
    }
  }

  async streamWithTools(messages: ChatMessage[], options: ChatOptions, tools: ToolDefinition[], callbacks: StreamWithToolsCallbacks, toolOptions?: ToolCallOptions): Promise<void> {
    const url = `${this.buildBaseUrl(options)}/chat/completions`
    const body: Record<string, unknown> = {
      model: options.model,
      messages: this.normalizeMessages(messages),
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      stream: true,
      tools: tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
    }
    if (toolOptions && Object.prototype.hasOwnProperty.call(toolOptions, 'toolChoice') && toolOptions.toolChoice !== undefined) {
      body.tool_choice = toolOptions.toolChoice
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(options),
      signal: options.signal,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      callbacks.onError(new Error(`OpenAI API error: ${response.status} - ${error}`))
      return
    }

    const reader = response.body?.getReader()
    if (!reader) {
      callbacks.onError(new Error('No response body'))
      return
    }

    const decoder = new TextDecoder()
    let fullText = ''
    let reasoningContent = ''
    let buffer = ''
    const accumulatedToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map()
    let finishReason: 'stop' | 'tool_calls' | 'length' = 'stop'

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === 'data: [DONE]') continue
          if (!trimmed.startsWith('data: ')) continue

          try {
            const json = JSON.parse(trimmed.slice(6))
            const choice = json.choices?.[0]
            const delta = choice?.delta

            if (choice?.finish_reason) {
              finishReason = choice.finish_reason === 'tool_calls' ? 'tool_calls' : choice.finish_reason === 'length' ? 'length' : 'stop'
            }

            if (delta?.content) {
              fullText += delta.content
              callbacks.onToken(delta.content)
            }

            if (delta?.reasoning_content) {
              reasoningContent += delta.reasoning_content
              callbacks.onReasoningToken?.(delta.reasoning_content)
            }

            if (delta?.tool_calls) {
              for (const toolCallDelta of delta.tool_calls) {
                const idx = toolCallDelta.index
                if (idx !== undefined) {
                  const isNew = !accumulatedToolCalls.has(idx)
                  if (isNew) {
                    accumulatedToolCalls.set(idx, {
                      id: toolCallDelta.id || '',
                      name: toolCallDelta.function?.name || '',
                      arguments: '',
                    })
                  }
                  const current = accumulatedToolCalls.get(idx)!
                  if (toolCallDelta.id) current.id = toolCallDelta.id
                  if (toolCallDelta.function?.name) current.name = toolCallDelta.function.name
                  if (toolCallDelta.function?.arguments) {
                    current.arguments += toolCallDelta.function.arguments
                  }

                  // If it's the first time we see the name, notify the UI
                  if (isNew && current.name) {
                    callbacks.onToolCall({
                      id: current.id,
                      name: current.name,
                      arguments: {}, // Partial arguments not available as object yet
                    })
                  }
                }
              }
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      // Parse accumulated arguments
      const finalToolCalls: ToolCall[] = []
      for (const [, atc] of accumulatedToolCalls) {
        if (atc.id && atc.name) {
          let parsedArgs = {}
          try {
            parsedArgs = typeof atc.arguments === 'string' ? JSON.parse(atc.arguments) : atc.arguments
          } catch (e) {
            console.error('Failed to parse tool call arguments:', e)
          }
          finalToolCalls.push({
            id: atc.id,
            name: atc.name,
            arguments: parsedArgs,
          })
        }
      }

      const result: FunctionCallingResponse = {
        content: fullText || null,
        reasoning_content: reasoningContent || null,
        tool_calls: finalToolCalls,
        finish_reason: finishReason,
      }

      callbacks.onComplete(result)
    } catch (e: any) {
      callbacks.onError(e)
    }
  }
}
