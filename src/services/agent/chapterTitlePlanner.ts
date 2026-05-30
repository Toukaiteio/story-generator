import { BaseAgent, type AgentResult } from './base'
import type { AgentType } from '@/types/agent'
import type { ToolDefinition, ToolCall, ToolResult } from '@/services/provider/tools'
import { injectCustomSystemPrompt } from '@/services/systemPrompt'

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
            chapters: {
              type: 'array',
              description: 'The exact list of chapters with their titles and main objectives. The array length must match the requested chapter count.',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  objective: { type: 'string' },
                },
                required: ['title', 'objective'],
              },
            },
          },
          required: ['chapters'],
        },
      },
      {
        name: 'create_next_chapter_title',
        description: 'Create the title and objective for exactly one next chapter after the existing chapter plan.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            objective: { type: 'string' },
          },
          required: ['title', 'objective'],
        },
      },
    ]
  }

  private isPlaceholderText(value: unknown) {
    const text = String(value ?? '').trim()
    if (!text) return true
    if (/^(unknown|untitled|n\/a|null|none|\?)$/i.test(text)) return true
    return /chapter\s*#?\s*\?|name\s*:\s*unknown/i.test(text)
  }

  protected async handleToolCall(toolCall: ToolCall, context: Record<string, any>): Promise<ToolResult> {
    if (toolCall.name === 'create_next_chapter_title') {
      const { title, objective } = toolCall.arguments
      const chapterNumber = Number(context.nextChapterNumber)

      const issues: string[] = []
      if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
        issues.push('nextChapterNumber runtime context is missing or invalid')
      }
      if (this.isPlaceholderText(title)) {
        issues.push('title must be a real chapter title, not a placeholder')
      }
      if (this.isPlaceholderText(objective)) {
        issues.push('objective must be a concrete chapter objective, not a placeholder')
      }

      if (issues.length) {
        return {
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: `Invalid next chapter title plan: ${issues.join('; ')}` }),
        }
      }

      context._nextChapterTitleData = {
        chapterNumber,
        title: String(title).trim(),
        objective: String(objective).trim(),
      }

      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: true }),
      }
    }

    if (toolCall.name === 'create_chapter_titles') {
      const { chapters } = toolCall.arguments
      const expectedCount = Number(context.batchChapterCount ?? context.chapterCount)
      const startChapterNumber = Number(context.startChapterNumber ?? 1)

      if (!Number.isInteger(expectedCount) || expectedCount < 1 || !Number.isInteger(startChapterNumber) || startChapterNumber < 1) {
        return {
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: 'Runtime chapter title batch range is missing or invalid' }),
        }
      }

      if (!Array.isArray(chapters) || chapters.length !== expectedCount) {
        return {
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: `chapters array length must be exactly ${expectedCount}` }),
        }
      }

      const issues: string[] = []
      for (let index = 0; index < chapters.length; index++) {
        const chapter = chapters[index]
        if (this.isPlaceholderText(chapter?.title)) {
          issues.push(`chapters[${index}].title must be a real chapter title, not a placeholder`)
        }
        if (this.isPlaceholderText(chapter?.objective)) {
          issues.push(`chapters[${index}].objective must be a concrete chapter objective, not a placeholder`)
        }
      }

      if (issues.length) {
        return {
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: `Invalid chapter title plan: ${issues.join('; ')}` }),
        }
      }

      context._chapterTitlesData = {
        chapterCount: Number(context.chapterCount ?? expectedCount),
        chapters: chapters.map((chapter: any, index: number) => ({
          ...chapter,
          chapterNumber: startChapterNumber + index,
        })),
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

  protected shouldStopAfterToolCallRound(context: Record<string, any>): boolean {
    return Boolean(context._nextChapterTitleData)
      || (Array.isArray(context._chapterTitlesData?.chapters) && context._chapterTitlesData.chapters.length > 0)
  }

  protected getToolResultContent(context: Record<string, any>): string | null {
    return context._nextChapterTitleData
      ? JSON.stringify(context._nextChapterTitleData)
      : context._chapterTitlesData
        ? JSON.stringify(context._chapterTitlesData)
        : null
  }

  protected getFinalToolNames(context: Record<string, any>): string[] {
    return context.mode === 'nextChapter' ? ['create_next_chapter_title'] : ['create_chapter_titles']
  }

  protected getSystemPrompt(context?: Record<string, any>): string {
    if (context?.mode === 'nextChapter') {
      return `You are an expert story structurer.
Your job is to generate the title and brief objective for exactly one next chapter after the existing chapter plan supplied by the program.
Use the create_next_chapter_title tool to output your plan.
This is a structured-output task: call create_next_chapter_title directly.
Do not call update_todolist for this task unless the user explicitly asks for a checklist.
Never use placeholders such as "Unknown", "Untitled", "?", "Chapter # ?", or "Name: Unknown".
The program, not the model, controls the chapter number and configured chapter limit.`
    }

    return `You are an expert story structurer.
Your job is to generate titles and brief objectives for the exact chapter count supplied by the program.
Use the create_chapter_titles tool to output your plan.
This is a structured-output task: call create_chapter_titles directly.
Do not call update_todolist for this task unless the user explicitly asks for a checklist.
Never use placeholders such as "Unknown", "Untitled", "?", "Chapter # ?", or "Name: Unknown".
The program, not the model, controls the chapter count and chapter numbers.`
  }

  protected buildPrompt(context: Record<string, any>): string {
    const {
      theme,
      genre,
      targetReader,
      language,
      chapterCount,
      batchChapterCount,
      startChapterNumber,
      endChapterNumber,
      storyOutline,
    } = context

    if (context.mode === 'nextChapter') {
      const {
        theme,
        genre,
        targetReader,
        language,
        chapterCount,
        maxChapters,
        nextChapterNumber,
        storyOutline,
        existingChapters,
      } = context

      return `Create the title and objective for exactly one next chapter.

Theme: ${theme}
Genre: ${genre}
Target Reader: ${targetReader}
Language: ${language || 'English'}
Configured Max Chapters: ${maxChapters ?? chapterCount}
Next Chapter Number: ${nextChapterNumber}

Story Outline:
${storyOutline}

Existing Chapter Plan:
${existingChapters || 'No existing chapter plan provided.'}

Continue the existing plan without rewriting previous chapters. Use create_next_chapter_title to output a concrete title and objective for Chapter ${nextChapterNumber} only.`
    }

    const batchCount = batchChapterCount ?? chapterCount
    const start = startChapterNumber ?? 1
    const end = endChapterNumber ?? (start + batchCount - 1)

    return `Create titles and objectives for exactly ${batchCount} chapters.

Theme: ${theme}
Genre: ${genre}
Target Reader: ${targetReader}
Language: ${language || 'English'}
Total Chapter Count: ${chapterCount}
Current Batch: Chapters ${start}-${end}

Story Outline:
${storyOutline}

Analyze the story outline and pacing, then use the create_chapter_titles tool to output exactly ${batchCount} chapters for the current batch only.
Do not decide or change the chapter count.
Every chapter must have a concrete title and a concrete objective. Do not include chapterNumber; the program assigns chapter numbers from the batch position. Do not use unknown or placeholder text.`
  }

  protected validateOutput(response: string, parsed: any, context: Record<string, any>): string[] {
    const issues: string[] = []
    
    if (context.mode === 'nextChapter') {
      if (!context._nextChapterTitleData) {
        issues.push('Must use create_next_chapter_title tool to output the next chapter title plan.')
      }
      return issues
    }

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
        { role: 'system' as const, content: injectCustomSystemPrompt(this.getSystemPrompt(context)) },
        { role: 'user' as const, content: userPrompt },
      ]

      const result = await this.executeWithTools(
        messages,
        this.getTools(),
        context,
        onToken,
        this.temperature
      )

      if (context._nextChapterTitleData) {
        return {
          content: JSON.stringify(context._nextChapterTitleData),
          tokenUsage: { prompt: 0, completion: 0 },
          ...this.getCompressionReport(),
        }
      }

      if (context._chapterTitlesData) {
        return {
          content: JSON.stringify(context._chapterTitlesData),
          tokenUsage: { prompt: 0, completion: 0 },
          ...this.getCompressionReport(),
        }
      }

      previousResponse = result.content
      lastIssues = this.validateOutput(result.content, null, context)
    }

    throw new Error(`Failed to generate ${context.mode === 'nextChapter' ? 'next chapter title' : 'chapter titles'}: ${lastIssues.join('; ')}`)
  }

  parseResponse(response: string): any {
    return { raw: response }
  }
}
