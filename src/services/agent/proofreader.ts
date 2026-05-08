import { BaseAgent } from './base'
import type { AgentType } from '@/types/agent'
import type { ToolDefinition, ToolCall, ToolResult } from '@/services/provider/tools'
import { containsMetaCommentary, countWords } from './validation'
import { getRelationshipQueryTools, handleRelationshipQueryTool } from '@/services/relationship/tools'
import { buildWritingFormatInstruction, sanitizeGeneratedChapterContent } from '@/services/writingFormat'

export class ProofreaderExpert extends BaseAgent {
  type: AgentType = 'proofreader'
  name = 'Proofreading Expert'

  protected getTools(): ToolDefinition[] {
    return [
      ...getRelationshipQueryTools(),
      {
        name: 'report_proofreading_issues',
        description: 'Report concrete grammar, typo, style, and consistency issues found in a chapter section.',
        parameters: {
          type: 'object',
          properties: {
            issues: {
              type: 'array',
              description: 'List of specific issues found. Return an empty array if no issues are found.',
              items: {
                type: 'object',
                properties: {
                  severity: {
                    type: 'string',
                    enum: ['low', 'medium', 'high'],
                  },
                  category: {
                    type: 'string',
                    enum: ['grammar', 'typo', 'style', 'consistency', 'pacing', 'logic'],
                  },
                  title: {
                    type: 'string',
                    description: 'Short title of the issue',
                  },
                  excerpt: {
                    type: 'string',
                    description: 'The exact excerpt from the text that contains the issue.',
                  },
                  explanation: {
                    type: 'string',
                    description: 'Why this is an issue.',
                  },
                  suggestedFix: {
                    type: 'string',
                    description: 'Specific instruction on how to fix this issue.',
                  },
                },
                required: ['severity', 'category', 'title', 'excerpt', 'explanation', 'suggestedFix'],
              },
            },
          },
          required: ['issues'],
        },
      },
    ]
  }

  protected async handleToolCall(toolCall: ToolCall, context: Record<string, any>): Promise<ToolResult> {
    const relationshipResult = context.project
      ? await handleRelationshipQueryTool(toolCall, context.project)
      : null
    if (relationshipResult) return relationshipResult

    if (toolCall.name === 'report_proofreading_issues') {
      const newIssues = Array.isArray(toolCall.arguments.issues) ? toolCall.arguments.issues : []
      context._issues = [...(context._issues || []), ...newIssues]
      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: true, count: newIssues.length }),
      }
    }

    return {
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
    }
  }

  protected getSystemPrompt(): string {
    return `You are an expert proofreader for fiction. Your job is to audit chapter content for errors.

Audit criteria:
- Grammatical errors, typos, and punctuation issues.
- Consistency in character names, descriptions, and behaviors.
- Timeline and logical consistency.
- Narrative pacing and prose style.

Rules:
1. ALWAYS use report_proofreading_issues tool to report findings - NEVER respond with freeform text.
2. Provide exact excerpts from the text for each issue.
3. Be specific and actionable in your suggested fixes.
4. Process each segment independently. Focus only on issues within the given text segment.
5. If processing a chapter segment (not the full chapter), focus on local consistency and grammar - don't worry about connections to other parts.
6. Character context is intentionally compact. Use get_character_profile and relationship query tools only for specific characters or relationship facts you need.
7. If no issues found, call the tool with an empty array.`
  }

  protected buildPrompt(context: Record<string, any>): string {
    const { content, chapterTitle, chapterNumber, chapterOutline, characters, previousSummary, language, style, knowledgeContext, writingFormat, range } = context

    const isChunked = !!range
    const rangeInfo = range ? `\nProcessing segment: words ${range.start}-${range.end}/${content.split(/\s+/).length} of the chapter.\n` : ''

    // For chunked processing, use a simpler prompt to avoid overwhelming output
    if (isChunked) {
      return `Proofread this chapter segment for grammar, typos, consistency, and pacing issues:

Chapter: ${chapterNumber ? `${chapterNumber}. ` : ''}${chapterTitle}${rangeInfo}
Language: ${language || 'English'}
Format: ${writingFormat || 'plaintext'}

Compact Character Directory:
${characters || 'No characters'}

Text:
${content}

Use get_character_profile or relationship query tools only for specific character facts needed in this segment.

Use report_proofreading_issues to report only concrete issues found in this segment. If no issues, return empty array.`
    }

    // For single-chunk processing, include full context
    return `Audit the following chapter for grammar, typos, and consistency issues:

Chapter: ${chapterNumber ? `${chapterNumber}. ` : ''}${chapterTitle}
Primary Language: ${language || 'English'}

${buildWritingFormatInstruction(writingFormat, style)}

Text to Audit:
${content}

Chapter Outline:
${typeof chapterOutline === 'string' ? chapterOutline : JSON.stringify(chapterOutline, null, 2)}

Compact Character Directory:
${characters}

${previousSummary ? `Previous Story Summary:\n${previousSummary}` : ''}
${knowledgeContext ? `Reference Material:\n${knowledgeContext}\n` : ''}

Use get_character_profile for character details only when needed. Use relationship query tools for specific relationship checks, preferably with character IDs from the compact directory.

Please:
1. Identify concrete issues using the report_proofreading_issues tool.
2. For each issue, provide the exact excerpt, a clear explanation, and a suggested fix.`
  }

  parseResponse(response: string, context?: Record<string, any>): any {
    return {
      issues: context?._issues || [],
      raw: response,
    }
  }

  protected validateOutput(response: string, parsed: any, context: Record<string, any>): string[] {
    const issues: string[] = []
    const isChunked = !!context.range

    // If tool was called, validation passes regardless of results
    if (response.includes('report_proofreading_issues')) {
      return issues
    }

    // If tool wasn't called, fail with clear message
    if (response.length > 100) {
      if (isChunked) {
        issues.push('Chunked proofreading must use report_proofreading_issues tool. Focus only on this segment and report concrete issues found.')
      } else {
        issues.push('Proofreading response must use report_proofreading_issues tool. Provide structured findings, not free-form text.')
      }
    }

    return issues
  }

  protected buildRepairPrompt(context: Record<string, any>, previousResponse: string, issues: string[]): string {
    const { content, chapterTitle, chapterNumber, language, writingFormat, range } = context
    const isChunked = !!range

    if (isChunked) {
      const rangeInfo = range ? `words ${range.start}-${range.end}` : ''
      return `You failed to use the report_proofreading_issues tool. CRITICAL: You must use only the tool, no freeform text.

Proofread this segment (${rangeInfo}) for grammar, typos, and consistency issues:

Chapter: ${chapterNumber ? `${chapterNumber}. ` : ''}${chapterTitle}
Language: ${language || 'English'}
Format: ${writingFormat || 'plaintext'}

Text segment:
${content}

Action: Call report_proofreading_issues with concrete issues found. If no issues, return empty array.`
    }

    return `You failed to use the report_proofreading_issues tool. CRITICAL: You must use only the tool, no freeform text.

Audit chapter ${chapterNumber ? `${chapterNumber}. ` : ''}${chapterTitle} for grammar, typos, consistency, and pacing issues.

Text (${countWords(content)} words):
${content}

Action: Call report_proofreading_issues with each issue you find. If no issues, return empty array.`
  }
}
