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
            length: {
              type: 'string',
              description: 'The desired story length',
              enum: ['short', 'medium', 'long'],
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
          required: ['name', 'theme', 'genre', 'targetReader', 'language', 'length', 'customRequirements', 'constraints'],
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

Use the refine_configuration tool to provide the refined configuration.

The writing style is managed separately and should not be included in your response.`
  }

  protected buildPrompt(context: Record<string, any>): string {
    return `Refine the following story configuration while keeping the original intent intact.
Improve specificity, remove ambiguity, and make it easier for downstream generation agents to follow.
Do not blank out any field that already has a meaningful value.
If genre or other fields are already set and valid, preserve them exactly unless you have a clear improvement.
Preserve the primary language unless the input is clearly invalid.
The writing style is managed separately. Do not include a style field in your response.
If you are unsure about a field, keep the current value instead of returning an empty string.

Current configuration:
${JSON.stringify(context, null, 2)}

Guidelines:
- Keep the same story premise unless a small refinement clearly improves clarity.
- Preserve the user's genre and intended audience unless the input is inconsistent.
- Make required and forbidden constraints concise and actionable.
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
    const lengthValues = new Set(['short', 'medium', 'long'])
    const requiredStringFields: Array<'name' | 'theme' | 'genre' | 'targetReader' | 'language' | 'length' | 'customRequirements'> = [
      'name',
      'theme',
      'genre',
      'targetReader',
      'language',
      'length',
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
    const lengthValues = new Set(['short', 'medium', 'long'])
    const requiredStringFields: Array<'name' | 'theme' | 'genre' | 'targetReader' | 'language' | 'length' | 'customRequirements'> = [
      'name',
      'theme',
      'genre',
      'targetReader',
      'language',
      'length',
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

    const nextLength = typeof parsed.length === 'string' ? parsed.length.trim() : ''
    if (nextLength && !lengthValues.has(nextLength)) {
      issues.push('Field "length" must be one of: short, medium, long')
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

Use the refine_configuration tool to provide a corrected configuration. Preserve any valid existing values. Do not blank out genre, language, or other meaningful fields. Do not include a style field.`
  }
}
