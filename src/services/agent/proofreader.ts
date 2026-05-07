import { BaseAgent } from './base'
import type { AgentType } from '@/types/agent'
import type { ToolDefinition, ToolCall, ToolResult } from '@/services/provider/tools'
import { containsMetaCommentary, countWords } from './validation'
import { getRelationshipQueryTools, handleRelationshipQueryTool } from '@/services/relationship/tools'

export class ProofreaderExpert extends BaseAgent {
  type: AgentType = 'proofreader'
  name = 'Proofreading Expert'

  protected getTools(): ToolDefinition[] {
    return [
      ...getRelationshipQueryTools(),
      {
        name: 'proofread_chapter',
        description: 'Proofread and correct a chapter with detailed corrections',
        parameters: {
          type: 'object',
          properties: {
            correctedContent: {
              type: 'string',
              description: 'The corrected chapter text',
            },
            corrections: {
              type: 'string',
              description: 'A summary of all corrections made',
            },
          },
          required: ['correctedContent', 'corrections'],
        },
      },
    ]
  }

  protected async handleToolCall(toolCall: ToolCall, context: Record<string, any>): Promise<ToolResult> {
    const relationshipResult = context.project
      ? await handleRelationshipQueryTool(toolCall, context.project)
      : null
    if (relationshipResult) return relationshipResult

    if (toolCall.name === 'proofread_chapter') {
      // Store the proofread content in context
      context._proofreadContent = toolCall.arguments.correctedContent
      context._corrections = toolCall.arguments.corrections
      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: true, message: 'Chapter proofread successfully', wordCount: countWords(toolCall.arguments.correctedContent) }),
      }
    }

    return {
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
    }
  }

  protected getSystemPrompt(): string {
    return `You are an expert proofreader and editor for fiction. Your job is to:
- Fix grammatical errors, typos, and punctuation issues
- Check for consistency in character names, descriptions, and behaviors
- Verify timeline and logical consistency
- Use relationship query tools when character attitudes, trust, conflict, or prior interactions matter
- Ensure the chapter connects properly with previous chapters
- Check that the chapter follows the outline
- Flag any setting or world-building inconsistencies

Use the proofread_chapter tool to provide the corrected text and a summary of changes made.`
  }

  protected buildPrompt(context: Record<string, any>): string {
    const { content, chapterTitle, chapterOutline, characters, previousSummary, language, knowledgeContext } = context

    return `Proofread and correct the following chapter:

**Chapter: ${chapterTitle}**
**Primary Language:** ${language || 'English'}

**Content to proofread:**
${content}

**Chapter Outline (for consistency check):**
${typeof chapterOutline === 'string' ? chapterOutline : JSON.stringify(chapterOutline, null, 2)}

**Character Reference:**
${characters}

${previousSummary ? `**Previous Story Summary:**\n${previousSummary}` : ''}
${knowledgeContext ? `**Reference Material:**\n${knowledgeContext}\n` : ''}

Relationship query tools are available. Use them when checking whether character behavior, dialogue, trust, conflict, or references to prior events are consistent. Query only the specific characters or events you need.

Please:
1. Use the proofread_chapter tool to provide the corrected chapter text
2. Include a summary of all corrections made in the corrections field`
  }

  parseResponse(response: string): any {
    const parts = response.split(/Corrections?:/i)
    return {
      content: parts[0]?.trim() || response,
      corrections: parts[1]?.trim() || '',
    }
  }

  protected validateOutput(response: string, parsed: any, context: Record<string, any>): string[] {
    const issues: string[] = []
    const text = response.trim()
    const sourceContent = typeof context.content === 'string' ? context.content.trim() : ''
    const content = typeof parsed?.content === 'string' ? parsed.content.trim() : ''
    const corrections = typeof parsed?.corrections === 'string' ? parsed.corrections.trim() : ''

    if (!text) issues.push('Proofread response is empty')
    if (containsMetaCommentary(text)) issues.push('Proofread response contains meta commentary or code fences')

    // When using tools, validation is handled by the tool execution
    // Only validate if we have raw output (fallback mode)
    if (parsed && parsed.content && !parsed.content.includes('{')) {
      return issues
    }

    if (!content) issues.push('Proofread response must include corrected chapter text')
    if (!corrections) issues.push('Proofread response must include a non-empty Corrections section')
    if (sourceContent && content.length < Math.max(200, Math.floor(sourceContent.length * 0.5))) {
      issues.push('Proofread chapter is unexpectedly short compared with the source content')
    }
    if (countWords(content || text) < 200) {
      issues.push('Proofread chapter is too short to be reliable')
    }

    return issues
  }

  protected buildRepairPrompt(context: Record<string, any>, previousResponse: string, issues: string[]): string {
    return `The previous proofread output was incomplete or invalid.

Issues:
${issues.map(issue => `- ${issue}`).join('\n')}

Original task:
${this.buildPrompt(context)}

Previous output:
${previousResponse}

Use the proofread_chapter tool to provide the corrected chapter text and a clearly labeled summary of corrections. Do not omit the corrections summary.`
  }
}
