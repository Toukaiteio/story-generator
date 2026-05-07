import { BaseAgent } from './base'
import type { AgentType } from '@/types/agent'
import type { ToolDefinition, ToolCall, ToolResult } from '@/services/provider/tools'
import { containsMetaCommentary, countParagraphs, countWords } from './validation'

export class WriterExpert extends BaseAgent {
  type: AgentType = 'writer'
  name = 'Writing Expert'

  protected getTools(): ToolDefinition[] {
    return [
      {
        name: 'write_chapter',
        description: 'Write a complete chapter with compelling prose',
        parameters: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The complete chapter text written in prose',
            },
            summary: {
              type: 'string',
              description: 'A brief summary of the chapter (first 200 characters)',
            },
          },
          required: ['content'],
        },
      },
    ]
  }

  protected async handleToolCall(toolCall: ToolCall, context: Record<string, any>): Promise<ToolResult> {
    if (toolCall.name === 'write_chapter') {
      // Store the chapter content in context
      const content = typeof toolCall.arguments.content === 'string'
        ? toolCall.arguments.content.trim()
        : ''
      context._chapterContent = content
      context._chapterSummary = toolCall.arguments.summary || `${content.substring(0, 200)}...`
      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: true, message: 'Chapter written successfully', wordCount: countWords(content) }),
      }
    }

    return {
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
    }
  }

  protected shouldStopAfterToolCallRound(context: Record<string, any>): boolean {
    return typeof context._chapterContent === 'string' && context._chapterContent.trim().length > 0
  }

  protected getToolResultContent(context: Record<string, any>): string | null {
    return typeof context._chapterContent === 'string'
      ? context._chapterContent
      : null
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

Use the write_chapter tool to provide the complete chapter text.
Do not include meta-commentary or notes.
Write prose only.`
  }

  protected buildPrompt(context: Record<string, any>): string {
    const { chapterOutline, chapterTitle, chapterIndex, characters, relationships, previousSummary, language, style, knowledgeContext } = context

    return `Write the following chapter:

**Chapter ${chapterIndex + 1}: ${chapterTitle}**

**Primary Language:** ${language || 'English'}
${style ? `**Writing Style Guide:**\n${style}` : '**Writing Style:** Use a writing style appropriate for the genre and target reader.'}

**Chapter Outline:**
${typeof chapterOutline === 'string' ? chapterOutline : JSON.stringify(chapterOutline, null, 2)}

**Characters:**
${characters}

${relationships ? `**Relationship State:**\n${relationships}\n` : ''}
${previousSummary ? `**Previous Story Summary:**\n${previousSummary}` : 'This is the first chapter.'}
${knowledgeContext ? `\n**Reference Material:**\n${knowledgeContext}` : ''}

Write the full chapter text in ${language || 'English'}. Aim for 2000-3000 words. Include natural dialogue, vivid descriptions, and advance the plot according to the outline.

Use the write_chapter tool to provide the chapter content.`
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

    // When using tools, validation is handled by the tool execution
    // Only validate if we have raw output (fallback mode)
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

Use the write_chapter tool to rewrite the chapter as a full prose chapter only. Preserve the plot, style, and character intent, but make the chapter substantially more complete and coherent.`
  }
}
