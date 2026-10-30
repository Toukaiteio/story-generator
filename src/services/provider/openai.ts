import type { ChatMessage } from '@/types/provider'
import type { ProviderAdapter, ChatOptions, StreamCallbacks, FunctionCallingResponse, StreamWithToolsCallbacks, ToolCallOptions } from './types'
import type { ToolDefinition, ToolCall } from './tools'
import { providerFetch } from './transport'
import {
  appendToolArgumentFragment,
  createToolArgumentsBuffer,
  finalizeToolArguments,
  isArgumentObject,
  type ToolArgumentsBuffer,
} from './toolArgs'

type OpenAIToolCallAccumulator = ToolArgumentsBuffer & {
  id: string
  name: string
}

function readToolArgumentFragment(source: any): unknown {
  const candidates = [
    source?.function?.arguments,
    source?.arguments,
    source?.function?.parameters,
    source?.parameters,
    source?.function?.input,
    source?.input,
  ]
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
    const response = await providerFetch(url, {
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
    const response = await providerFetch(url, {
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
        const argumentValue = readToolArgumentFragment(toolCall)
        const rawArguments = typeof argumentValue === 'string'
          ? argumentValue.trim()
          : ''
        const parsed = rawArguments ? JSON.parse(rawArguments) : argumentValue ?? {}
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error(`Tool ${toolCall.function?.name || toolCall.name || 'unknown'} arguments must be a JSON object`)
        }
        toolCalls.push({
          id: toolCall.id || `tool-call-${toolCalls.length + 1}`,
          name: toolCall.function?.name || toolCall.name || '',
          arguments: parsed as Record<string, any>,
        })
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
    const response = await providerFetch(url, {
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
    const response = await providerFetch(url, {
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
    const accumulatedToolCalls: Map<number, OpenAIToolCallAccumulator> = new Map()
    let finishReason: 'stop' | 'tool_calls' | 'length' = 'stop'
    let outputLimitReached = false
    let lastToolCallIndex: number | null = null

    const resolveToolCallIndex = (toolCall: any): number => {
      const numericIndex = Number(toolCall?.index)
      if (Number.isInteger(numericIndex) && numericIndex >= 0) {
        lastToolCallIndex = numericIndex
        return numericIndex
      }

      const id = typeof toolCall?.id === 'string' ? toolCall.id : ''
      if (id) {
        for (const [index, existing] of accumulatedToolCalls) {
          if (existing.id === id) {
            lastToolCallIndex = index
            return index
          }
        }
      }

      const name = typeof toolCall?.function?.name === 'string'
        ? toolCall.function.name
        : typeof toolCall?.name === 'string'
          ? toolCall.name
          : ''
      if (!id && name) {
        for (const [index, existing] of accumulatedToolCalls) {
          if (existing.name === name) {
            lastToolCallIndex = index
            return index
          }
        }
      }

      const fallbackIndex = lastToolCallIndex ?? accumulatedToolCalls.size
      lastToolCallIndex = fallbackIndex
      return fallbackIndex
    }

    const appendToolCallDelta = (toolCallDelta: any) => {
      const idx = resolveToolCallIndex(toolCallDelta)
      if (!accumulatedToolCalls.has(idx)) {
        accumulatedToolCalls.set(idx, {
          id: '',
          name: '',
          ...createToolArgumentsBuffer(),
        })
      }

      const current = accumulatedToolCalls.get(idx)!
      if (toolCallDelta?.id) current.id = String(toolCallDelta.id)
      if (toolCallDelta?.function?.name) current.name = String(toolCallDelta.function.name)
      if (toolCallDelta?.name) current.name = String(toolCallDelta.name)
      appendToolArgumentFragment(current, readToolArgumentFragment(toolCallDelta))
    }

    const processLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed === 'data: [DONE]') return
      if (!trimmed.startsWith('data: ')) return

      try {
        const json = JSON.parse(trimmed.slice(6))
        const choice = json.choices?.[0]
        const delta = choice?.delta

        if (choice?.finish_reason) {
          finishReason = choice.finish_reason === 'tool_calls' ? 'tool_calls' : choice.finish_reason === 'length' ? 'length' : 'stop'
          outputLimitReached = finishReason === 'length'
        }

        if (delta?.content) {
          fullText += delta.content
          callbacks.onToken(delta.content)
        }

        if (delta?.reasoning_content) {
          reasoningContent += delta.reasoning_content
          callbacks.onReasoningToken?.(delta.reasoning_content)
        }

        if (Array.isArray(delta?.tool_calls)) {
          for (const toolCallDelta of delta.tool_calls) appendToolCallDelta(toolCallDelta)
        }

        // Some OpenAI-compatible relays omit tool_calls[].index on continuation
        // chunks or still emit the legacy function_call shape.
        if (delta?.function_call) appendToolCallDelta(delta.function_call)

        // A few relays put a complete tool call on message instead of delta in
        // the final SSE frame. Merge it into the same accumulator as well.
        if (Array.isArray(choice?.message?.tool_calls)) {
          for (const toolCall of choice.message.tool_calls) appendToolCallDelta(toolCall)
        }
        if (choice?.message?.function_call) appendToolCallDelta(choice.message.function_call)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(`Invalid OpenAI tool stream event: ${reason}`)
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) processLine(line)
      }

      // Some compatible endpoints do not terminate their final SSE frame with
      // a newline. Flush both the decoder and the final buffered frame.
      buffer += decoder.decode()
      for (const line of buffer.split('\n')) processLine(line)

      // Parse accumulated arguments
      const finalToolCalls: ToolCall[] = []
      for (const [, atc] of accumulatedToolCalls) {
        if (atc.id && atc.name) {
          let parsedArgs: Record<string, any> = {}
          const finalArguments = finalizeToolArguments(atc)
          const rawArguments = (finalArguments
            ?? (atc.argumentsText + atc.stringTail)).trim()
          try {
            const parsed = rawArguments ? JSON.parse(rawArguments) : {}
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              throw new Error('Tool arguments must be a JSON object')
            }
            parsedArgs = parsed as Record<string, any>
          } catch (e) {
            const reason = e instanceof Error ? e.message : String(e)
            const lengthHint = outputLimitReached
              ? ' The provider stopped at the output token limit, so the tool arguments may be incomplete. Use a section edit or a model with a larger output limit.'
              : ''
            throw new Error(`Failed to parse arguments for tool ${atc.name}: ${reason}.${lengthHint}`)
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
