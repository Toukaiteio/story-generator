import { BaseAgent } from './base'
import type { AgentType } from '@/types/agent'
import type { ToolDefinition, ToolCall, ToolResult } from '@/services/provider/tools'
import { containsMetaCommentary, countParagraphs, countWords } from './validation'
import { buildWritingFormatInstruction, sanitizeGeneratedChapterContent } from '@/services/writingFormat'
import { getRelationshipQueryTools, handleRelationshipQueryTool } from '@/services/relationship/tools'

export class WriterExpert extends BaseAgent {
  type: AgentType = 'writer'
  name = 'Writing Expert'

  protected getTools(): ToolDefinition[] {
    return [
      ...getRelationshipQueryTools(),
      {
        name: 'write_chapter',
        description: 'Write the chapter prose in sections, appending each section until the chapter is complete. Follow the requested output format exactly.',
        parameters: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The next section of chapter prose to append. Do not include chapter title, chapter number, table of contents, notes, labels, or Markdown headings unless Markdown format was explicitly requested.',
            },
            summary: {
              type: 'string',
              description: 'A brief summary of the current section or the chapter so far',
            },
            isComplete: {
              type: 'boolean',
              description: 'Whether this section completes the chapter',
            },
          },
          required: ['content', 'isComplete'],
        },
      },
    ]
  }

  protected async handleToolCall(toolCall: ToolCall, context: Record<string, any>): Promise<ToolResult> {
    const relationshipResult = context.project
      ? await handleRelationshipQueryTool(toolCall, context.project)
      : null
    if (relationshipResult) return relationshipResult

    if (toolCall.name === 'write_chapter') {
      // Store the chapter content in context
      const rawContent = typeof toolCall.arguments.content === 'string'
        ? toolCall.arguments.content.trim()
        : ''
      const content = sanitizeGeneratedChapterContent(rawContent, {
        writingFormat: context.writingFormat,
        writingStyle: context.style,
        chapterTitle: context.chapterTitle,
        chapterNumber: context.chapterNumber,
      })
      const summary = typeof toolCall.arguments.summary === 'string'
        ? toolCall.arguments.summary.trim()
        : ''
      const isComplete = Boolean(toolCall.arguments.isComplete)

      if (!content) {
        return {
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: 'Chapter content is required' }),
        }
      }

      const chunks = Array.isArray(context._chapterDraftChunks)
        ? context._chapterDraftChunks
        : []
      chunks.push(content)
      context._chapterDraftChunks = chunks
      context._chapterContent = chunks.join('\n\n')
      context._chapterComplete = isComplete
      context._chapterSummary = summary || (isComplete
        ? `${context._chapterContent.substring(0, 200)}...`
        : `${content.substring(0, 200)}...`)

      if (typeof context._onChapterDraftUpdate === 'function') {
        await context._onChapterDraftUpdate({
          content: context._chapterContent,
          summary: context._chapterSummary,
          isComplete,
        })
      }

      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({
          success: true,
          message: isComplete ? 'Chapter section written and chapter completed successfully' : 'Chapter section written successfully',
          wordCount: countWords(content),
          isComplete,
        }),
      }
    }

    return {
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
    }
  }

  protected shouldStopAfterToolCallRound(context: Record<string, any>): boolean {
    return context._chapterComplete === true && typeof context._chapterContent === 'string' && context._chapterContent.trim().length > 0
  }

  protected shouldStreamToolProgress(_context: Record<string, any>): boolean {
    return true
  }

  protected getToolResultContent(context: Record<string, any>): string | null {
    return typeof context._chapterContent === 'string'
      ? context._chapterContent
      : null
  }

  protected getToolProgressKey(context: Record<string, any>): string | null {
    if (!Array.isArray(context._chapterDraftChunks)) {
      return null
    }

    return `chapter-draft:${context._chapterDraftChunks.length}:${context._chapterComplete ? 'done' : 'pending'}`
  }

  protected getFinalToolNames(_context: Record<string, any>): string[] {
    return ['write_chapter']
  }

  protected getSystemPrompt(): string {
    return `You are an expert fiction writer. Your job is to write compelling chapter content that:
- Maintains consistent voice and style throughout
- Shows rather than tells
- Creates vivid scenes with sensory details
- Advances the plot naturally through character actions
- Balances dialogue, description, and internal monologue
- Controls pacing and tension effectively
- Stays faithful to character personalities and the established outline

Use the write_chapter tool to write the chapter in multiple sections.
Each tool call should provide the next section of prose, typically 300-600 words.
Set isComplete to true only on the final section once the full chapter is done.
Do not include meta-commentary or notes.
Never output chapter prose in assistant text. Put prose only in write_chapter.content.
Never include the chapter title or chapter number in the generated prose; the application renders those separately.
Write prose only.`
  }

  protected buildPrompt(context: Record<string, any>): string {
    const { chapterOutline, chapterTitle, chapterIndex, chapterNumber, characters, relationships, previousSummary, language, style, writingFormat } = context
    const displayChapterNumber = Number.isInteger(chapterNumber) ? chapterNumber : chapterIndex + 1

    return `Write the following chapter:

Chapter to write: ${displayChapterNumber}. ${chapterTitle}

Primary Language: ${language || 'English'}
${style ? `Writing Style Guide:\n${style}` : 'Writing Style: Use a writing style appropriate for the genre and target reader.'}

${buildWritingFormatInstruction(writingFormat, style)}

Chapter Outline:
${typeof chapterOutline === 'string' ? chapterOutline : JSON.stringify(chapterOutline, null, 2)}

Characters:
${characters}

${relationships ? `Relationship Guidance:\n${relationships}\n` : 'Relationship details are not inlined. Use relationship query tools only for specific character dynamics needed for this chapter.\n'}
${previousSummary ? `Previous Story Summary:\n${previousSummary}` : 'This is the first chapter.'}

Write the chapter in multiple tool-call sections in ${language || 'English'}. Aim for a total of 2000-3000 words across all sections. Each section should stay focused and substantial, but do not try to fit the whole chapter into one tool call. Include natural dialogue, vivid descriptions, and advance the plot according to the outline.

Use the write_chapter tool to provide prose content only. Do not output chapter prose outside tool arguments. Unless the Writing Style Guide explicitly requires title or section structures, the content field must not start with the chapter title, "Chapter ${displayChapterNumber}", a Chinese chapter-number heading, or any section heading.`
  }

  parseResponse(response: string): any {
    return { content: response }
  }

  protected validateOutput(response: string, _parsed: any, context: Record<string, any>): string[] {
    const issues: string[] = []
    const text = (typeof context._chapterContent === 'string' && context._chapterContent.trim())
      ? context._chapterContent.trim()
      : response.trim()
    const targetWords = typeof context.chapterOutline === 'string' ? 1200 : 1000

    if (!text) issues.push('Written chapter is empty')
    if (containsMetaCommentary(text)) issues.push('Written chapter contains meta commentary or code fences')

    // When using tools, validation is handled by the tool execution.
    // Only validate if we have raw output (fallback mode).
    if (_parsed && _parsed.content && !_parsed.content.includes('{')) {
      return issues
    }

    if (countWords(text) < targetWords) issues.push(`Written chapter is too short; target at least ${targetWords} words`)
    if (countParagraphs(text) < 3) issues.push('Written chapter should contain multiple paragraphs')

    return issues
  }

  protected buildRepairPrompt(context: Record<string, any>, previousResponse: string, issues: string[]): string {
    return `The previous chapter draft did not meet the writing requirements.

Issues:
${issues.map(issue => `- ${issue}`).join('\n')}

Original task:
${this.buildPrompt(context)}

Previous chapter draft:
${previousResponse}

Use the write_chapter tool to continue or rewrite the chapter in sections. Preserve the plot, style, and character intent, but make the chapter substantially more complete and coherent. Set isComplete to true only when the full chapter is finished. Do not output prose outside write_chapter.content.`
  }
}
