import { BaseAgent } from './base'
import type { AgentType } from '@/types/agent'
import type { ToolDefinition, ToolCall, ToolResult } from '@/services/provider/tools'
import { containsMetaCommentary, extractJsonPayload } from './validation'

export class CharacterExpert extends BaseAgent {
  type: AgentType = 'character'
  name = 'Character Expert'

  protected getValidationRetryLimit(): number {
    return 2
  }

  private getTargetCharacterCount(context: Record<string, any>): number {
    const preferred = Number(context.preferredCount)
    if (Number.isFinite(preferred)) {
      return Math.max(Math.trunc(preferred), 1)
    }
    return 5
  }

  protected getTools(): ToolDefinition[] {
    return [
      {
        name: 'create_character',
        description: 'Create a new character with detailed attributes for the story',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'The character\'s full name',
            },
            role: {
              type: 'string',
              description: 'The character\'s role in the story',
              enum: ['protagonist', 'antagonist', 'supporting', 'minor'],
            },
            personality: {
              type: 'array',
              description: '3-5 concise personality traits',
              items: {
                type: 'string',
              },
            },
            appearance: {
              type: 'string',
              description: 'Physical appearance description',
            },
            backstory: {
              type: 'string',
              description: 'Character\'s background history',
            },
            motivation: {
              type: 'string',
              description: 'What drives this character',
            },
            goals: {
              type: 'string',
              description: 'Character\'s objectives in the story',
            },
            conflicts: {
              type: 'string',
              description: 'Internal or external conflicts the character faces',
            },
            currentState: {
              type: 'string',
              description: 'Character\'s current situation or state',
            },
            relations: {
              type: 'array',
              description: 'Relationships with other characters',
              items: {
                type: 'object',
                properties: {
                  targetName: {
                    type: 'string',
                    description: 'Name of the related character',
                  },
                  relation: {
                    type: 'string',
                    description: 'Type of relationship (e.g., friend, enemy, sibling)',
                  },
                  description: {
                    type: 'string',
                    description: 'Description of the relationship',
                  },
                },
                required: ['targetName', 'relation', 'description'],
              },
            },
          },
          required: ['name', 'role', 'personality', 'appearance', 'backstory', 'motivation', 'goals', 'conflicts', 'currentState'],
        },
      },
      {
        name: 'finalize_characters',
        description: 'Finalize the character list when all characters have been created',
        parameters: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description: 'A brief summary of the created characters and their roles',
            },
          },
          required: ['summary'],
        },
      },
    ]
  }

  protected async handleToolCall(toolCall: ToolCall, context: Record<string, any>): Promise<ToolResult> {
    if (toolCall.name === 'create_character') {
      // Store the character in context for tracking
      if (!context._createdCharacters) {
        context._createdCharacters = []
      }
      const name = typeof toolCall.arguments.name === 'string' ? toolCall.arguments.name.trim().toLowerCase() : ''
      if (name && context._createdCharacters.some((character: any) => typeof character?.name === 'string' && character.name.trim().toLowerCase() === name)) {
        return {
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: `Character '${toolCall.arguments.name}' already exists. Create a different character.` }),
        }
      }
      context._createdCharacters.push(toolCall.arguments)
      // Also update _charactersData for pipeline compatibility
      context._charactersData = context._createdCharacters
      if (typeof context._onCharactersUpdated === 'function') {
        await context._onCharactersUpdated(context._charactersData)
      }
      const targetCount = this.getTargetCharacterCount(context)
      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({
          success: true,
          message: `Character '${toolCall.arguments.name}' created successfully`,
          totalCharacters: context._createdCharacters.length,
          targetCharacters: targetCount,
          remainingCharacters: Math.max(targetCount - context._createdCharacters.length, 0),
        }),
      }
    }

    if (toolCall.name === 'finalize_characters') {
      const targetCount = this.getTargetCharacterCount(context)
      const totalCharacters = context._createdCharacters?.length || 0
      if (totalCharacters < targetCount) {
        return {
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: `Cannot finalize yet. Create ${targetCount - totalCharacters} more character(s) to reach the required total of ${targetCount}.`,
            totalCharacters,
            targetCharacters: targetCount,
          }),
        }
      }
      // Mark characters as finalized
      context._charactersFinalized = true
      // Ensure _charactersData is set
      context._charactersData = context._createdCharacters || []
      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: true, message: 'Characters finalized', totalCharacters, targetCharacters: targetCount }),
      }
    }

    return {
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
    }
  }

  protected getSystemPrompt(): string {
    return `You are an expert character designer for fiction. Your job is to create rich, multi-dimensional characters that:
- Have clear motivations, goals, and flaws
- Possess distinct voices and personalities
- Have meaningful relationships with other characters
- Drive the plot through their choices and growth
- Feel authentic and relatable to the target audience

Use the create_character tool to create each character one at a time.
Create the exact requested number of main characters with interconnected relationships.
After creating all characters, use the finalize_characters tool to complete the process.
Do not call finalize_characters until the exact requested number of characters has been created.

Character requirements:
- Each character must have 3-5 personality traits
- Each character must have clear motivations, goals, and conflicts
- Character names must be unique
- Characters should have meaningful relationships with each other
- Roles must be one of: protagonist, antagonist, supporting, minor`
  }

  protected buildPrompt(context: Record<string, any>): string {
    const {
      theme,
      genre,
      outline,
      targetReader,
      language,
      existingCharacters,
      knowledgeContext,
      outlineTitle,
      synopsis,
      characterSignals,
      preferredCount,
    } = context

    const targetCount = this.getTargetCharacterCount(context)
    const countGuide = `Create exactly ${targetCount} main characters. Do not stop at fewer than ${targetCount}.`

    return `Based on this story outline, create the main characters:

**Theme:** ${theme}
**Genre:** ${genre}
**Target Reader:** ${targetReader}
**Primary Language:** ${language || 'English'}

${outlineTitle ? `**Outline Title:** ${outlineTitle}\n` : ''}${synopsis ? `**Outline Synopsis:**\n${synopsis}\n` : ''}

**Story Outline:**
${outline}
${characterSignals ? `\n**Character Signals From the Outline Draft:**\n${characterSignals}` : ''}
${existingCharacters ? `\n**Existing Characters (do not duplicate):**\n${existingCharacters}` : ''}
${knowledgeContext ? `\n**Reference Material:**\n${knowledgeContext}` : ''}

${countGuide}
Use create_character exactly ${targetCount} times, once per character, before calling finalize_characters.
Include a balanced cast: at least one protagonist, one antagonist or opposing force, and supporting characters who can drive subplots and relationships.
Character names must be unique.
Write the character data in ${language || 'English'}.
Use the create_character tool for each character, then finalize_characters when done.`
  }

  parseResponse(response: string): any {
    // When using tools, the response is already structured
    try {
      return JSON.parse(extractJsonPayload(response))
    } catch {
      return { raw: response }
    }
  }

  protected validateOutput(response: string, parsed: any, context: Record<string, any>): string[] {
    const issues: string[] = []
    const text = response.trim()

    if (Array.isArray(context._charactersData) && context._charactersData.length > 0) {
      issues.push(...this.validateCharacterItems(context._charactersData, this.getTargetCharacterCount(context)))
      if (!context._charactersFinalized) {
        issues.push('Character creation must be finalized with finalize_characters')
      }
      return issues
    }

    if (!text) issues.push('Character response is empty')
    if (containsMetaCommentary(text)) issues.push('Character response contains meta commentary or code fences')

    // When using tools, validation is handled by the tool execution
    // Only validate if we have raw JSON output (fallback mode)
    if (parsed && parsed.raw) {
      issues.push('Character creation must use create_character tools or return a valid character array')
      return issues
    }

    if (!Array.isArray(parsed)) {
      issues.push('Character response must be a JSON array')
      return issues
    }

    issues.push(...this.validateCharacterItems(parsed, this.getTargetCharacterCount(context)))

    return issues
  }

  private validateCharacterItems(items: any[], targetCount = 5): string[] {
    const issues: string[] = []

    if (items.length !== targetCount) {
      issues.push(`Character response must contain exactly ${targetCount} characters`)
    }

    const allowedRoles = new Set(['protagonist', 'antagonist', 'supporting', 'minor'])
    const seenNames = new Set<string>()
    items.forEach((item: any, index: number) => {
      const label = `Character ${index + 1}`
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        issues.push(`${label} must be an object`)
        return
      }

      if (typeof item.name !== 'string' || !item.name.trim()) {
        issues.push(`${label} is missing a name`)
      } else {
        const normalizedName = item.name.trim().toLowerCase()
        if (seenNames.has(normalizedName)) {
          issues.push(`Character names must be unique; duplicate "${item.name.trim()}" found`)
        }
        seenNames.add(normalizedName)
      }

      const role = typeof item.role === 'string' ? item.role.trim().toLowerCase() : ''
      if (!allowedRoles.has(role)) {
        issues.push(`${label} has an invalid role`)
      }

      if (!Array.isArray(item.personality) || item.personality.length < 3 || item.personality.length > 5) {
        issues.push(`${label} must include 3-5 personality traits`)
      } else if (item.personality.some((entry: any) => typeof entry !== 'string' || !entry.trim())) {
        issues.push(`${label} personality traits must be non-empty strings`)
      }

      for (const field of ['appearance', 'backstory', 'motivation', 'goals', 'conflicts', 'currentState'] as const) {
        if (typeof item[field] !== 'string' || !item[field].trim()) {
          issues.push(`${label} is missing ${field}`)
        }
      }

      if (item.relations == null) return

      if (!Array.isArray(item.relations)) {
        issues.push(`${label} relations must be an array`)
        return
      }

      for (const relation of item.relations) {
        if (!relation || typeof relation !== 'object' || Array.isArray(relation)) {
          issues.push(`${label} relations must contain objects`)
          continue
        }
        if (typeof relation.targetName !== 'string' || !relation.targetName.trim()) {
          issues.push(`${label} relation targetName is required`)
        }
        if (typeof relation.relation !== 'string' || !relation.relation.trim()) {
          issues.push(`${label} relation type is required`)
        }
        if (typeof relation.description !== 'string' || !relation.description.trim()) {
          issues.push(`${label} relation description is required`)
        }
      }
    })

    return issues
  }

  protected buildRepairPrompt(context: Record<string, any>, previousResponse: string, issues: string[]): string {
    const targetCount = this.getTargetCharacterCount(context)

    return `The previous character set did not satisfy the required character creation requirements.

Issues:
${issues.map(issue => `- ${issue}`).join('\n')}

Original task:
${this.buildPrompt(context)}

Previous character output:
${previousResponse}

Continue or redo the character creation using tools. Use create_character exactly ${targetCount} times for a complete, balanced cast, then call finalize_characters. Do not return JSON in the assistant message.`
  }

  protected shouldStopAfterToolCallRound(context: Record<string, any>): boolean {
    return Boolean(context._charactersFinalized)
  }

  protected getToolResultContent(context: Record<string, any>): string | null {
    return Array.isArray(context._charactersData)
      ? JSON.stringify(context._charactersData)
      : null
  }

  protected getToolProgressKey(context: Record<string, any>): string | null {
    const totalCharacters = Array.isArray(context._createdCharacters)
      ? context._createdCharacters.length
      : 0
    return `${totalCharacters}:${Boolean(context._charactersFinalized)}`
  }

  protected getFinalToolNames(_context: Record<string, any>): string[] {
    return ['finalize_characters']
  }
}
