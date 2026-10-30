import type { ChatMessage, ProviderModelRef } from '@/types/provider'
import type { AgentType } from '@/types/agent'
import type { ToolDefinition, ToolCall, ToolResult } from '@/services/provider/tools'
import { injectCustomSystemPrompt } from '@/services/systemPrompt'
import { useProviderStore } from '@/stores/provider'
import { requestToolContinuation } from './toolContinuation'
import { getTodoListTool, handleTodoListToolCall, isTodoListTool } from './todolist'
import { KNOWLEDGE_TOOL_NAME, getKnowledgeTool, handleKnowledgeToolCall } from './knowledgeTool'
import type { KnowledgeBase } from '@/types/knowledge'
import { runPiAgent } from './piRuntime'

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
  protected maxTokens = 4096
  protected temperature = 0.7
  protected contextTokens: number | null = null

  protected getValidationRetryLimit(): number { return 1 }

  protected validateOutput(_response: string, _parsed: any, _context: Record<string, any>): string[] { return [] }

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

  protected getTools(): ToolDefinition[] { return [] }

  protected shouldStopAfterToolCallRound(_context: Record<string, any>): boolean { return false }

  protected shouldStreamToolProgress(_context: Record<string, any>): boolean { return true }

  protected getToolResultContent(_context: Record<string, any>): string | null { return null }

  protected getToolProgressKey(_context: Record<string, any>): string | null { return null }

  protected getFinalToolNames(_context: Record<string, any>): string[] { return [] }

  protected async handleToolCall(toolCall: ToolCall, _context: Record<string, any>): Promise<ToolResult> {
    throw new Error(`Tool call not implemented: ${toolCall.name}`)
  }

  setModel(model: ProviderModelRef | null, maxTokens?: number, temperature?: number, contextTokens?: number | null) {
    this.model = model
    if (maxTokens) this.maxTokens = maxTokens
    if (temperature !== undefined) this.temperature = temperature
    if (contextTokens !== undefined) this.contextTokens = contextTokens
  }

  protected getCompressionReport(): Pick<AgentResult, 'compressed' | 'compressionDetails'> {
    return { compressed: this._lastCompressed, compressionDetails: this._lastCompressionDetails }
  }

  private _lastCompressed = false
  private _lastCompressionDetails?: { compressedCount: number; savedTokens: number }

  private prepareMessages(context: Record<string, any>, userPrompt?: string): ChatMessage[] {
    this._lastCompressed = false
    this._lastCompressionDetails = undefined
    return [
      { role: 'system', content: injectCustomSystemPrompt(this.withBaseToolInstructions(this.getSystemPrompt())) },
      { role: 'user', content: userPrompt ?? this.buildPrompt(context) },
    ]
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
    const bases: KnowledgeBase[] = Array.isArray(context.knowledgeBases) ? context.knowledgeBases : []
    const knowledgeTools = bases.length > 0 ? [getKnowledgeTool(bases)] : []
    const seen = new Set<string>()
    return [getTodoListTool(), ...knowledgeTools, ...tools].filter(tool => {
      if (seen.has(tool.name)) return false
      seen.add(tool.name)
      return true
    })
  }

  async execute(context: Record<string, any>, onToken?: (token: string) => void): Promise<AgentResult> {
    if (!this.model) throw new Error(`${this.name} has no model assigned`)

    const tools = this.getAvailableTools(this.getTools(), context)
    const retryLimit = this.getValidationRetryLimit()
    let previousResponse = ''
    let lastIssues: string[] = []

    for (let attempt = 0; attempt <= retryLimit; attempt++) {
      const userPrompt = attempt === 0
        ? this.buildPrompt(context)
        : this.buildRepairPrompt(context, previousResponse, lastIssues)
      const messages = this.prepareMessages(context, userPrompt)
      const temperature = attempt === 0 ? this.temperature : Math.min(this.temperature, 0.2)
      const result = await this.executeWithPiAgent(messages, tools, context, onToken, temperature)
      previousResponse = result.content

      let parsed: any = result.content
      let issues: string[] = []
      try {
        parsed = this.parseResponse(result.content)
      } catch (error: any) {
        issues = [error?.message || 'Failed to parse agent response']
      }
      if (!issues.length) issues = this.validateOutput(result.content, parsed, context)
      if (!issues.length) {
        return {
          content: result.content,
          tokenUsage: { prompt: 0, completion: 0 },
          compressed: this._lastCompressed,
          compressionDetails: this._lastCompressionDetails,
          tool_calls: result.toolCalls.length ? result.toolCalls : undefined,
          data: this.getStructuredResult(context),
        }
      }
      lastIssues = issues
    }

    throw new Error(`${this.name} output failed validation: ${lastIssues.join('; ')}`)
  }

  private async executeWithPiAgent(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    context: Record<string, any>,
    onToken?: (token: string) => void,
    temperature = this.temperature
  ): Promise<{ content: string; toolCalls: ToolCall[] }> {
    if (!this.model) throw new Error(`${this.name} has no model assigned`)
    const streamToolProgress = this.shouldStreamToolProgress(context)
    let lastStreamedToolContent = ''
    const availableTools = this.getAvailableTools(tools, context)
    const providerStore = useProviderStore()
    const result = await runPiAgent({
      modelRef: this.model,
      messages,
      tools: availableTools,
      maxTokens: this.maxTokens,
      temperature,
      contextTokens: this.contextTokens,
      executeTool: async toolCall => {
        const bases: KnowledgeBase[] = Array.isArray(context.knowledgeBases) ? context.knowledgeBases : []
        try {
          return isTodoListTool(toolCall.name)
            ? await handleTodoListToolCall(toolCall, context, this.name)
            : toolCall.name === KNOWLEDGE_TOOL_NAME
              ? await handleKnowledgeToolCall(toolCall, bases)
              : await this.handleToolCall(toolCall, context)
        } catch (error: any) {
          return { tool_call_id: toolCall.id, content: `Error: ${error?.message || String(error)}` }
        }
      },
      onToken: token => onToken?.(token),
      onToolStatus: status => {
        if (!onToken || !streamToolProgress) return
        if (status.status === 'running') {
          onToken(`\n[Agent using tool: ${status.name}...]\n`)
        } else if (status.result) {
          const call: ToolCall = { id: status.callId, name: status.name, arguments: status.args ?? {} }
          onToken(`\n${this.formatToolResultSummary(call, status.result, context)}\n`)
        }
        const current = this.getToolResultContent(context)
        if (typeof current === 'string' && current.length > lastStreamedToolContent.length) {
          const delta = current.slice(lastStreamedToolContent.length)
          if (delta) onToken(delta)
          lastStreamedToolContent = current
        } else if (typeof current === 'string') {
          lastStreamedToolContent = current
        }
      },
      streamAssistantText: () => streamToolProgress && this.getFinalToolNames(context).length === 0,
      finalToolNames: () => this.getFinalToolNames(context),
      stopAfterToolCallRound: () => this.shouldStopAfterToolCallRound(context),
      getToolResultContent: () => this.getToolResultContent(context),
      workflowName: this.name,
      maxRounds: providerStore.toolWorkflowSettings.maxToolCallRounds,
      requestContinuation: request => requestToolContinuation(request),
    })

    this._lastCompressed = result.compression.compressed
    this._lastCompressionDetails = result.compression.compressed
      ? { compressedCount: result.compression.compressedGroups, savedTokens: result.compression.savedTokens }
      : undefined
    return { content: result.content, toolCalls: result.toolCalls }
  }

  /**
   * Compatibility entry point for agents with a custom multi-step execute
   * method. The implementation is still centralized in Pi Agent Core.
   */
  protected async executeWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    context: Record<string, any>,
    onToken?: (token: string) => void,
    temperature?: number
  ): Promise<{ content: string; toolCalls: ToolCall[] }> {
    return this.executeWithPiAgent(messages, tools, context, onToken, temperature ?? this.temperature)
  }

  async executeStreaming(context: Record<string, any>, onToken: (token: string) => void): Promise<AgentResult> {
    if (!this.model) throw new Error(`${this.name} has no model assigned`)
    const result = await this.executeWithPiAgent(
      this.prepareMessages(context),
      this.getAvailableTools(this.getTools(), context),
      context,
      onToken,
      this.temperature
    )
    return {
      content: result.content,
      tokenUsage: { prompt: 0, completion: 0 },
      compressed: this._lastCompressed,
      compressionDetails: this._lastCompressionDetails,
      tool_calls: result.toolCalls.length ? result.toolCalls : undefined,
      data: this.getStructuredResult(context),
    }
  }

  protected getStructuredResult(_context: Record<string, any>): any { return undefined }

  protected formatToolResultSummary(toolCall: ToolCall, result: ToolResult, context: Record<string, any> = {}): string {
    const status = result.content.includes('error') ? 'failed' : 'completed'
    let summary = `[Tool ${toolCall.name} ${status}]`
    if (toolCall.name === 'create_story_outline') {
      const title = toolCall.arguments.title || 'Untitled'
      const outline = toolCall.arguments.outline || ''
      summary = `### Generated Story Outline: ${title}\n\n${outline}\n\n[Outline saved successfully]`
    } else if (toolCall.name === 'create_characters') {
      const chars = toolCall.arguments.characters || []
      const charNames = chars.map((character: any) => character.name).join(', ')
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
        summary = '[Chapter written successfully]'
      }
    }
    return summary
  }
}
