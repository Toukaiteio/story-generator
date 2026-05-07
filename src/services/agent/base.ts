import type { ChatMessage } from '@/types/provider'
import type { ProviderModelRef } from '@/types/provider'
import type { AgentType } from '@/types/agent'
import type { ToolDefinition, ToolCall, ToolResult } from '@/services/provider/tools'
import { providerManager } from '@/services/provider'
import { fitToContext } from '@/services/context'
import type { FunctionCallingResponse } from '@/services/provider/types'

export interface AgentResult {
  content: string
  tokenUsage: { prompt: number; completion: number }
  compressed: boolean
  compressionDetails?: { compressedCount: number; savedTokens: number }
  tool_calls?: ToolCall[]
  data?: any
}

export abstract class BaseAgent {
  abstract type: AgentType
  abstract name: string

  protected abstract getSystemPrompt(): string
  protected abstract buildPrompt(context: Record<string, any>): string
  protected abstract parseResponse(response: string): any

  protected model: ProviderModelRef | null = null
  protected maxTokens: number = 4096
  protected temperature: number = 0.7
  protected contextTokens: number | null = null

  protected getValidationRetryLimit(): number {
    return 1
  }

  protected validateOutput(_response: string, _parsed: any, _context: Record<string, any>): string[] {
    return []
  }

  protected buildRepairPrompt(context: Record<string, any>, previousResponse: string, issues: string[]): string {
    return `The previous response from ${this.name} failed validation.

Issues:
${issues.map(issue => `- ${issue}`).join('\n')}

Original task:
${this.buildPrompt(context)}

Previous response:
${previousResponse}

Return a corrected response only. Keep the original intent intact. Do not add markdown, commentary, or code fences.`
  }

  /**
   * Returns the list of tools available to this agent.
   * Override this in subclasses to provide agent-specific tools.
   */
  protected getTools(): ToolDefinition[] {
    return []
  }

  /**
   * Some agents use function calls as the final delivery channel. In that case,
   * there is no need to ask the model for a follow-up assistant message after a
   * successful tool call round.
   */
  protected shouldStopAfterToolCallRound(_context: Record<string, any>): boolean {
    return false
  }

  /**
   * Returns the textual content populated by tool calls, when the agent's output
   * should come from function arguments rather than a final assistant message.
   */
  protected getToolResultContent(_context: Record<string, any>): string | null {
    return null
  }

  /**
   * Returns a compact progress marker for long tool workflows. If the marker
   * does not change across tool rounds, the loop can stop as stalled instead
   * of relying on a fixed maximum number of tool calls.
   */
  protected getToolProgressKey(_context: Record<string, any>): string | null {
    return null
  }

  /**
   * Handles a tool call from the LLM.
   * Override this in subclasses to implement tool execution.
   */
  protected async handleToolCall(toolCall: ToolCall, context: Record<string, any>): Promise<ToolResult> {
    throw new Error(`Tool call not implemented: ${toolCall.name}`)
  }

  setModel(model: ProviderModelRef | null, maxTokens?: number, temperature?: number, contextTokens?: number | null) {
    this.model = model
    if (maxTokens) this.maxTokens = maxTokens
    if (temperature !== undefined) this.temperature = temperature
    if (contextTokens !== undefined) this.contextTokens = contextTokens
  }

  private prepareMessages(context: Record<string, any>, userPrompt?: string): ChatMessage[] {
    const raw: ChatMessage[] = [
      { role: 'system', content: this.getSystemPrompt() },
      { role: 'user', content: userPrompt ?? this.buildPrompt(context) },
    ]

    const { messages, compressed, details } = fitToContext(
      raw,
      this.contextTokens,
      this.maxTokens
    )

    // Attach compression info to the result via a side channel
    this._lastCompressed = compressed
    this._lastCompressionDetails = compressed
      ? { compressedCount: details.compressedCount, savedTokens: details.savedTokens }
      : undefined

    return messages
  }

  private _lastCompressed = false
  private _lastCompressionDetails?: { compressedCount: number; savedTokens: number }

