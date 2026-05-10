import { BaseAgent } from './base'
import type { AgentType } from '@/types/agent'
import type { ToolDefinition, ToolCall, ToolResult } from '@/services/provider/tools'
import { extractJsonObject } from './validation'

export class DetailerExpert extends BaseAgent {
  type: AgentType = 'detailer'
  name = 'Detailer Expert'

  protected getValidationRetryLimit(): number {
    return 2
  }

  protected getTools(): ToolDefinition[] {
    return [
      {
        name: 'refine_configuration',
        description: 'Refine and improve a story configuration while keeping the original intent',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'The story project name',
            },
            theme: {
              type: 'string',
              description: 'The core theme of the story',
            },
            genre: {
              type: 'string',
              description: 'The genre or type of the story',
            },
            targetReader: {
              type: 'string',
              description: 'The intended audience or reader profile',
            },
            language: {
              type: 'string',
              description: 'The primary language for the story',
            },
            chapterCount: {
              type: 'number',
              description: 'The exact number of chapters the program should generate. Preserve the existing number unless there is a clear story-structure reason to adjust it. Must be 1-9999.',
            },
            customRequirements: {
              type: 'string',
              description: 'Any additional custom requirements or notes',
            },
            constraints: {
              type: 'object',
              description: 'Story constraints',
              properties: {
                required: {
                  type: 'array',
                  description: 'Elements that must be included',
                  items: {
                    type: 'string',
                  },
                },
                forbidden: {
                  type: 'array',
                  description: 'Elements that must not be included',
                  items: {
                    type: 'string',
                  },
                },
              },
              required: ['required', 'forbidden'],
            },
            notes: {
              type: 'array',
              description: 'Additional notes or suggestions for improvement',
              items: {
                type: 'string',
              },
            },
          },
          required: ['name', 'theme', 'genre', 'targetReader', 'language', 'chapterCount', 'customRequirements', 'constraints'],
        },
      },
    ]
  }

  protected async handleToolCall(toolCall: ToolCall, context: Record<string, any>): Promise<ToolResult> {
    if (toolCall.name === 'refine_configuration') {
      // Store the refined configuration in context
      context._refinedConfig = toolCall.arguments
      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: true, message: 'Configuration refined successfully' }),
      }
    }

    return {
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
    }
  }

  protected getSystemPrompt(): string {
    return `You are an expert story configuration detailer.
Your job is to improve a user's story configuration without changing its core intent.
Focus on clarity, specificity, consistency, and generation usefulness.
Never blank out a field that already contains meaningful content.
If a field is already valid, preserve it unless you have a clear reason to improve it.

IMPORTANT: Always consider the primary language when refining the configuration.
- Adapt theme, target reader, and constraints to be culturally and linguistically appropriate.
- Ensure required/forbidden elements make sense in the context of the target language.
- If the language differs from English, enhance the configuration to better suit that language's storytelling conventions.

Use the refine_configuration tool to provide the refined configuration.

The writing style is managed separately and should not be included in your response.`
  }

  protected buildPrompt(context: Record<string, any>): string {
    return `Refine the following story configuration while keeping the original intent intact.
Improve specificity, remove ambiguity, and make it easier for downstream generation agents to follow.
Do not blank out any field that already has a meaningful value.
If genre or other fields are already set and valid, preserve them exactly unless you have a clear improvement.
The writing style is managed separately. Do not include a style field in your response.
Chapter count is a program-controlled numeric setting. Preserve it unless a small adjustment clearly improves pacing; never replace it with short/medium/long.
If you are unsure about a field, keep the current value instead of returning an empty string.

LANGUAGE CONSIDERATION:
The primary language for this story is: ${context.language || 'English'}
When refining the configuration, actively consider how the language choice affects the story:
- Ensure the target reader description is appropriate for ${context.language} audiences
- Adapt themes and genre descriptions to resonate with ${context.language} storytelling conventions
- Review required/forbidden elements to ensure they are relevant and achievable in ${context.language}
- If ${context.language} is non-English, suggest improvements that leverage unique storytelling opportunities in that language

Current configuration:
${JSON.stringify(context, null, 2)}

Guidelines:
- Keep the same story premise unless a small refinement clearly improves clarity.
- Preserve the user's genre and intended audience unless the input is inconsistent.
- Make required and forbidden constraints concise and actionable.
- Actively refine fields to be appropriate for the selected language (${context.language}).
- Use the refine_configuration tool to provide the refined configuration.`
  }

  parseResponse(response: string): any {
    try {
      return JSON.parse(extractJsonObject(response))
    } catch {
      return { raw: response }
    }
  }

  protected getStructuredResult(context: Record<string, any>): any {
    return context._refinedConfig
  }

  protected validateOutput(response: string, parsed: any, context: Record<string, any>): string[] {
    const issues: string[] = []
    const current = context ?? {}
    const requiredStringFields: Array<'name' | 'theme' | 'genre' | 'targetReader' | 'language' | 'customRequirements'> = [
      'name',
      'theme',
      'genre',
      'targetReader',
      'language',
      'customRequirements',
    ]

    if (context._refinedConfig && typeof context._refinedConfig === 'object' && !Array.isArray(context._refinedConfig)) {
      return this.validateConfig(context._refinedConfig, current)
    }

    if (!response.trim()) {
      issues.push('Detailer response is empty')
      return issues
    }

    // When using tools, validation is handled by the tool execution
    // Only validate if we have raw output (fallback mode)
    if (parsed && parsed.raw) {
      return issues
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      issues.push('Detailer response is not a JSON object')
      return issues
    }

    issues.push(...this.validateConfig(parsed, current))

    return issues
  }

  private validateConfig(parsed: any, current: Record<string, any>): string[] {
    const issues: string[] = []
    const requiredStringFields: Array<'name' | 'theme' | 'genre' | 'targetReader' | 'language' | 'customRequirements'> = [
      'name',
      'theme',
      'genre',
      'targetReader',
      'language',
      'customRequirements',
    ]

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      issues.push('Detailer response is not a JSON object')
      return issues
    }

    for (const field of requiredStringFields) {
      const original = typeof current[field] === 'string' ? current[field].trim() : ''
      const next = typeof parsed[field] === 'string' ? parsed[field].trim() : ''

      if (original && !next) {
        issues.push(`Field "${field}" cannot be blanked out`)
      }
    }

    const nextChapterCount = Number(parsed.chapterCount)
    if (!Number.isFinite(nextChapterCount) || nextChapterCount < 1 || nextChapterCount > 9999 || Math.trunc(nextChapterCount) !== nextChapterCount) {
      issues.push('Field "chapterCount" must be an integer from 1 to 9999')
    }

    if (!Array.isArray(parsed?.constraints?.required)) {
      issues.push('constraints.required must be an array')
    }
    if (!Array.isArray(parsed?.constraints?.forbidden)) {
      issues.push('constraints.forbidden must be an array')
    }

    const required = Array.isArray(parsed?.constraints?.required) ? parsed.constraints.required : []
    const forbidden = Array.isArray(parsed?.constraints?.forbidden) ? parsed.constraints.forbidden : []
    if (required.some((item: any) => typeof item !== 'string' || !item.trim())) {
      issues.push('constraints.required must contain only non-empty strings')
    }
    if (forbidden.some((item: any) => typeof item !== 'string' || !item.trim())) {
      issues.push('constraints.forbidden must contain only non-empty strings')
    }

    if (parsed.notes !== undefined && !Array.isArray(parsed.notes)) {
      issues.push('notes must be an array when present')
    }

    return issues
  }

  protected buildRepairPrompt(context: Record<string, any>, previousResponse: string, issues: string[]): string {
    return `The previous Detailer response failed validation and must be corrected.

Issues:
${issues.map(issue => `- ${issue}`).join('\n')}

Original configuration:
${JSON.stringify(context, null, 2)}

Previous response:
${previousResponse}

Use the refine_configuration tool to provide a corrected configuration. Preserve any valid existing values. Do not blank out genre, language, chapterCount, or other meaningful fields. Do not include a style field.`
  }
}
