import type { KnowledgeBase } from '@/types/knowledge'
import type { ToolDefinition, ToolCall, ToolResult } from '@/services/provider/tools'
import { knowledgeService } from '@/services/knowledge'

export const KNOWLEDGE_TOOL_NAME = 'search_knowledge_base'

export function getKnowledgeTool(bases: KnowledgeBase[]): ToolDefinition {
  const baseList = bases.map(b => `"${b.name}"${b.description ? ` (${b.description})` : ''}`).join(', ')
  return {
    name: KNOWLEDGE_TOOL_NAME,
    description: `Search the project knowledge bases for relevant reference material. Available bases: ${baseList}. Use this tool when you need style guides, world-building details, character references, or any domain-specific information from the project's knowledge bases.`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query describing what information you need.',
        },
        baseName: {
          type: 'string',
          description: `Optional. Name of a specific knowledge base to search. One of: ${bases.map(b => `"${b.name}"`).join(', ')}. If omitted, all bases are searched.`,
        },
      },
      required: ['query'],
    },
  }
}

export async function handleKnowledgeToolCall(
  toolCall: ToolCall,
  bases: KnowledgeBase[]
): Promise<ToolResult> {
  const query = typeof toolCall.arguments.query === 'string' ? toolCall.arguments.query.trim() : ''
  if (!query) {
    return { tool_call_id: toolCall.id, content: JSON.stringify({ error: 'query is required' }) }
  }

  const targetBases = typeof toolCall.arguments.baseName === 'string'
    ? bases.filter(b => b.name === toolCall.arguments.baseName)
    : bases

  if (!targetBases.length) {
    return { tool_call_id: toolCall.id, content: JSON.stringify({ error: 'No matching knowledge base found' }) }
  }

  const sections = await Promise.all(
    targetBases.map(async (base) => {
      const results = await knowledgeService.searchAsync(base, query, 6)
      if (!results.length) return null
      const content = results.map(r => r.chunk.content).join('\n\n')
      return `## ${base.name}\n${content.trim()}`
    })
  )

  const combined = sections.filter(Boolean).join('\n\n').trim()
  if (!combined) {
    return { tool_call_id: toolCall.id, content: JSON.stringify({ result: 'No relevant content found for this query.' }) }
  }

  return { tool_call_id: toolCall.id, content: combined }
}
