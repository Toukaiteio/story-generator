import { GoogleGenAI } from '@google/genai'
import type { Content, Part, FunctionDeclaration, Tool, GenerateContentConfig } from '@google/genai'
import type { ChatMessage } from '@/types/provider'
import type { ProviderAdapter, ChatOptions, StreamCallbacks, FunctionCallingResponse, StreamWithToolsCallbacks, ToolCallOptions } from './types'
import type { ToolDefinition, ToolCall } from './tools'

export class GoogleAdapter implements ProviderAdapter {
  private getClient(options: ChatOptions): GoogleGenAI {
    return new GoogleGenAI({
      apiKey: options.apiKey,
      httpOptions: options.baseUrl ? { baseUrl: options.baseUrl } : undefined,
    })
  }

  private buildSystem(messages: ChatMessage[]): string | undefined {
    const systemMsg = messages.find(m => m.role === 'system')
    return systemMsg?.content ?? undefined
  }

  private buildContents(messages: ChatMessage[]): Content[] {
    const contents: Content[] = []

    for (const m of messages) {
      if (m.role === 'system') continue

      if (m.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              id: m.tool_call_id ?? '',
              name: '',
              response: { result: m.content ?? '' },
            },
          }],
        })
        continue
      }

      if (m.role === 'assistant' && m.tool_calls?.length) {
        const parts: Part[] = []
        if (m.content) {
          parts.push({ text: m.content })
        }
        for (const tc of m.tool_calls) {
          parts.push({
            functionCall: {
              id: tc.id,
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments) as Record<string, unknown>,
            },
          })
        }
        contents.push({ role: 'model', parts })
        continue
      }

      const role = m.role === 'assistant' ? 'model' : 'user'
      contents.push({
        role,
        parts: [{ text: m.content ?? '' }],
      })
    }

    return contents
  }

  private buildTools(tools: ToolDefinition[]): Tool[] {
    const declarations: FunctionDeclaration[] = tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>,
    }))
    return [{ functionDeclarations: declarations }]
  }

  private buildConfig(options: ChatOptions, messages: ChatMessage[], tools?: Tool[], toolOptions?: ToolCallOptions): GenerateContentConfig {
    const config: GenerateContentConfig = {
      maxOutputTokens: options.maxTokens,
      temperature: options.temperature,
    }

    const systemInstruction = this.buildSystem(messages)
    if (systemInstruction) {
      config.systemInstruction = systemInstruction
    }

    if (tools?.length) {
      config.tools = tools
    }

    const choice = toolOptions?.toolChoice
    if (choice && choice !== 'auto') {
      ;(config as any).toolConfig = {
        functionCallingConfig: choice === 'none'
          ? { mode: 'NONE' }
          : { mode: 'ANY', allowedFunctionNames: [choice.function.name] },
      }
    }

    return config
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<string> {
    const client = this.getClient(options)

    const response = await client.models.generateContent({
      model: options.model,
      contents: this.buildContents(messages),
      config: this.buildConfig(options, messages),
    })

    return response.text ?? ''
  }

  async chatWithTools(messages: ChatMessage[], options: ChatOptions, tools: ToolDefinition[], toolOptions?: ToolCallOptions): Promise<FunctionCallingResponse> {
    const client = this.getClient(options)
    const googleTools = this.buildTools(tools)

    const response = await client.models.generateContent({
      model: options.model,
      contents: this.buildContents(messages),
      config: this.buildConfig(options, messages, googleTools, toolOptions),
    })

    const toolCalls: ToolCall[] = []
    if (response.functionCalls) {
      for (const fc of response.functionCalls) {
        toolCalls.push({
          id: fc.id ?? `${fc.name}-${Date.now()}`,
          name: fc.name ?? '',
          arguments: (fc.args ?? {}) as Record<string, any>,
        })
      }
    }

    return {
      content: response.text ?? null,
      tool_calls: toolCalls,
      finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    }
  }

  async stream(messages: ChatMessage[], options: ChatOptions, callbacks: StreamCallbacks): Promise<void> {
    const client = this.getClient(options)

    try {
      const stream = await client.models.generateContentStream({
        model: options.model,
        contents: this.buildContents(messages),
        config: {
          ...this.buildConfig(options, messages),
          abortSignal: options.signal,
        },
      })

      let fullText = ''
      for await (const chunk of stream) {
        if (chunk.text) {
          fullText += chunk.text
          callbacks.onToken(chunk.text)
        }
      }

      callbacks.onComplete(fullText)
    } catch (e: unknown) {
      callbacks.onError(e instanceof Error ? e : new Error(String(e)))
    }
  }

  async streamWithTools(messages: ChatMessage[], options: ChatOptions, tools: ToolDefinition[], callbacks: StreamWithToolsCallbacks, toolOptions?: ToolCallOptions): Promise<void> {
    const client = this.getClient(options)
    const googleTools = this.buildTools(tools)

    try {
      const stream = await client.models.generateContentStream({
        model: options.model,
        contents: this.buildContents(messages),
        config: {
          ...this.buildConfig(options, messages, googleTools, toolOptions),
          abortSignal: options.signal,
        },
      })

      let fullText = ''
      const seenToolCalls = new Map<string, ToolCall>()

      for await (const chunk of stream) {
        if (chunk.text) {
          fullText += chunk.text
          callbacks.onToken(chunk.text)
        }

        if (chunk.functionCalls) {
          for (const fc of chunk.functionCalls) {
            const id = fc.id ?? `${fc.name}-${Date.now()}`
            if (!seenToolCalls.has(id)) {
              const toolCall: ToolCall = {
                id,
                name: fc.name ?? '',
                arguments: (fc.args ?? {}) as Record<string, any>,
              }
              seenToolCalls.set(id, toolCall)
              callbacks.onToolCall(toolCall)
            }
          }
        }
      }

      callbacks.onComplete({
        content: fullText || null,
        tool_calls: [...seenToolCalls.values()],
        finish_reason: seenToolCalls.size > 0 ? 'tool_calls' : 'stop',
      })
    } catch (e: unknown) {
      callbacks.onError(e instanceof Error ? e : new Error(String(e)))
    }
  }
}
