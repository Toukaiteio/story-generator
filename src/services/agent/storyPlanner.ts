import { BaseAgent, type AgentResult } from './base'
import type { AgentType } from '@/types/agent'
import type { ToolDefinition, ToolCall, ToolResult } from '@/services/provider/tools'
import { injectCustomSystemPrompt } from '@/services/systemPrompt'
import { containsChapterBreakdown, containsMetaCommentary, countWords, extractJsonPayload } from './validation'

export class StoryPlannerExpert extends BaseAgent {
  type: AgentType = 'storyPlanner'
  name = 'Story Planner'

  protected getValidationRetryLimit(): number {
    return 2
  }

  private getTargetCharacterCount(context: Record<string, any>): number {
    const preferred = Number(context.preferredCount)
    if (Number.isFinite(preferred)) {
      return Math.min(Math.max(Math.trunc(preferred), 4), 6)
    }
    return 5
  }

  protected getTools(): ToolDefinition[] {
    return [
      {
        name: 'create_story_outline',
        description: 'Create a story outline with title, synopsis, and story blueprint',
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
          },
          required: ['title', 'synopsis', 'outline'],
        },
      },
      {
        name: 'create_characters',
        description: 'Create characters for the story based on the outline',
        parameters: {
          type: 'object',
          properties: {
            characters: {
              type: 'array',
              description: 'Array of character objects',
              items: {
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
          },
          required: ['characters'],
        },
      },
    ]
  }

  private getOutlineTools(): ToolDefinition[] {
    return this.getTools().filter(tool => tool.name === 'create_story_outline')
  }

  private getCharacterTools(): ToolDefinition[] {
    return this.getTools().filter(tool => tool.name === 'create_characters')
  }

