import type { ToolDefinition } from '@/services/provider/tools'

/**
 * Shared character property schema used by CharacterExpert and StoryPlannerExpert.
 * Defines the JSON Schema for a single character object.
 */
export const characterProperties = {
  name: { type: 'string' as const, description: "The character's full name" },
  role: {
    type: 'string' as const,
    description: "The character's role in the story",
    enum: ['protagonist', 'antagonist', 'supporting', 'minor'],
  },
  personality: {
    type: 'array' as const,
    description: '3-5 concise personality traits',
    items: { type: 'string' as const },
  },
  appearance: { type: 'string' as const, description: 'Physical appearance description' },
  backstory: { type: 'string' as const, description: "Character's background history" },
  motivation: { type: 'string' as const, description: 'What drives this character' },
  goals: { type: 'string' as const, description: "Character's objectives in the story" },
  conflicts: { type: 'string' as const, description: 'Internal or external conflicts the character faces' },
  currentState: { type: 'string' as const, description: "Character's current situation or state" },
  relations: {
    type: 'array' as const,
    description: 'Relationships with other characters',
    items: {
      type: 'object' as const,
      properties: {
        targetName: { type: 'string' as const, description: 'Name of the related character' },
        relation: { type: 'string' as const, description: 'Type of relationship (e.g., friend, enemy, sibling)' },
        description: { type: 'string' as const, description: 'Description of the relationship' },
      },
      required: ['targetName', 'relation', 'description'],
    },
  },
} as const

export const characterRequiredFields = [
  'name', 'role', 'personality', 'appearance', 'backstory',
  'motivation', 'goals', 'conflicts', 'currentState',
] as const

/**
 * Create a ToolDefinition for a single character creation tool.
 */
export function createCharacterTool(description: string): ToolDefinition {
  return {
    name: 'create_character',
    description,
    parameters: {
      type: 'object',
      properties: characterProperties as any,
      required: [...characterRequiredFields],
    },
  }
}

/**
 * Create a ToolDefinition for a batch character creation tool.
 */
export function createBatchCharacterTool(description: string): ToolDefinition {
  return {
    name: 'create_characters',
    description,
    parameters: {
      type: 'object',
      properties: {
        characters: {
          type: 'array',
          description: 'Array of character objects',
          items: {
            type: 'object',
            properties: characterProperties as any,
            required: [...characterRequiredFields],
          },
        },
      },
      required: ['characters'],
    },
  }
}
