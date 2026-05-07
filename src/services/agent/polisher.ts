import { BaseAgent } from './base'
import type { AgentType } from '@/types/agent'
import type { ToolDefinition, ToolCall, ToolResult } from '@/services/provider/tools'
import { containsMetaCommentary, countWords } from './validation'
import { getRelationshipQueryTools, handleRelationshipQueryTool } from '@/services/relationship/tools'

export class PolisherExpert extends BaseAgent {
  type: AgentType = 'polisher'
  name = 'Polishing Expert'

  protected getTools(): ToolDefinition[] {
    return [
      ...getRelationshipQueryTools(),
      {
        name: 'polish_chapter',
        description: 'Polish and enhance a chapter\'s prose quality',
        parameters: {
          type: 'object',
          properties: {
            polishedContent: {
              type: 'string',
              description: 'The polished chapter text with enhanced prose',
            },
          },
          required: ['polishedContent'],
        },
      },
    ]
  }

  protected async handleToolCall(toolCall: ToolCall, context: Record<string, any>): Promise<ToolResult> {
    const relationshipResult = context.project
      ? await handleRelationshipQueryTool(toolCall, context.project)
      : null
    if (relationshipResult) return relationshipResult

    if (toolCall.name === 'polish_chapter') {
      // Store the polished content in context
      context._polishedContent = toolCall.arguments.polishedContent
      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: true, message: 'Chapter polished successfully', wordCount: countWords(toolCall.arguments.polishedContent) }),
      }
    }

    return {
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
    }
  }

  protected getSystemPrompt(): string {
    return `You are an expert prose editor focused on polishing and enhancing fiction text. Your job is to:
- Enhance language expressiveness and imagery
- Optimize sentence rhythm and variety
- Eliminate awkward phrasing and redundancy
- Strengthen emotional resonance
- Improve dialogue naturalness
- Use relationship query tools only when polishing may affect or depend on character relationships
- Maintain the author's voice while elevating quality

Use the polish_chapter tool to provide the polished text.
Do not include notes or explanations.
Preserve the story meaning and chapter structure.`
  }

  protected buildPrompt(context: Record<string, any>): string {
    const { content, chapterTitle, language, style, knowledgeContext } = context

    return `Polish and enhance the following chapter:

**Chapter: ${chapterTitle}**
**Primary Language:** ${language || 'English'}
${style ? `**Target Style Guide:**\n${style}` : '**Target Style:** Maintain a style consistent with the genre and target reader.'}

**Content to polish:**
${content}

${knowledgeContext ? `**Reference Material:**\n${knowledgeContext}\n` : ''}

Relationship query tools are available. Use them sparingly when preserving a character's attitude, emotional distance, conflict, trust, or references to prior relationship events matters.

Enhance the prose quality while preserving the original meaning, plot points, and character voices.

Use the polish_chapter tool to provide the polished chapter text in ${language || 'English'}.`
  }

  parseResponse(response: string): any {
    return { content: response.trim() }
  }

  protected validateOutput(response: string, _parsed: any, context: Record<string, any>): string[] {
    const issues: string[] = []
    const text = response.trim()
    const source = typeof context.content === 'string' ? context.content.trim() : ''

    if (!text) issues.push('Polished output is empty')
    if (containsMetaCommentary(text)) issues.push('Polished output contains meta commentary or code fences')

    // When using tools, validation is handled by the tool execution
    // Only validate if we have raw output (fallback mode)
    if (_parsed && _parsed.content && !_parsed.content.includes('{')) {
      return issues
    }

    if (countWords(text) < 150) issues.push('Polished output is too short')
    if (source && text.length < Math.max(200, Math.floor(source.length * 0.6))) {
      issues.push('Polished output is unexpectedly shorter than the source content')
    }

    return issues
  }

  protected buildRepairPrompt(context: Record<string, any>, previousResponse: string, issues: string[]): string {
    return `The previous polishing pass was incomplete or degraded the text.

Issues:
${issues.map(issue => `- ${issue}`).join('\n')}

Original task:
${this.buildPrompt(context)}

Previous polished text:
${previousResponse}

Use the polish_chapter tool to rewrite the chapter so it is polished prose only, keeps the same meaning and plot, and preserves the original chapter structure.`
  }
}