  async execute(context: Record<string, any>, onToken?: (token: string) => void): Promise<AgentResult> {
    if (!this.model) {
      throw new Error(`${this.name} has no model assigned`)
    }

    const tools = this.getTools()
    const retryLimit = this.getValidationRetryLimit()
    let previousResponse = ''
    let lastIssues: string[] = []

    for (let attempt = 0; attempt <= retryLimit; attempt++) {
      const userPrompt = attempt === 0
        ? this.buildPrompt(context)
        : this.buildRepairPrompt(context, previousResponse, lastIssues)
      const messages = this.prepareMessages(context, userPrompt)
      const temperature = attempt === 0
        ? this.temperature
        : Math.min(this.temperature, 0.2)

      let content: string
      let toolCalls: ToolCall[] = []

      if (tools.length > 0) {
        // Use function calling if tools are available
        const result = await this.executeWithTools(messages, tools, context, onToken, temperature)
        content = result.content
        toolCalls = result.toolCalls
      } else if (onToken) {
        // Stream without tools
        let streamed = ''
        await providerManager.stream(messages, this.model, {
          onToken: (token) => {
            streamed += token
            onToken(token)
          },
          onComplete: (text) => { streamed = text },
          onError: (e) => { throw e },
        }, this.maxTokens, temperature)
        content = streamed
      } else {
        // Chat without tools
        content = await providerManager.chat(
          messages,
          this.model,
          this.maxTokens,
          temperature
        )
      }

      previousResponse = content

      let parsed: any = content
      let issues: string[] = []
      try {
        parsed = this.parseResponse(content)
      } catch (error: any) {
        issues = [error?.message || 'Failed to parse agent response']
      }

      if (!issues.length) {
        issues = this.validateOutput(content, parsed, context)
      }

      if (!issues.length) {
        return {
          content,
          tokenUsage: { prompt: 0, completion: 0 },
          compressed: this._lastCompressed,
          compressionDetails: this._lastCompressionDetails,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          data: this.getStructuredResult(context),
        }
      }

      lastIssues = issues
    }

    throw new Error(`${this.name} output failed validation: ${lastIssues.join('; ')}`)
  }

