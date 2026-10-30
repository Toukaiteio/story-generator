import { BaseAgent } from './base'
import type { AgentType } from '@/types/agent'
import type { ToolDefinition, ToolCall, ToolResult } from '@/services/provider/tools'

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
        description: 'Create the detailed outline for the exact target chapter supplied in the prompt. Do not invent or pass chapterNumber/title/objective; those are provided by the runtime context.',
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
This is a single-step structured-output task: call create_chapter_outline directly.
Do not call update_todolist for this task unless the user explicitly asks for a checklist.
Do not output JSON, markdown, prose, placeholder chapter labels, or analysis in the assistant text message.`
  }

  protected buildPrompt(context: Record<string, any>): string {
    const {
      theme,
      genre,
      targetReader,
      language,
      style,
      storyOutline,
      characters,
      existingChapters,
      targetChapter,
      currentChapterPlan,
      chapterCount,
    } = context
    const referenceMaterial = ''

    return `Create the detailed outline for the exact target chapter below.

Target chapter:
- Chapter Number: ${targetChapter.chapterNumber}
- Total Chapters: ${chapterCount}
- Chapter Title: ${targetChapter.title}
- Chapter Objective: ${targetChapter.objective}

The create_chapter_outline tool only accepts the detailed outline fields. Do not include chapterNumber, title, objective, "Unknown", "?", or placeholder labels in the tool arguments.

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

Existing partial plan for this chapter:
${currentChapterPlan || 'No partial plan provided.'}
${referenceMaterial}

Call create_chapter_outline now to complete or refine the conflict, keyEvents, characterActions, infoReveals, and endingHook for THIS chapter ONLY. Preserve useful existing chapter intent from the partial plan when it is concrete.`
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

  parseResponse(response: string): any {
    return { raw: response }
  }
}