  protected async handleToolCall(toolCall: ToolCall, context: Record<string, any>): Promise<ToolResult> {
    if (toolCall.name === 'create_story_outline') {
      context._outlineData = toolCall.arguments
      if (typeof context._onOutlineUpdated === 'function') {
        await context._onOutlineUpdated(toolCall.arguments)
      }
      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: true, message: 'Story outline created successfully' }),
      }
    }

    if (toolCall.name === 'create_characters') {
      const targetCount = this.getTargetCharacterCount(context)
      const characters = Array.isArray(toolCall.arguments.characters) ? toolCall.arguments.characters : []
      if (characters.length !== targetCount) {
        return {
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: `Expected exactly ${targetCount} characters, but received ${characters.length}. Call create_characters again with exactly ${targetCount} complete characters.`,
            totalCharacters: characters.length,
            targetCharacters: targetCount,
          }),
        }
      }

      const roleIssues = this.validateCharacterRoleComposition(characters)
      if (roleIssues.length) {
        return {
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: roleIssues.join(' '),
            issues: roleIssues,
            totalCharacters: characters.length,
            targetCharacters: targetCount,
          }),
        }
      }

      context._charactersData = toolCall.arguments.characters
      if (typeof context._onCharactersUpdated === 'function') {
        await context._onCharactersUpdated(context._charactersData)
      }
      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: true, message: 'Characters created successfully', totalCharacters: toolCall.arguments.characters.length, targetCharacters: targetCount }),
      }
    }

    return {
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
    }
  }

  protected getSystemPrompt(): string {
    return `You are an expert story planner. Your job is to create a concise story blueprint, not a chapter plan.

The outline should:
- Focus on the central premise, conflict, stakes, and major turning points
- Stay at story-arc level and leave chapter planning to the Chapter Agent
- Avoid scene-by-scene or chapter-by-chapter breakdowns
- Be concise and direct, roughly 80-220 words for the outline field

Use the create_story_outline tool to create the story outline.
Then use the create_characters tool to create the exact requested number of main characters with interconnected relationships.
The character set must include exactly one protagonist and at least one antagonist or opposing force.

Do not omit any fields. Do not add meta commentary or code fences outside the tools.`
  }

  protected shouldStopAfterToolCallRound(context: Record<string, any>): boolean {
    if (context._storyPlannerPhase === 'outline') return Boolean(context._outlineData)
    if (context._storyPlannerPhase === 'characters') return Array.isArray(context._charactersData) && context._charactersData.length > 0
    return false
  }

  protected getToolResultContent(context: Record<string, any>): string | null {
    if (context._storyPlannerPhase === 'outline' && context._outlineData) {
      return JSON.stringify(context._outlineData)
    }
    if (context._storyPlannerPhase === 'characters' && Array.isArray(context._charactersData)) {
      return JSON.stringify({ characters: context._charactersData })
    }
    return null
  }

  protected getCharacterSystemPrompt(): string {
    return `You are an expert character designer. Your job is to create rich, multi-dimensional characters that drive the story forward.

The characters should:
- Have clear motivations, goals, and flaws
- Possess distinct voices and personalities
- Have meaningful relationships with other characters
- Drive the plot through their choices and growth
- Include exactly one protagonist and at least one antagonist or opposing force
- Treat the remaining main cast as supporting characters with clear story functions, not filler

Use the create_characters tool to provide the characters.

Do not omit any fields. Do not add meta commentary or code fences outside the tools.`
  }

  protected buildOutlinePrompt(context: Record<string, any>): string {
    const { theme, genre, targetReader, language, style, chapterCount, constraints, customRequirements, knowledgeContext } = context

    return `Create a story-planning JSON object with the following specifications:

**Theme:** ${theme}
**Genre:** ${genre}
**Target Reader:** ${targetReader}
**Primary Language:** ${language || 'English'}
${style ? `**Writing Style Guide:**\n${style}` : '**Writing Style:** Infer an appropriate writing style from the genre, theme, and target reader.'}
**Chapter Count:** ${chapterCount || 8} chapters
${constraints?.required?.length ? `**Must Include:** ${constraints.required.join(', ')}` : ''}
${constraints?.forbidden?.length ? `**Must Not Include:** ${constraints.forbidden.join(', ')}` : ''}
${customRequirements ? `**Additional Requirements:** ${customRequirements}` : ''}
${knowledgeContext ? `\n**Reference Material:**\n${knowledgeContext}` : ''}

Use the create_story_outline tool to create a story outline with:
1. A compelling story title
2. A brief synopsis (2-3 sentences)
3. A concise story blueprint in the outline field

The outline must stay at the story level and summarize:
- The premise and central conflict
- The major turning points of the full story arc
- The key character functions and relationships
- The thematic direction and ending pressure

Do not include chapter headings, chapter-by-chapter breakdowns, scene lists, or long prose in the outline field. Keep the outline concise, roughly 80-220 words. Use the chapter count only to judge the scope and pacing of the overall arc.
Write everything in ${language || 'English'}.`
  }

  protected buildCharacterPrompt(context: Record<string, any>, outlineData: any): string {
    const { language } = context
    const targetCount = this.getTargetCharacterCount(context)

    return `Based on this story outline, create exactly ${targetCount} main characters with interconnected relationships. Do not create fewer than ${targetCount} characters:

**Story Title:** ${outlineData.title}
**Synopsis:** ${outlineData.synopsis}
**Outline:** ${outlineData.outline}

Use the create_characters tool once with exactly ${targetCount} character objects that:
- Fit naturally into the story outline
- Have explicit roles (protagonist, antagonist, supporting, or minor)
- Have 3-5 distinct personality traits each
- Have meaningful relationships with other characters
- Drive the plot through their choices and growth
- Include a balanced cast with exactly one protagonist, at least one antagonist or opposing force, and supporting characters that cover subplots, pressure, or contrast
- Make every main character's function obvious and avoid leaving any main cast member role-ambiguous

Character names must be unique. Each character needs all required fields filled out.
Write everything in ${language || 'English'}.`
  }

  protected buildPrompt(context: Record<string, any>): string {
    return this.buildOutlinePrompt(context)
  }

  parseResponse(response: string): any {
    try {
      const parsed = JSON.parse(extractJsonPayload(response))

      // If this is an outline response (has title and synopsis)
      if (parsed.title && parsed.synopsis && parsed.outline) {
        return parsed
      }

      // If this is a characters response
      if (parsed.characters && Array.isArray(parsed.characters)) {
        return parsed
      }

      return parsed
    } catch {
      return { raw: response }
    }
  }

  protected validateOutput(response: string, parsed: any, context: Record<string, any>): string[] {
    const issues: string[] = []
    const text = response.trim()

    if (!text) issues.push('Response is empty')
    if (containsMetaCommentary(text)) issues.push('Response contains meta commentary or code fences')

    // When using tools, validation is handled by the tool execution
    // Only validate if we have raw output (fallback mode)
    if (parsed && parsed.raw) {
      return issues
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      issues.push('Response must be a JSON object')
      return issues
    }

    // Validate outline response
    if (parsed.title !== undefined) {
      return this.validateOutlineOutput(parsed, issues)
    }

    // Validate characters response
    if (parsed.characters !== undefined) {
      return this.validateCharactersOutput(parsed, issues, this.getTargetCharacterCount(context))
    }

    issues.push('Response must contain either outline data or characters data')
    return issues
  }

  private validateOutlineOutput(parsed: any, issues: string[]): string[] {
    const outlineText = typeof parsed.outline === 'string' ? parsed.outline.trim() : ''
    const compactLength = outlineText.replace(/\s+/g, '').length

    if (typeof parsed.title !== 'string' || !parsed.title.trim()) {
      issues.push('Title is missing or empty')
    }

    if (typeof parsed.synopsis !== 'string' || !parsed.synopsis.trim()) {
      issues.push('Synopsis is missing or empty')
    }

    if (!outlineText) {
      issues.push('Outline is missing or empty')
    } else {
      const wordCount = countWords(outlineText)
      if (wordCount < 40 && compactLength < 180) {
        issues.push('Outline is too short; expand it into a concise story blueprint')
      }
      if (wordCount > 220 || compactLength > 1200) {
        issues.push('Outline is too detailed; keep it at the story blueprint level and leave chapters to Chapter Agent')
      }
      if (containsChapterBreakdown(outlineText)) {
        issues.push('Outline should not include chapter-by-chapter breakdowns')
      }
    }

    return issues
  }

  private validateCharactersOutput(parsed: any, issues: string[], targetCount = 5): string[] {
    if (!Array.isArray(parsed.characters)) {
      issues.push('Characters must be a JSON array')
      return issues
    }

    if (parsed.characters.length !== targetCount) {
      issues.push(`Characters array must contain exactly ${targetCount} entries`)
    }

    issues.push(...this.validateCharacterRoleComposition(parsed.characters))

    const allowedRoles = new Set(['protagonist', 'antagonist', 'supporting', 'minor'])
    const seenNames = new Set<string>()

    parsed.characters.forEach((item: any, index: number) => {
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

  private validateCharacterRoleComposition(items: any[]): string[] {
    const issues: string[] = []
    let protagonistCount = 0
    let antagonistCount = 0

    for (const item of items) {
      const role = typeof item?.role === 'string' ? item.role.trim().toLowerCase() : ''
      if (role === 'protagonist') protagonistCount += 1
      if (role === 'antagonist') antagonistCount += 1
    }

    if (protagonistCount !== 1) {
      issues.push(`Character set must contain exactly one protagonist; found ${protagonistCount}.`)
    }

    if (antagonistCount < 1) {
      issues.push('Character set must contain at least one antagonist or opposing force.')
    }

    return issues
  }

  protected buildRepairPrompt(context: Record<string, any>, previousResponse: string, issues: string[]): string {
    // If we're repairing an outline (no outline data generated yet)
    if (!context._outlineData || previousResponse.includes('title')) {
      return `The previous story outline did not satisfy the required JSON schema.

Issues:
${issues.map(issue => `- ${issue}`).join('\n')}

Original task:
${this.buildOutlinePrompt(context)}

Previous output:
${previousResponse}

Use the create_story_outline tool to provide a corrected story outline.
The outline must be a concise story blueprint and must not include chapter divisions, scene lists, or chapter headings.
Keep the story intent intact and do not omit any required fields.`
    }

    // If we're repairing characters
    return `The previous character list did not satisfy the required JSON schema.

Issues:
${issues.map(issue => `- ${issue}`).join('\n')}

Story context:
${context._outlineData?.outline || ''}

Original task:
${this.buildCharacterPrompt(context, { title: '', synopsis: '', outline: context._outlineData?.outline || '' })}

Previous output:
${previousResponse}

Use the create_characters tool to provide a corrected character list.
Keep the character concepts intact and do not omit any required fields. The list must contain exactly ${this.getTargetCharacterCount(context)} characters, with exactly one protagonist and at least one antagonist or opposing force.`
  }

  async execute(context: Record<string, any>, onToken?: (token: string) => void): Promise<AgentResult> {
    if (!this.model) {
      throw new Error(`${this.name} has no model assigned`)
    }

    // Step 1: Generate outline
    const outlineResult = await this.executeOutlineGeneration(context, onToken)
    const outlineData = context._outlineData || JSON.parse(extractJsonPayload(outlineResult.content))

    // Step 2: Generate characters based on outline
    const characterResult = await this.executeCharacterGeneration(context, outlineData, onToken)
    const characterData = context._charactersData || JSON.parse(extractJsonPayload(characterResult.content))

    // Combine results
    const combined = {
      ...outlineData,
      characters: characterData,
    }

    return {
      content: JSON.stringify(combined),
      tokenUsage: { prompt: 0, completion: 0 },
      ...this.getCompressionReport(),
    }
  }

  private async executeOutlineGeneration(context: Record<string, any>, onToken?: (token: string) => void): Promise<AgentResult> {
    const retryLimit = this.getValidationRetryLimit()
    let previousResponse = ''
    let lastIssues: string[] = []
    delete context._outlineData
    context._storyPlannerPhase = 'outline'

    for (let attempt = 0; attempt <= retryLimit; attempt++) {
      const userPrompt = attempt === 0
        ? this.buildOutlinePrompt(context)
        : this.buildRepairPrompt(context, previousResponse, lastIssues)

      const messages = [
        { role: 'system' as const, content: injectCustomSystemPrompt(this.getSystemPrompt()) },
        { role: 'user' as const, content: userPrompt },
      ]


      // Use function calling with tools
      const tools = this.getOutlineTools()
      if (!this.model) throw new Error(`${this.name} has no model assigned`)
      
      const result = await this.executeWithTools(
        messages,
        tools,
        context,
        onToken,
        this.temperature
      )

      const content = result.content
      previousResponse = content

      let parsed: any
      let issues: string[] = []

      // If tools were used and populated the context, use that data for validation
      if (context._outlineData) {
        parsed = context._outlineData
        issues = this.validateOutput(content || JSON.stringify(parsed), parsed, context)
      } else {
        // Otherwise try to parse the raw text content (legacy/fallback mode)
        try {
          parsed = this.parseResponse(content)
          issues = this.validateOutput(content, parsed, context)
        } catch (error: any) {
          issues = [error?.message || 'Failed to parse outline response']
        }
      }

      if (!issues.length) {
        return {
          content: content || JSON.stringify(parsed, null, 2),
          tokenUsage: { prompt: 0, completion: 0 },
          ...this.getCompressionReport(),
        }
      }

      lastIssues = issues
    }

    throw new Error(`Story Planner failed to generate valid outline: ${lastIssues.join('; ')}`)
  }

  private async executeCharacterGeneration(context: Record<string, any>, outlineData: any, onToken?: (token: string) => void): Promise<AgentResult> {
    const retryLimit = this.getValidationRetryLimit()
    let previousResponse = ''
    let lastIssues: string[] = []
    delete context._charactersData
    context._storyPlannerPhase = 'characters'

    for (let attempt = 0; attempt <= retryLimit; attempt++) {
      const userPrompt = attempt === 0
        ? this.buildCharacterPrompt(context, outlineData)
        : this.buildRepairPrompt(context, previousResponse, lastIssues)

      const messages = [
        { role: 'system' as const, content: injectCustomSystemPrompt(this.getCharacterSystemPrompt()) },
        { role: 'user' as const, content: userPrompt },
      ]


      // Use function calling with tools
      const tools = this.getCharacterTools()
      if (!this.model) throw new Error(`${this.name} has no model assigned`)
      
      const result = await this.executeWithTools(
        messages,
        tools,
        context,
        onToken,
        this.temperature
      )

      const content = result.content
      previousResponse = content

      let parsed: any
      let issues: string[] = []

      // If tools were used and populated the context, use that data for validation
      if (context._charactersData) {
        parsed = { characters: context._charactersData }
        issues = this.validateOutput(content || JSON.stringify(parsed), parsed, context)
      } else {
        // Otherwise try to parse the raw text content (legacy/fallback mode)
        try {
          parsed = this.parseResponse(content)
          issues = this.validateOutput(content, parsed, context)
        } catch (error: any) {
          issues = [error?.message || 'Failed to parse characters response']
        }
      }

      if (!issues.length) {
        return {
          content: content || JSON.stringify(parsed, null, 2),
          tokenUsage: { prompt: 0, completion: 0 },
          ...this.getCompressionReport(),
        }
      }

      lastIssues = issues
    }

    throw new Error(`Story Planner failed to generate valid characters: ${lastIssues.join('; ')}`)
  }
}
