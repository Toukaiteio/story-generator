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
                    enum: ['grammar', 'typo', 'style', 'consistency', 'pacing', 'logic', 'chapter_plan', 'character', 'relationship', 'continuity', 'factual'],
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
      context._proofreadingReported = true
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
    return `You are an expert proofreading auditor for fiction. Your job is to inspect chapter content and report issues through tools.

You are not a rewriting agent. Do not return corrected prose, revised chapter text, summaries, markdown reports, bullet lists, JSON text, or explanations in assistant text.
Your final response must be a tool call to report_proofreading_issues.

Audit criteria:
- Grammatical errors, typos, and punctuation issues.
- Consistency in character names, descriptions, and behaviors.
- Timeline and logical consistency.
- Narrative pacing and prose style.

Rules:
1. ALWAYS call report_proofreading_issues to report findings. Assistant text is invalid.
2. Provide exact excerpts from the text for each issue.
3. Be specific and actionable in your suggested fixes.
4. Process each segment independently. Focus only on issues within the given text segment.
5. If processing a chapter segment (not the full chapter), focus on local consistency and grammar - don't worry about connections to other parts.
6. Character context is intentionally compact. Use get_character_profile and relationship query tools only for specific characters or relationship facts you need.
7. If no issues are found, call report_proofreading_issues with {"issues": []}. Do not write an empty array as text.`
  }

  protected buildPrompt(context: Record<string, any>): string {
    const { content, chapterTitle, chapterNumber, chapterOutline, characters, previousSummary, language, style, knowledgeContext, writingFormat, range, auditTarget } = context

    const isChunked = !!range
    const rangeInfo = range
      ? `\nProcessing segment: ${range.index + 1}/${range.total}; estimated tokens ${range.tokenStart}-${range.tokenEnd}/${range.tokenTotal} of the chapter.\n`
      : ''

    if (auditTarget === 'chapter-outline') {
      return `Audit this chapter outline for factual plausibility, internal logic, motivation, continuity, and story-world reasonableness. Do not rewrite it and do not return prose:

Chapter: ${chapterNumber ? `${chapterNumber}. ` : ''}${chapterTitle}
Primary Language: ${language || 'English'}
Style: ${style || 'Appropriate for genre'}

Chapter Outline to Audit:
${content}

Overall Story Context:
${typeof chapterOutline === 'string' ? chapterOutline : JSON.stringify(chapterOutline, null, 2)}

Compact Character Directory:
${characters || 'No characters'}

${previousSummary ? `Previously Planned Chapters:\n${previousSummary}` : ''}
${knowledgeContext ? `Reference Material:\n${knowledgeContext}\n` : ''}

Focus on concrete problems only:
- impossible, unsupported, or implausible facts inside the story world
- weak or missing causal links between beats
- character actions that do not match known goals, roles, or relationships
- timeline, continuity, or setup/payoff contradictions
- vague beats that cannot guide writing reliably

Required final action:
Call report_proofreading_issues with concrete outline issues. Use categories such as factual, logic, continuity, character, relationship, chapter_plan, pacing, or consistency. If no concrete issues are found, call report_proofreading_issues with {"issues": []}.`
    }

    // For chunked processing, use a simpler prompt to avoid overwhelming output
    if (isChunked) {
      return `Audit this chapter segment for grammar, typos, consistency, and pacing issues. Do not rewrite it and do not return prose:

Chapter: ${chapterNumber ? `${chapterNumber}. ` : ''}${chapterTitle}${rangeInfo}
Language: ${language || 'English'}
Format: ${writingFormat || 'plaintext'}

Compact Character Directory:
${characters || 'No characters'}

Text:
${content}

Use get_character_profile or relationship query tools only for specific character facts needed in this segment.

Final response requirement: call report_proofreading_issues. If no issues are found, call report_proofreading_issues with {"issues": []}. Do not return text.`
    }

    // For single-chunk processing, include full context
    return `Audit the following chapter for grammar, typos, and consistency issues. Do not rewrite it and do not return prose:

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

Required final action:
Call report_proofreading_issues with concrete issues. For each issue, provide the exact excerpt, a clear explanation, and a suggested fix. If no issues are found, call report_proofreading_issues with {"issues": []}.`
  }

  parseResponse(response: string, context?: Record<string, any>): any {
    return {
      issues: context?._issues || [],
      raw: response,
    }
  }

  protected shouldStopAfterToolCallRound(context: Record<string, any>): boolean {
    return context._proofreadingReported === true
  }

  protected getToolResultContent(context: Record<string, any>): string | null {
    return context._proofreadingReported === true
      ? (typeof context.content === 'string' ? context.content : '')
      : null
  }

  protected getFinalToolNames(_context: Record<string, any>): string[] {
    return ['report_proofreading_issues']
  }

  protected validateOutput(response: string, parsed: any, context: Record<string, any>): string[] {
    const issues: string[] = []
    if (context._proofreadingReported === true) {
      return issues
    }

    const isChunked = !!context.range
    if (isChunked) {
      issues.push('Chunked proofreading must use report_proofreading_issues tool. Focus only on this segment and report concrete issues found.')
    } else {
      issues.push('Proofreading response must use report_proofreading_issues tool. Provide structured findings, not free-form text.')
    }

    return issues
  }

  protected buildRepairPrompt(context: Record<string, any>, previousResponse: string, issues: string[]): string {
    const { content, chapterTitle, chapterNumber, language, writingFormat, range } = context
    const isChunked = !!range

    if (isChunked) {
      const rangeInfo = range ? `segment ${range.index + 1}/${range.total}` : ''
      return `Your previous response was invalid because it did not call report_proofreading_issues. CRITICAL: You must use only the tool, no assistant text.

Audit this segment (${rangeInfo}) for grammar, typos, and consistency issues. Do not rewrite it:

Chapter: ${chapterNumber ? `${chapterNumber}. ` : ''}${chapterTitle}
Language: ${language || 'English'}
Format: ${writingFormat || 'plaintext'}

Text segment:
${content}

Action: Call report_proofreading_issues with concrete issues found. If no issues are found, call report_proofreading_issues with {"issues": []}.`
    }

    return `Your previous response was invalid because it did not call report_proofreading_issues. CRITICAL: You must use only the tool, no assistant text.

Audit chapter ${chapterNumber ? `${chapterNumber}. ` : ''}${chapterTitle} for grammar, typos, consistency, and pacing issues. Do not rewrite it.

Text (${countWords(content)} words):
${content}

Action: Call report_proofreading_issues with each issue you find. If no issues are found, call report_proofreading_issues with {"issues": []}.`
  }
}
