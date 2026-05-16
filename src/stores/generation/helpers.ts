import { useProviderStore } from '@/stores/provider'
import { providerManager } from '@/services/provider'
import { fitMessagesToContextSmart, fitToContext } from '@/services/context'
import type { Character, CharacterRole } from '@/types/character'
import type { AgentType } from '@/types/agent'
import type { ChatMessage, ProviderModelRef } from '@/types/provider'
import type { ToolDefinition } from '@/services/provider'
import { getTodoListTool } from '@/services/agent/todolist'

export function getModelContextTokens(modelRef: ProviderModelRef): number | null {
  return providerManager.getModelConfigForRef(modelRef)?.model.contextTokens ?? null
}

export function fitMessagesForModel(messages: ChatMessage[], modelRef: ProviderModelRef, maxTokens: number): ChatMessage[] {
  return fitToContext(messages, getModelContextTokens(modelRef), maxTokens).messages
}

export function fitToolMessagesForModel(messages: ChatMessage[], modelRef: ProviderModelRef, maxTokens: number): ChatMessage[] {
  return fitMessagesToContextSmart(messages, getModelContextTokens(modelRef), maxTokens, {
    threshold: 0.6,
    preserveRecentGroups: 4,
  }).messages
}

export function getUsableAgentModelRef(role: AgentType, preferred?: ProviderModelRef | null): ProviderModelRef {
  const providerStore = useProviderStore()
  providerManager.setProviders(providerStore.providers)
  const modelRef = providerStore.getAvailableModelRefForRole(role, preferred)
  if (!modelRef) {
    throw new Error(`No model available for ${role}. Please configure an active provider first.`)
  }
  return modelRef
}

export function normalizeVibeCharacter(raw: any, index: number): Character {
  const now = new Date().toISOString()
  const roleValues: CharacterRole[] = ['protagonist', 'antagonist', 'supporting', 'minor']
  const role = roleValues.includes(raw?.role) ? raw.role : 'supporting'
  return {
    id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : `vibe-character-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : `Character ${index + 1}`,
    role,
    personality: Array.isArray(raw?.personality)
      ? raw.personality.map((item: unknown) => String(item).trim()).filter(Boolean)
      : typeof raw?.personality === 'string'
        ? raw.personality.split(/[,锛孿n]/).map((item: string) => item.trim()).filter(Boolean)
        : [],
    appearance: String(raw?.appearance ?? '').trim(),
    backstory: String(raw?.backstory ?? '').trim(),
    motivation: String(raw?.motivation ?? '').trim(),
    goals: String(raw?.goals ?? '').trim(),
    conflicts: String(raw?.conflicts ?? '').trim(),
    currentState: String(raw?.currentState ?? '').trim(),
    relations: Array.isArray(raw?.relations)
      ? raw.relations.map((relation: any) => ({
          targetId: String(relation?.targetId ?? relation?.targetName ?? '').trim(),
          relation: String(relation?.relation ?? '').trim(),
          description: String(relation?.description ?? '').trim(),
        })).filter((relation: any) => relation.relation || relation.description)
      : [],
    createdAt: typeof raw?.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: now,
  }
}

export function getVibePlanningTools(): ToolDefinition[] {
  return [
    getTodoListTool(),
    {
      name: 'replace_story_outline',
      description: 'Replace the current master story outline in the planning workspace.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Optional story title suggestion.' },
          synopsis: { type: 'string', description: 'Optional short synopsis.' },
          outline: { type: 'string', description: 'The complete replacement master story outline.' },
          summary: { type: 'string', description: 'Short summary of the outline change.' },
        },
        required: ['outline'],
      },
    },
    {
      name: 'replace_story_characters',
      description: 'Replace the planning workspace character list with generated character profiles.',
      parameters: {
        type: 'object',
        properties: {
          characters: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                role: { type: 'string', enum: ['protagonist', 'antagonist', 'supporting', 'minor'] },
                personality: { type: 'array', items: { type: 'string' } },
                appearance: { type: 'string' },
                backstory: { type: 'string' },
                motivation: { type: 'string' },
                goals: { type: 'string' },
                conflicts: { type: 'string' },
                currentState: { type: 'string' },
                relations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      targetId: { type: 'string' },
                      targetName: { type: 'string' },
                      relation: { type: 'string' },
                      description: { type: 'string' },
                    },
                  },
                },
              },
              required: ['name', 'role', 'personality', 'appearance', 'backstory', 'motivation', 'goals', 'conflicts', 'currentState'],
            },
          },
          summary: { type: 'string', description: 'Short summary of the character update.' },
        },
        required: ['characters'],
      },
    },
  ]
}
