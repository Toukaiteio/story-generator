import type { ChatMessage } from '@/types/provider'
import type { ProviderModelRef } from '@/types/provider'
import type { AgentType } from '@/types/agent'
import type { ToolDefinition, ToolCall, ToolResult } from '@/services/provider/tools'
import { providerManager } from '@/services/provider'
import { fitMessagesToContextSmart, fitToContext } from '@/services/context'
import { injectCustomSystemPrompt } from '@/services/systemPrompt'
import { useProviderStore } from '@/stores/provider'
import type { FunctionCallingResponse } from '@/services/provider/types'
import { requestToolContinuation } from './toolContinuation'
import { getTodoListTool, handleTodoListToolCall, isTodoListTool } from './todolist'
import { KNOWLEDGE_TOOL_NAME, getKnowledgeTool, handleKnowledgeToolCall } from './knowledgeTool'
import type { KnowledgeBase } from '@/types/knowledge'

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
   * Controls whether tool-call rounds should be streamed to the UI.
   * Writers can disable this so the chapter only appears once the full
   * multi-round task is complete.
   */
  protected shouldStreamToolProgress(_context: Record<string, any>): boolean {
    return true
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

  protected getFinalToolNames(_context: Record<string, any>): string[] {
    return []
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

  protected getCompressionReport(): Pick<AgentResult, 'compressed' | 'compressionDetails'> {
    return {
      compressed: this._lastCompressed,
      compressionDetails: this._lastCompressionDetails,
    }
  }

  private prepareMessages(context: Record<string, any>, userPrompt?: string): ChatMessage[] {
    const raw: ChatMessage[] = [
      { role: 'system', content: injectCustomSystemPrompt(this.withBaseToolInstructions(this.getSystemPrompt())) },
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

  private withBaseToolInstructions(systemPrompt: string) {
    return `${systemPrompt}

Base tool available to every agent:
- When tools are available, prefer Function Calling first. Do not solve tool-eligible actions in plain assistant text.
- If any available tool can perform or report the requested work, call that tool instead of returning prose.
- For complex work with several dependent steps, use update_todolist to create a short checklist before acting and update it as progress is made.
- Keep only one item in_progress at a time. Mark completed work as done. Use blocked only when a real blocker prevents progress.
- The todolist is for task control, not user-facing prose; continue using the agent-specific final tool or final response required by the task.
- When a tool is the delivery channel for generated content or structured output, put that content only in the tool arguments. Do not duplicate the same content in assistant text before or after the tool call.`
  }

  private getAvailableTools(tools: ToolDefinition[], context: Record<string, any> = {}) {
    const bases: KnowledgeBase[] = Array.isArray(context.knowledgeBases) && context.knowledgeBases.length > 0
      ? context.knowledgeBases
      : []
    const knowledgeTools = bases.length > 0 ? [getKnowledgeTool(bases)] : []
    const seen = new Set<string>()
    return [getTodoListTool(), ...knowledgeTools, ...tools].filter(tool => {
      if (seen.has(tool.name)) return false
      seen.add(tool.name)
      return true
    })
  }

  private fitToolMessagesToContext(messages: ChatMessage[]): ChatMessage[] {
    const { messages: fittedMessages, compressed, details } = fitMessagesToContextSmart(
      messages,
      this.contextTokens,
      this.maxTokens,
      { threshold: 0.6, preserveRecentGroups: 4 }
    )

    if (compressed) {
      this._lastCompressed = true
      this._lastCompressionDetails = {
        compressedCount: (this._lastCompressionDetails?.compressedCount ?? 0) + details.compressedCount,
        savedTokens: (this._lastCompressionDetails?.savedTokens ?? 0) + details.savedTokens,
      }
    }

    return fittedMessages
  }

  private ensureBaseToolInstructions(messages: ChatMessage[]) {
    return messages.map((message, index) => {
      if (index !== 0 || message.role !== 'system' || !message.content) return message
      const content = message.content.includes('Base tool available to every agent:')
        ? message.content
        : this.withBaseToolInstructions(message.content)
      return { ...message, content: injectCustomSystemPrompt(content) }
    })
  }

  private _lastCompressed = false
  private _lastCompressionDetails?: { compressedCount: number; savedTokens: number }

  async execute(context: Record<string, any>, onToken?: (token: string) => void): Promise<AgentResult> {
    if (!this.model) {
      throw new Error(`${this.name} has no model assigned`)
    }

    const tools = this.getAvailableTools(this.getTools(), context)
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
    const currentMessages: any[] = [...this.ensureBaseToolInstructions(messages)]
    let lastProgressKey = this.getToolProgressKey(context)
    let stalledToolRounds = 0
    const maxStalledToolRounds = 3
    const streamToolProgress = this.shouldStreamToolProgress(context)
    let lastStreamedToolContent = ''
    let round = 0
    let totalRounds = 0
    let consecutiveNoToolRounds = 0
    let softLimitReached = false
    const providerStore = useProviderStore()
    const softToolRoundLimit = providerStore.toolWorkflowSettings.maxToolCallRounds
    const hardToolRoundLimit = Math.max(softToolRoundLimit * 4, softToolRoundLimit + 24)
    const maxConsecutiveNoToolRounds = 6
    const availableTools = this.getAvailableTools(tools, context)

    while (true) {
      const finalToolNames = this.getFinalToolNames(context)
      const streamAssistantText = streamToolProgress && finalToolNames.length === 0
      const forcedFinalTool = finalToolNames.length && consecutiveNoToolRounds >= 2
        ? finalToolNames[0]
        : null

      if (finalToolNames.length && !softLimitReached && totalRounds >= softToolRoundLimit - 1) {
        softLimitReached = true
        currentMessages.push({
          role: 'user',
          content: `Checkpoint: this tool workflow has used ${totalRounds + 1} rounds. Continue only if the next tool call materially advances the task. If you have enough information, call one of these final reporting/finalization tools now: ${finalToolNames.join(', ')}. If there are no findings or nothing to add, call the final tool with an empty result.`,
        })
      }

      let result: FunctionCallingResponse

      const outboundMessages = this.fitToolMessagesToContext(currentMessages)

      if (onToken) {
        // Use streaming for real-time feedback
        let roundContent = ''
        const roundToolCalls: ToolCall[] = []
        
        await providerManager.streamWithTools(
          outboundMessages,
          this.model,
          availableTools,
          {
            onToken: (token) => {
              roundContent += token
              if (streamAssistantText) {
                onToken(token)
              }
            },
            onToolCall: (toolCall) => {
              roundToolCalls.push(toolCall)
              if (streamToolProgress) {
                onToken(`\n[Agent using tool: ${toolCall.name}...]\n`)
              }
            },
            onToolResult: () => {}, // Handled manually below
            onComplete: (response) => {
              result = response
            },
            onError: (e) => { throw e },
          },
          this.maxTokens,
          temperature ?? this.temperature,
          forcedFinalTool
            ? { toolChoice: { type: 'function', function: { name: forcedFinalTool } } }
            : undefined
        )
        
        // result is populated by onComplete
        // @ts-ignore - result is assigned in onComplete
        if (!result) throw new Error('Stream failed to complete')
      } else {
        // Fallback to blocking chat
        result = await providerManager.chatWithTools(
          outboundMessages,
          this.model,
          availableTools,
          this.maxTokens,
          temperature ?? this.temperature,
          forcedFinalTool
            ? { toolChoice: { type: 'function', function: { name: forcedFinalTool } } }
            : undefined
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
        consecutiveNoToolRounds += 1
        const finalToolNames = this.getFinalToolNames(context)
        if (finalToolNames.length) {
          if (result.content?.trim() || result.reasoning_content?.trim()) {
            currentMessages.push({
              role: 'assistant',
              content: result.content?.trim() ? result.content : null,
              reasoning_content: result.reasoning_content?.trim() ? result.reasoning_content : null,
            })
          }
          currentMessages.push({
            role: 'user',
            content: consecutiveNoToolRounds >= 2
              ? `Your previous response still did not call a required final tool. The next request will force the tool choice where supported. Call ${finalToolNames[0]} now and put the result in its arguments.`
              : `Your previous response was invalid because it did not call a required final tool. Do not answer in text. Call one of these tools now: ${finalToolNames.join(', ')}. If there are no findings or nothing to add, call the final tool with an empty result.`,
          })

          round += 1
          totalRounds += 1
          if (consecutiveNoToolRounds >= maxConsecutiveNoToolRounds) {
            throw new Error(`${this.name} tool workflow stalled: the model did not call ${finalToolNames.join(' or ')} after ${consecutiveNoToolRounds} consecutive correction attempts.`)
          }

          if (totalRounds >= hardToolRoundLimit) {
            const shouldContinue = await requestToolContinuation({
              workflow: `${this.name}: ${finalToolNames.join(' / ')}`,
              rounds: totalRounds,
              finalToolNames,
            })

            if (!shouldContinue) {
              throw new Error(`${this.name} tool workflow stopped after ${totalRounds} rounds before calling ${finalToolNames.join(' or ')}.`)
            }

            round = 0
            totalRounds = 0
            softLimitReached = false
          }
          continue
        }

        break
      }

      allToolCalls.push(...result.tool_calls)
      consecutiveNoToolRounds = 0

      // Add assistant message with tool calls to conversation
      currentMessages.push({
        role: 'assistant',
        content: null,
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
          const bases: KnowledgeBase[] = Array.isArray(context.knowledgeBases) ? context.knowledgeBases : []
          const toolResult = isTodoListTool(toolCall.name)
            ? await handleTodoListToolCall(toolCall, context, this.name)
            : toolCall.name === KNOWLEDGE_TOOL_NAME
              ? await handleKnowledgeToolCall(toolCall, bases)
              : await this.handleToolCall(toolCall, context)
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult.content,
          })
          
          if (onToken && streamToolProgress) {
            const summary = this.formatToolResultSummary(toolCall, toolResult, context)
            onToken(`\n${summary}\n`)
          }

          if (onToken && streamToolProgress) {
            const currentToolContent = this.getToolResultContent(context)
            if (typeof currentToolContent === 'string' && currentToolContent.length > lastStreamedToolContent.length) {
              const delta = currentToolContent.slice(lastStreamedToolContent.length)
              if (delta) {
                onToken(delta)
              }
              lastStreamedToolContent = currentToolContent
            } else if (typeof currentToolContent === 'string') {
              lastStreamedToolContent = currentToolContent
            }
          }
        } catch (error: any) {
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Error: ${error.message}`,
          })
          
          if (onToken && streamToolProgress) {
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

      round += 1
      totalRounds += 1
      if (totalRounds >= hardToolRoundLimit) {
        const finalToolNames = this.getFinalToolNames(context)
        const shouldContinue = await requestToolContinuation({
          workflow: `${this.name}${finalToolNames.length ? `: ${finalToolNames.join(' / ')}` : ''}`,
          rounds: totalRounds,
          finalToolNames,
        })

        if (!shouldContinue) {
          throw new Error(`${this.name} tool workflow stopped after ${totalRounds} rounds${finalToolNames.length ? ` before calling ${finalToolNames.join(' or ')}` : ''}.`)
        }

        round = 0
        totalRounds = 0
        softLimitReached = false
        currentMessages.push({
          role: 'user',
          content: finalToolNames.length
            ? `Continue the tool workflow. Tool round counter has been reset. Prefer reporting/finalizing with ${finalToolNames.join(' or ')} as soon as you have enough information; only use more lookup tools if necessary.`
            : 'Continue the tool workflow. Tool round counter has been reset. Complete the task as soon as possible; only use more tools if necessary.',
        })
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

    const tools = this.getAvailableTools(this.getTools(), context)
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
  protected formatToolResultSummary(toolCall: ToolCall, result: ToolResult, context: Record<string, any> = {}): string {
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
      const chapterNumber = context.targetChapter?.chapterNumber ?? toolCall.arguments.chapterNumber ?? ''
      const title = context.targetChapter?.title || toolCall.arguments.title || 'Untitled'
      summary = `### Saved Chapter ${chapterNumber}: ${title}\n\n[Chapter outline saved successfully]`
    } else if (toolCall.name === 'update_todolist') {
      const items = Array.isArray(toolCall.arguments.items) ? toolCall.arguments.items : []
      const done = items.filter((item: any) => item?.status === 'done').length
      summary = `[Todo list updated: ${done}/${items.length} complete]`
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
