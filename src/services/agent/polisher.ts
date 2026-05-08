import { BaseAgent } from './base'
import type { AgentType } from '@/types/agent'
import type { ToolDefinition, ToolCall, ToolResult } from '@/services/provider/tools'
import { containsMetaCommentary, countWords } from './validation'
import { getRelationshipQueryTools, handleRelationshipQueryTool } from '@/services/relationship/tools'
import { buildWritingFormatInstruction, sanitizeGeneratedChapterContent } from '@/services/writingFormat'

export class PolisherExpert extends BaseAgent {
  type: AgentType = 'polisher'
  name = 'Polishing Expert'

  protected getTools(): ToolDefinition[] {
    return [
      ...getRelationshipQueryTools(),
      {
        name: 'fix_section',
        description: 'Fix a specific section of the chapter. Use this for targeted fixes instead of polishing the entire chapter.',
        parameters: {
          type: 'object',
          properties: {
            sectionStart: {
              type: 'number',
              description: 'Start word index of the section to fix',
            },
            sectionEnd: {
              type: 'number',
              description: 'End word index of the section to fix',
            },
            fixedText: {
              type: 'string',
              description: 'The polished/fixed text for this section',
            },
            reason: {
              type: 'string',
              description: 'Brief reason for the fix (e.g., "improved prose rhythm", "fixed consistency issue")',
            },
          },
          required: ['sectionStart', 'sectionEnd', 'fixedText', 'reason'],
        },
      },
      {
        name: 'polish_complete',
        description: 'Mark polishing as complete when all issues are fixed',
        parameters: {
          type: 'object',
          properties: {
            finalContent: {
              type: 'string',
              description: 'The final polished chapter text',
            },
          },
          required: ['finalContent'],
        },
      },
    ]
  }

  protected async handleToolCall(toolCall: ToolCall, context: Record<string, any>): Promise<ToolResult> {
    const relationshipResult = context.project
      ? await handleRelationshipQueryTool(toolCall, context.project)
      : null
    if (relationshipResult) return relationshipResult

    if (toolCall.name === 'fix_section') {
      // Record the section fix
      if (!context._fixes) context._fixes = []
      context._fixes.push({
        start: toolCall.arguments.sectionStart,
        end: toolCall.arguments.sectionEnd,
        text: toolCall.arguments.fixedText,
        reason: toolCall.arguments.reason,
      })
      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: true, message: 'Section fixed', wordCount: countWords(toolCall.arguments.fixedText) }),
      }
    }

    if (toolCall.name === 'polish_complete') {
      // Store the final polished content
      context._polishedContent = sanitizeGeneratedChapterContent(String(toolCall.arguments.finalContent ?? ''), {
        writingFormat: context.writingFormat,
        writingStyle: context.style,
        chapterTitle: context.chapterTitle,
        chapterNumber: context.chapterNumber,
      })
      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: true, message: 'Polishing complete', wordCount: countWords(context._polishedContent) }),
      }
    }

    return {
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
    }
  }

  protected getSystemPrompt(): string {
    return `You are an expert prose editor for fiction. Your job is to polish chapters and fix issues.

For each issue found by Proofreading or Polish review:
1. Use fix_section to improve prose in that specific location
2. Provide brief reason for each fix
3. When all issues are addressed, use polish_complete with the final content

Rules:
- Use fix_section for targeted improvements (word choice, rhythm, clarity)
- Fix prose issues section by section, not the entire chapter at once
- Preserve story meaning, plot, and character voices
- Include all original content, just enhanced
- When fixing, provide exact word indices and replacement text

Tools available:
- fix_section: Polish a specific section of text
- polish_complete: Submit final polished chapter when all sections are fixed
- get_character_profile: Query a specific character only when voice or behavior details are needed
- relationship query tools: Query specific relationship facts only when preserving character dynamics requires it`
  }

  protected buildPrompt(context: Record<string, any>): string {
    const { content, chapterTitle, chapterNumber, characters, language, style, knowledgeContext, writingFormat, proofreadingIssues, range } = context

    const isChunked = !!range
    const rangeInfo = range ? `\nProcessing segment: words ${range.start}-${range.end} of the chapter.` : ''

    let issuesSection = ''
    if (proofreadingIssues && proofreadingIssues.length > 0) {
      issuesSection = `\nProofreading Issues to Address:\n${proofreadingIssues.map((issue: any, i: number) =>
        `${i + 1}. ${issue.title} (${issue.severity})\n   Problem: ${issue.explanation}\n   Suggestion: ${issue.suggestedFix}`
      ).join('\n\n')}\n`
    }

    if (isChunked) {
      return `Polish this chapter segment for prose quality and address any issues:

Chapter: ${chapterNumber ? `${chapterNumber}. ` : ''}${chapterTitle}${rangeInfo}
Language: ${language || 'English'}
Format: ${writingFormat || 'plaintext'}
${issuesSection}

Compact Character Directory:
${characters || 'No characters'}

Text segment:
${content}

Use get_character_profile or relationship query tools only for specific character facts needed in this segment.

Use fix_section to improve prose in this segment. When done with this segment, call polish_complete.`
    }

    return `Polish this chapter for prose quality and address the following issues:

Chapter: ${chapterNumber ? `${chapterNumber}. ` : ''}${chapterTitle}
Primary Language: ${language || 'English'}
${style ? `Target Style Guide:\n${style}` : ''}

${buildWritingFormatInstruction(writingFormat, style)}
${issuesSection}

Compact Character Directory:
${characters || 'No characters'}

Content to polish (${countWords(content)} words):
${content}

${knowledgeContext ? `Reference Material:\n${knowledgeContext}\n` : ''}

Use get_character_profile for character details only when needed. Use relationship query tools for specific relationship checks, preferably with character IDs from the compact directory.

Use fix_section for each area that needs improvement. When all issues are fixed, call polish_complete with the final polished chapter.`
  }

  parseResponse(response: string, context?: Record<string, any>): any {
    return {
      content: context?._polishedContent || response.trim(),
      fixes: context?._fixes || [],
    }
  }

  protected validateOutput(response: string, parsed: any, context: Record<string, any>): string[] {
    const issues: string[] = []

    // Check if tools were used
    if (response.includes('fix_section') || response.includes('polish_complete')) {
      // Tool-based approach is valid
      if (!context._polishedContent && !context._fixes) {
        issues.push('Polish tools were called but no content was generated')
      }
      return issues
    }

    // Fallback validation for non-tool responses
    const text = response.trim()
    if (!text) {
      issues.push('Polish output is empty')
    } else if (response.length > 500 && !response.includes('fix_section')) {
      issues.push('Must use fix_section tool for targeted prose improvements, not free-form output')
    }

    return issues
  }

  protected buildRepairPrompt(context: Record<string, any>, previousResponse: string, issues: string[]): string {
    const { content, chapterTitle, chapterNumber, language, proofreadingIssues } = context

    return `You failed to use the fix_section or polish_complete tools correctly.

Issues to fix:
${issues.map(issue => `- ${issue}`).join('\n')}

Task: Polish chapter "${chapterTitle}" and fix these issues:
${proofreadingIssues && proofreadingIssues.length > 0 ? proofreadingIssues.map((issue: any) => `- ${issue.title}: ${issue.suggestedFix}`).join('\n') : 'General prose polish'}

Chapter content (${countWords(content)} words):
${content}

CRITICAL: You MUST use fix_section for each area needing improvement, then call polish_complete when done. Do NOT output free-form text.`
  }
}
