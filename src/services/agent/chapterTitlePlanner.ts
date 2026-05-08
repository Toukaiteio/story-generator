import { BaseAgent, type AgentResult } from './base'
import type { AgentType } from '@/types/agent'
import type { ToolDefinition, ToolCall, ToolResult } from '@/services/provider/tools'

export class ChapterTitlePlannerExpert extends BaseAgent {
  type: AgentType = 'chapterTitlePlanner' as AgentType
  name = 'Chapter Title Planner'

  protected getValidationRetryLimit(): number {
    return 2
  }

  protected getTools(): ToolDefinition[] {
    return [
      {
        name: 'create_chapter_titles',
        description: 'Create the initial chapter titles and objectives for the story.',
        parameters: {
          type: 'object',
          properties: {
            chapterCount: {
              type: 'number',
              description: 'The estimated total number of chapters based on the target length and story outline.',
            },
            chapters: {
              type: 'array',
              description: 'The list of chapters with their titles and main objectives.',
              items: {
                type: 'object',
                properties: {
                  chapterNumber: { type: 'number' },
                  title: { type: 'string' },
                  objective: { type: 'string' },
                },
                required: ['chapterNumber', 'title', 'objective'],
              },
            },
          },
          required: ['chapterCount', 'chapters'],
        },
      },
    ]
  }

  protected async handleToolCall(toolCall: ToolCall, context: Record<string, any>): Promise<ToolResult> {
    if (toolCall.name === 'create_chapter_titles') {
      const { chapterCount, chapters } = toolCall.arguments

      if (!chapterCount || !Array.isArray(chapters) || chapters.length !== chapterCount) {
        return {
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: 'chapters array length must match chapterCount' }),
        }
      }

      context._chapterTitlesData = { chapterCount, chapters }

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

  protected shouldStopAfterToolCallRound(context: Record<string, any>): boolean {
    return Array.isArray(context._chapterTitlesData?.chapters) && context._chapterTitlesData.chapters.length > 0
  }

  protected getToolResultContent(context: Record<string, any>): string | null {
    return context._chapterTitlesData ? JSON.stringify(context._chapterTitlesData) : null
  }

  protected getSystemPrompt(): string {
    return `You are an expert story structurer.
Your job is to estimate the optimal number of chapters for the story based on the requested length, theme, genre, and outline, and then generate the titles and brief objectives for each chapter.
Use the create_chapter_titles tool to output your plan.`
  }

  protected buildPrompt(context: Record<string, any>): string {
    const {
      theme,
      genre,
      targetReader,
      language,
      length,
      storyOutline,
    } = context

    let lengthGuidance = '8-12 chapters'
    if (length === 'short') lengthGuidance = '3-5 chapters'
    else if (length === 'medium') lengthGuidance = '7-10 chapters'
    else if (length === 'long') lengthGuidance = '15-20 chapters'

    return `Estimate the number of chapters and create the chapter titles.

Theme: ${theme}
Genre: ${genre}
Target Reader: ${targetReader}
Language: ${language || 'English'}
Requested Length: ${length} (Suggest: ${lengthGuidance})

Story Outline:
${storyOutline}

Analyze the story outline and pacing, decide on the appropriate chapter count, and then use the create_chapter_titles tool to output the sequence of chapters.`
  }

  protected validateOutput(response: string, parsed: any, context: Record<string, any>): string[] {
    const issues: string[] = []
    
    if (!context._chapterTitlesData) {
      issues.push('Must use create_chapter_titles tool to output the chapter plan.')
    }

    return issues
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

      if (context._chapterTitlesData) {
        return {
          content: JSON.stringify(context._chapterTitlesData),
          tokenUsage: { prompt: 0, completion: 0 },
          compressed: false,
        }
      }

      previousResponse = result.content
      lastIssues = this.validateOutput(result.content, null, context)
    }

    throw new Error(`Failed to generate chapter titles: ${lastIssues.join('; ')}`)
  }

  parseResponse(response: string): any {
    return { raw: response }
  }
}
