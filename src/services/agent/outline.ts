import { BaseAgent } from './base'
import type { AgentType } from '@/types/agent'
import type { ToolDefinition, ToolCall, ToolResult } from '@/services/provider/tools'
import { containsChapterBreakdown, containsMetaCommentary, countWords } from './validation'

export class OutlineExpert extends BaseAgent {
  type: AgentType = 'outline'
  name = 'Outline Expert'

  protected getTools(): ToolDefinition[] {
    return [
      {
        name: 'create_outline',
        description: 'Create a story blueprint with title, synopsis, and story arc',
        parameters: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'A compelling story title',
            },
            synopsis: {
              type: 'string',
              description: 'A brief synopsis (2-3 sentences)',
            },
            outline: {
              type: 'string',
              description: 'A concise story blueprint covering premise, conflict, major beats, and thematic direction',
            },
            characterSignals: {
              type: 'string',
              description: 'Signals about which character roles need to be created or strengthened',
            },
          },
          required: ['title', 'synopsis', 'outline'],
        },
      },
      {
        name: 'refine_outline',
        description: 'Refine an existing story blueprint with character information',
        parameters: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'The refined story title',
            },
            synopsis: {
              type: 'string',
              description: 'The refined synopsis',
            },
            outline: {
              type: 'string',
              description: 'The refined story blueprint',
            },
          },
          required: ['title', 'synopsis', 'outline'],
        },
      },
    ]
  }

  protected async handleToolCall(toolCall: ToolCall, context: Record<string, any>): Promise<ToolResult> {
    if (toolCall.name === 'create_outline' || toolCall.name === 'refine_outline') {
      // Store the outline data in context
      context._outlineData = toolCall.arguments
      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: true, message: 'Outline created/refined successfully' }),
      }
    }

    return {
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
    }
  }

  protected getSystemPrompt(): string {
    return `You are an expert story blueprint creator. Your job is to create a compact story blueprint, not a chapter plan.

Focus on:
- The central premise and story promise
- The main conflict and stakes
- The major turning points of the full story arc
- The important character functions and relationships
- The narrative direction needed for later chapter planning

Do not write chapter-by-chapter breakdowns, scene lists, or chapter headings.
Do not add meta commentary or code fences.

Use the create_outline tool to create the story blueprint.
If refining with character information, use the refine_outline tool.`
  }

  protected buildPrompt(context: Record<string, any>): string {
    const {
      theme,
      genre,
      targetReader,
      language,
      style,
      length,
      constraints,
      customRequirements,
      knowledgeContext,
      planningMode,
      characters,
      characterSignals,
      title,
      synopsis,
    } = context

    const lengthGuide: Record<string, string> = {
      short: 'tight, focused story arc',
      medium: 'balanced multi-beat story arc',
      long: 'broad story arc with more turning points, still no chapter breakdown',
    }

    const basePrompt = `Create a story blueprint with the following specifications:

**Theme:** ${theme}
**Genre:** ${genre}
**Target Reader:** ${targetReader}
**Primary Language:** ${language || 'English'}
${style ? `**Writing Style Guide:**\n${style}` : '**Writing Style:** Infer an appropriate writing style from the genre, theme, and target reader.'}
**Length:** ${length} (${lengthGuide[length] || length})
${constraints?.required?.length ? `**Must Include:** ${constraints.required.join(', ')}` : ''}
${constraints?.forbidden?.length ? `**Must Not Include:** ${constraints.forbidden.join(', ')}` : ''}
${customRequirements ? `**Additional Requirements:** ${customRequirements}` : ''}
${knowledgeContext ? `\n**Reference Material:**\n${knowledgeContext}` : ''}`

    if (planningMode === 'draft') {
      return `${basePrompt}

This is a planning draft. Use the create_outline tool to create a compact story blueprint.

The Story Blueprint should summarize the full story arc at a high level using 3-6 bullet points or a short paragraph.
Do not break the story into chapters, scenes, or episode-by-episode material.

The Character Signals should indicate which roles still need to be created or strengthened, and whether a separate character-generation pass is needed.
If no new characters are needed, write "none".

Keep the whole draft concise and focused on the story-level blueprint. Aim for roughly 120-220 words total.
Write everything in ${language || 'English'}.`
    }

    if (planningMode === 'refine') {
      return `${basePrompt}

Refine the story blueprint using the confirmed character set below.

Working title:
${title || 'Not provided'}

Working synopsis:
${synopsis || 'Not provided'}

Confirmed characters:
${characters || 'No characters yet.'}

Character signals from the draft:
${characterSignals || 'none'}

Use the refine_outline tool to revise the story blueprint so it aligns with the characters' motivations, conflicts, and relationships.
Keep the refined blueprint concise and story-level. Do not write chapter-by-chapter material or scene lists. Aim for roughly 120-220 words total.
Write everything in ${language || 'English'}.`
    }

    if (planningMode === 'review') {
      return `${basePrompt}

This is a quick self-review pass. Check the current outline for obvious logic errors, missing stakes, role mismatches, or accidental chapter-level leakage.

Current title:
${title || 'Not provided'}

Current synopsis:
${synopsis || 'Not provided'}

Current outline:
${context.outline || 'Not provided'}

Characters:
${characters || 'No characters yet.'}

If the outline is already sound, use refine_outline with the same structure and make only minimal clarity fixes.
If you spot an obvious problem, use refine_outline to correct it without expanding into chapter-by-chapter detail.
Keep the result compact and story-level.`
    }

    return `${basePrompt}

Use the create_outline tool to provide the story blueprint in ${language || 'English'}.

Include:
1. A compelling story title
2. A brief synopsis (2-3 sentences)
3. A concise story blueprint with the major turning points of the full story
4. Major character functions and relationships
5. Thematic direction

Do not break the story into chapters or scenes. Keep the result story-level, not chapter-level.`
  }

  parseResponse(response: string): any {
    return { raw: response }
  }

  protected validateOutput(response: string, parsed: any, context: Record<string, any>): string[] {
    const issues: string[] = []
    const text = response.trim()
    const compactLength = text.replace(/\s+/g, '').length
    const planningMode = typeof context?.planningMode === 'string' ? context.planningMode : ''
    const hasChapterBreakdown = containsChapterBreakdown(text)

    if (!text) issues.push('Outline is empty')
    if (containsMetaCommentary(text)) issues.push('Outline contains meta commentary or code fences')

    // When using tools, validation is handled by the tool execution
    // Only validate if we have raw output (fallback mode)
    if (parsed && parsed.raw) {
      return issues
    }

    if (planningMode === 'draft') {
      if (countWords(text) < 40 && compactLength < 180) {
        issues.push('Draft is too short; expand it into a compact story blueprint')
      }
      if (hasChapterBreakdown) {
        issues.push('Draft should not contain chapter-by-chapter breakdowns')
      }
      if (countWords(text) > 260 || compactLength > 1200) {
        issues.push('Draft is too detailed; keep it at the story blueprint level and leave chapters to Chapter Agent')
      }
      return issues
    }

    if (planningMode === 'refine' || planningMode === 'review' || !planningMode) {
      if (countWords(text) < 40 && compactLength < 180) issues.push('Outline is too short; expand it into a compact story blueprint')
      if (countWords(text) > 220 || compactLength > 1200) issues.push('Outline is too detailed; keep it at the story blueprint level and leave chapters to Chapter Agent')
      if (hasChapterBreakdown) {
        issues.push('Outline should not contain chapter-by-chapter breakdowns')
      }
      if (/character signals/i.test(text)) {
        issues.push('Refined outline should not include a Character Signals section')
      }
      return issues
    }

    return issues
  }

  protected buildRepairPrompt(context: Record<string, any>, previousResponse: string, issues: string[]): string {
    const { planningMode, characters, characterSignals, title, synopsis } = context

    if (planningMode === 'draft') {
      return `The previous planning draft did not satisfy the required structure.

Issues:
${issues.map(issue => `- ${issue}`).join('\n')}

Original task:
${this.buildPrompt(context)}

Previous response:
${previousResponse}

Use the create_outline tool to rewrite the draft with proper structure.
Keep the story intent intact and include a clear handoff for character creation.
Keep it at the story blueprint level and do not add chapter-by-chapter detail or scene lists.`
    }

    if (planningMode === 'refine') {
      return `The previous outline refinement did not satisfy the required structure.

Issues:
${issues.map(issue => `- ${issue}`).join('\n')}

Working title:
${title || 'Not provided'}

Working synopsis:
${synopsis || 'Not provided'}

Confirmed characters:
${characters || 'No characters yet.'}

Character signals from the draft:
${characterSignals || 'none'}

Original task:
${this.buildPrompt(context)}

Previous response:
${previousResponse}

Use the refine_outline tool to rewrite the outline as a polished story blueprint only.
Keep the cast aligned with the story-level beats and omit any Character Signals section.
Do not add chapter-by-chapter detail or scene lists.`
    }

    if (planningMode === 'review') {
      return `The previous outline self-review still found an issue.

Issues:
${issues.map(issue => `- ${issue}`).join('\n')}

Working title:
${title || 'Not provided'}

Working synopsis:
${synopsis || 'Not provided'}

Confirmed characters:
${characters || 'No characters yet.'}

Original task:
${this.buildPrompt(context)}

Previous response:
${previousResponse}

Use the refine_outline tool to make only the minimal correction needed to remove the obvious issue.
Keep the outline compact, story-level, and free of chapter-by-chapter detail or scene lists.`
    }

    return `The previous outline was incomplete or invalid.

Issues:
${issues.map(issue => `- ${issue}`).join('\n')}

Original requirements:
${this.buildPrompt(context)}

Previous outline:
${previousResponse}

Use the create_outline tool to rewrite the outline so it is a concise story blueprint, fully aligned with the original constraints, and explicitly not chapter-based or scene-based.`
  }
}
