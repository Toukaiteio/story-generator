import { BaseAgent, type AgentResult } from './base'
import type { AgentType } from '@/types/agent'
import type { ToolDefinition, ToolCall, ToolResult } from '@/services/provider/tools'
import { containsMetaCommentary } from './validation'

export class ChapterPlannerExpert extends BaseAgent {
  type: AgentType = 'chapterPlanner'
  name = 'Chapter Outline Planner'

  protected getValidationRetryLimit(): number {
    return 2
  }

  protected getTools(): ToolDefinition[] {
    return [
      {
        name: 'create_chapter_outline',
        description: 'Create the detailed outline for the specified chapter.',
        parameters: {
          type: 'object',
          properties: {
            conflict: {
              type: 'string',
              description: 'The main conflict in this chapter.',
            },
            keyEvents: {
              type: 'array',
              description: 'Key story beats for the chapter.',
              items: { type: 'string' },
            },
            characterActions: {
              type: 'array',
              description: 'Important character actions in the chapter.',
              items: { type: 'string' },
            },
            infoReveals: {
              type: 'array',
              description: 'Information revealed in the chapter.',
              items: { type: 'string' },
            },
            endingHook: {
              type: 'string',
              description: 'The chapter ending hook.',
            },
          },
          required: ['conflict', 'keyEvents', 'characterActions', 'infoReveals', 'endingHook'],
        },
      },
    ]
  }

  protected async handleToolCall(toolCall: ToolCall, context: Record<string, any>): Promise<ToolResult> {
    if (toolCall.name === 'create_chapter_outline') {
      const { conflict, keyEvents, characterActions, infoReveals, endingHook } = toolCall.arguments

      const issues: string[] = []
      if (!conflict) issues.push('conflict is required')
      if (!Array.isArray(keyEvents) || !keyEvents.length) issues.push('keyEvents must contain at least one entry')
      if (!Array.isArray(characterActions) || !characterActions.length) issues.push('characterActions must contain at least one entry')
      if (!Array.isArray(infoReveals) || !infoReveals.length) issues.push('infoReveals must contain at least one entry')
      if (!endingHook) issues.push('endingHook is required')

      if (issues.length) {
        return {
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: `Invalid arguments: ${issues.join('; ')}` }),
        }
      }

      // Merge with the title and objective that was passed in the context target
      context._chapterOutlineData = {
        chapterNumber: context.targetChapter.chapterNumber,
        title: context.targetChapter.title,
        objective: context.targetChapter.objective,
        conflict,
        keyEvents,
        characterActions,
        infoReveals,
        endingHook,
      }

      if (typeof context._onChapterOutlineUpdated === 'function') {
        await context._onChapterOutlineUpdated(context._chapterOutlineData)
      }

      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: true }),
      }
    }

    return {
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
    }
  }

  protected getSystemPrompt(): string {
    return `You are an expert chapter planner.
Your job is to create the detailed outline for a single specific chapter based on its given title and objective.
Use the create_chapter_outline tool to output the outline details.
Do not output JSON in the text message.`
  }

  protected buildPrompt(context: Record<string, any>): string {
    const {
      theme,
      genre,
      targetReader,
      language,
      style,
      knowledgeContext,
      storyOutline,
      characters,
      existingChapters,
      targetChapter,
      chapterCount,
    } = context

    return `Create the detailed outline for Chapter ${targetChapter.chapterNumber} out of ${chapterCount}.

Chapter Title: ${targetChapter.title}
Chapter Objective: ${targetChapter.objective}

Story context:
Theme: ${theme}
Genre: ${genre}
Language: ${language || 'English'}
Style: ${style || 'Appropriate for genre'}

Overall Story Outline:
${storyOutline}

Characters:
${characters || 'None'}

Previously Planned Chapters:
${existingChapters ? existingChapters : 'This is the first chapter.'}
${knowledgeContext ? `\nReference material:\n${knowledgeContext}\n` : ''}

Use the create_chapter_outline tool to define the conflict, keyEvents, characterActions, infoReveals, and endingHook for THIS chapter ONLY.`
  }

  protected validateOutput(response: string, parsed: any, context: Record<string, any>): string[] {
    const issues: string[] = []
    
    if (!context._chapterOutlineData) {
      issues.push('Must use the create_chapter_outline tool to output the details.')
    }

    return issues
  }

  protected shouldStopAfterToolCallRound(context: Record<string, any>): boolean {
    return Boolean(context._chapterOutlineData)
  }

  protected getToolResultContent(context: Record<string, any>): string | null {
    return context._chapterOutlineData ? JSON.stringify(context._chapterOutlineData) : null
  }

  protected getFinalToolNames(_context: Record<string, any>): string[] {
    return ['create_chapter_outline']
  }

  async execute(context: Record<string, any>, onToken?: (token: string) => void): Promise<AgentResult> {
    if (!this.model) throw new Error(`${this.name} has no model assigned`)

    const retryLimit = this.getValidationRetryLimit()
    let previousResponse = ''
    let lastIssues: string[] = []

    for (let attempt = 0; attempt <= retryLimit; attempt++) {
      const userPrompt = attempt === 0
        ? this.buildPrompt(context)
        : `The previous response was invalid. Issues:\n${lastIssues.join('\n')}\nPlease try again using the tool.`

      const messages = [
        { role: 'system' as const, content: this.getSystemPrompt() },
        { role: 'user' as const, content: userPrompt },
      ]

      const result = await this.executeWithTools(
        messages,
        this.getTools(),
        context,
        onToken,
        this.temperature
      )

      if (context._chapterOutlineData) {
        return {
          content: JSON.stringify(context._chapterOutlineData),
          tokenUsage: { prompt: 0, completion: 0 },
          compressed: false,
        }
      }

      previousResponse = result.content
      lastIssues = this.validateOutput(result.content, null, context)
    }

    throw new Error(`Failed to generate chapter outline for chapter ${context.targetChapter.chapterNumber}: ${lastIssues.join('; ')}`)
  }

  parseResponse(response: string): any {
    return { raw: response }
  }
}