  protected async executeWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    context: Record<string, any>,
    onToken?: (token: string) => void,
    temperature?: number
  ): Promise<{ content: string; toolCalls: ToolCall[] }> {
    if (!this.model) {
      throw new Error(`${this.name} has no model assigned`)
    }

    const allToolCalls: ToolCall[] = []
    let finalContent = ''
    const currentMessages: any[] = [...messages]
    let lastProgressKey = this.getToolProgressKey(context)
    let stalledToolRounds = 0
    const maxStalledToolRounds = 3

    while (true) {
      let result: FunctionCallingResponse

      if (onToken) {
        // Use streaming for real-time feedback
        let roundContent = ''
        const roundToolCalls: ToolCall[] = []
        
        await providerManager.streamWithTools(
          currentMessages,
          this.model,
          tools,
          {
            onToken: (token) => {
              roundContent += token
              onToken(token)
            },
            onToolCall: (toolCall) => {
              roundToolCalls.push(toolCall)
              onToken(`\n[Agent using tool: ${toolCall.name}...]\n`)
            },
            onToolResult: () => {}, // Handled manually below
            onComplete: (response) => {
              result = response
            },
            onError: (e) => { throw e },
          },
          this.maxTokens,
          temperature ?? this.temperature
        )
        
        // result is populated by onComplete
        // @ts-ignore - result is assigned in onComplete
        if (!result) throw new Error('Stream failed to complete')
      } else {
        // Fallback to blocking chat
        result = await providerManager.chatWithTools(
          currentMessages,
          this.model,
          tools,
          this.maxTokens,
          temperature ?? this.temperature
        )
      }

      if (result.content) {
        finalContent = result.content
        if (!onToken) {
          // If not streaming, we only call onToken once at the end of the round if it exists
          // but usually onToken is only provided for streaming.
        }
      }

      if (result.tool_calls.length === 0) {
        // No more tool calls, we're done
        break
      }

      allToolCalls.push(...result.tool_calls)

      // Add assistant message with tool calls to conversation
      currentMessages.push({
        role: 'assistant',
        content: result.content || null,
        reasoning_content: result.reasoning_content ?? null,
        tool_calls: result.tool_calls.map((tc: ToolCall) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      })

      // Execute each tool call and add results
      for (const toolCall of result.tool_calls) {
        try {
          const toolResult = await this.handleToolCall(toolCall, context)
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult.content,
          })
          
          if (onToken) {
            const summary = this.formatToolResultSummary(toolCall, toolResult)
            onToken(`\n${summary}\n`)
          }
        } catch (error: any) {
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Error: ${error.message}`,
          })
          
          if (onToken) {
            onToken(`\n[Error in tool ${toolCall.name}: ${error.message}]\n`)
          }
        }
      }

      const nextProgressKey = this.getToolProgressKey(context)
      if (lastProgressKey !== null || nextProgressKey !== null) {
        if (nextProgressKey === lastProgressKey) {
          stalledToolRounds += 1
        } else {
          stalledToolRounds = 0
        }
        lastProgressKey = nextProgressKey

        if (stalledToolRounds >= maxStalledToolRounds) {
          throw new Error(`${this.name} tool workflow stalled without progress`)
        }
      }

      if (this.shouldStopAfterToolCallRound(context)) {
        finalContent = this.getToolResultContent(context) ?? finalContent
        break
      }

      // If we got a final content and no more tool calls, stop
      if (result.finish_reason === 'stop') {
        break
      }
    }

    return {
      content: finalContent,
      toolCalls: allToolCalls,
    }
  }

  async executeStreaming(
    context: Record<string, any>,
    onToken: (token: string) => void
  ): Promise<AgentResult> {
    if (!this.model) {
      throw new Error(`${this.name} has no model assigned`)
    }

    const tools = this.getTools()
    const messages = this.prepareMessages(context)
    let fullContent = ''
    let toolCalls: ToolCall[] = []

    if (tools.length > 0) {
      // Use function calling with streaming
      const result = await this.executeWithTools(messages, tools, context, onToken, this.temperature)
      fullContent = result.content
      toolCalls = result.toolCalls
    } else {
      // Stream without tools
      await providerManager.stream(messages, this.model, {
        onToken: (token) => {
          fullContent += token
          onToken(token)
        },
        onComplete: (text) => { fullContent = text },
        onError: (e) => { throw e },
      }, this.maxTokens, this.temperature)
    }

    return {
      content: fullContent,
      tokenUsage: { prompt: 0, completion: 0 },
      compressed: this._lastCompressed,
      compressionDetails: this._lastCompressionDetails,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      data: this.getStructuredResult(context),
    }
  }

  protected getStructuredResult(_context: Record<string, any>): any {
    return undefined
  }
  /**
   * Formats a human-readable summary of a tool execution for the stream
   */
  protected formatToolResultSummary(toolCall: ToolCall, result: ToolResult): string {
    const status = result.content.includes('error') ? 'failed' : 'completed'
    let summary = `[Tool ${toolCall.name} ${status}]`
    
    // Add specific details for common tools if needed
    if (toolCall.name === 'create_story_outline') {
      const title = toolCall.arguments.title || 'Untitled'
      const outline = toolCall.arguments.outline || ''
      summary = `### Generated Story Outline: ${title}\n\n${outline}\n\n[Outline saved successfully]`
    } else if (toolCall.name === 'create_characters') {
      const chars = toolCall.arguments.characters || []
      const charNames = chars.map((c: any) => c.name).join(', ')
      summary = `### Created ${chars.length} Characters\n\n**Names:** ${charNames}\n\n[Characters saved successfully]`
    } else if (toolCall.name === 'create_chapter_outline') {
      const chapterNumber = toolCall.arguments.chapterNumber ?? '?'
      const title = toolCall.arguments.title || 'Untitled'
      summary = `### Saved Chapter ${chapterNumber}: ${title}\n\n[Chapter outline saved successfully]`
    } else if (toolCall.name === 'finalize_chapter_plan') {
      summary = '[Chapter plan finalized]'
    } else if (toolCall.name === 'write_chapter') {
      try {
        const data = JSON.parse(result.content)
        summary = `[Chapter written: ~${data.wordCount || 0} words]`
      } catch {
        summary = `[Chapter written successfully]`
      }
    }
    
    return summary
  }
}
