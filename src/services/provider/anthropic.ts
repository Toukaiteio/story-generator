import Anthropic from '@anthropic-ai/sdk'
import type AnthropicSDK from '@anthropic-ai/sdk'
import type { ChatMessage } from '@/types/provider'
import type { ProviderAdapter, ChatOptions, StreamCallbacks, FunctionCallingResponse, StreamWithToolsCallbacks, ToolCallOptions } from './types'
import type { ToolDefinition, ToolCall } from './tools'

export class AnthropicAdapter implements ProviderAdapter {
  private getClient(options: ChatOptions): Anthropic {
    return new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
    })
  }

  private buildToolChoice(toolOptions?: ToolCallOptions): AnthropicSDK.ToolChoice | undefined {
    const choice = toolOptions?.toolChoice
    if (!choice || choice === 'auto') return { type: 'auto' }
    if (choice === 'none') return { type: 'none' }
    return { type: 'tool', name: choice.function.name }
  }

  private buildSystem(messages: ChatMessage[]): string | undefined {
    const systemMsg = messages.find(m => m.role === 'system')
    return systemMsg?.content ?? undefined
  }

  private buildMessages(messages: ChatMessage[]): AnthropicSDK.MessageParam[] {
    return messages
      .filter(m => m.role !== 'system')
      .map(m => {
        if (m.role === 'tool') {
          return {
            role: 'user' as const,
            content: [{
              type: 'tool_result' as const,
              tool_use_id: m.tool_call_id ?? '',
              content: m.content ?? '',
            }],
          }
        }
        if (m.role === 'assistant' && m.tool_calls?.length) {
          const content: AnthropicSDK.ContentBlockParam[] = []
          if (m.content) {
            content.push({ type: 'text' as const, text: m.content })
          }
          for (const tc of m.tool_calls) {
            content.push({
              type: 'tool_use' as const,
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
            })
          }
          return { role: 'assistant' as const, content }
        }
        return {
          role: m.role as 'user' | 'assistant',
          content: m.content ?? '',
        }
      })
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<string> {
    const client = this.getClient(options)

    const response = await client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      system: this.buildSystem(messages),
      messages: this.buildMessages(messages),
    })

    const block = response.content[0]
    return block?.type === 'text' ? block.text : ''
  }

  async chatWithTools(messages: ChatMessage[], options: ChatOptions, tools: ToolDefinition[], toolOptions?: ToolCallOptions): Promise<FunctionCallingResponse> {
    const client = this.getClient(options)

    const response = await client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      system: this.buildSystem(messages),
      messages: this.buildMessages(messages),
      tools: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      })),
      tool_choice: this.buildToolChoice(toolOptions),
    })

    const toolCalls: ToolCall[] = []
    let content: string | null = null

    for (const block of response.content) {
      if (block.type === 'text') {
        content = block.text
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, any>,
        })
      }
    }

    return {
      content,
      tool_calls: toolCalls,
      finish_reason: response.stop_reason === 'tool_use' ? 'tool_calls' : response.stop_reason === 'max_tokens' ? 'length' : 'stop',
    }
  }

  async stream(messages: ChatMessage[], options: ChatOptions, callbacks: StreamCallbacks): Promise<void> {
    const client = this.getClient(options)

    try {
      const stream = await client.messages.create({
        model: options.model,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        system: this.buildSystem(messages),
        messages: this.buildMessages(messages),
        stream: true,
      }, {
        signal: options.signal,
      })

      let fullText = ''
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          fullText += chunk.delta.text
          callbacks.onToken(chunk.delta.text)
        }
      }

      callbacks.onComplete(fullText)
    } catch (e: unknown) {
      callbacks.onError(e instanceof Error ? e : new Error(String(e)))
    }
  }

  async streamWithTools(messages: ChatMessage[], options: ChatOptions, tools: ToolDefinition[], callbacks: StreamWithToolsCallbacks, toolOptions?: ToolCallOptions): Promise<void> {
    const client = this.getClient(options)

    try {
      const stream = client.messages.stream({
        model: options.model,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        system: this.buildSystem(messages),
        messages: this.buildMessages(messages),
        tools: tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        })),
        tool_choice: this.buildToolChoice(toolOptions),
      }, {
        signal: options.signal,
      })

      stream.on('text', (text) => {
        callbacks.onToken(text)
      })

      stream.on('streamEvent', (event) => {
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          callbacks.onToolCall({
            id: event.content_block.id,
            name: event.content_block.name,
            arguments: {},
          })
        }
      })

      stream.on('message', (message) => {
        const toolCalls: ToolCall[] = []
        let content: string | null = null

        for (const block of message.content) {
          if (block.type === 'text') {
            content = block.text
          } else if (block.type === 'tool_use') {
            const toolCall: ToolCall = {
              id: block.id,
              name: block.name,
              arguments: block.input as Record<string, any>,
            }
            toolCalls.push(toolCall)
          }
        }

        callbacks.onComplete({
          content,
          tool_calls: toolCalls,
          finish_reason: message.stop_reason === 'tool_use' ? 'tool_calls' : message.stop_reason === 'max_tokens' ? 'length' : 'stop',
        })
      })

      stream.on('error', (error) => {
        callbacks.onError(error instanceof Error ? error : new Error(String(error)))
      })

      await stream.finalMessage()
    } catch (e: unknown) {
      callbacks.onError(e instanceof Error ? e : new Error(String(e)))
    }
  }
}
