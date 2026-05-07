import type { KnowledgeBase } from '@/types/knowledge'
import { estimateTokens } from '@/services/context'
import { knowledgeService } from './index'

export interface KnowledgeContextQueryInput {
  theme?: string
  genre?: string
  targetReader?: string
  language?: string
  style?: string
  customRequirements?: string
  outline?: string
  chapterTitle?: string
  chapterOutline?: string
  previousSummary?: string
  content?: string
}

export function buildKnowledgeQuery(input: KnowledgeContextQueryInput) {
  const parts = [
    input.theme,
    input.genre,
    input.targetReader,
    input.language,
    input.chapterTitle,
    input.chapterOutline,
    input.previousSummary,
    input.content,
    input.customRequirements,
  ]

  return parts.filter(part => typeof part === 'string' && part.trim()).join(' ')
}

export function buildKnowledgeContext(
  bases: KnowledgeBase[],
  query: string,
  maxTokens = 2400
) {
  const activeBases = bases.filter(base => base.documents.length > 0)
  if (!activeBases.length) return ''

  const perBaseBudget = Math.max(400, Math.floor(maxTokens / activeBases.length))
  const sections = activeBases
    .map(base => {
      const context = knowledgeService.getContextForGeneration(base, query, perBaseBudget)
      if (!context.trim()) return ''
      return `## ${base.name}\n${base.description ? `${base.description}\n\n` : ''}${context.trim()}`
    })
    .filter(Boolean)

  const combined = sections.join('\n\n')
  const estimated = estimateTokens(combined)
  if (estimated <= maxTokens) {
    return combined.trim()
  }

  return combined.trim().slice(0, Math.max(0, Math.floor(maxTokens * 4)))
}

export async function buildKnowledgeContextAsync(
  bases: KnowledgeBase[],
  query: string,
  maxTokens = 2400
) {
  const activeBases = bases.filter(base => base.documents.length > 0)
  if (!activeBases.length) return ''

  const perBaseBudget = Math.max(400, Math.floor(maxTokens / activeBases.length))
  const sections = await Promise.all(
    activeBases.map(async (base) => {
      const context = await knowledgeService.getContextForGenerationAsync(base, query, perBaseBudget)
      if (!context.trim()) return ''
      return `## ${base.name}\n${base.description ? `${base.description}\n\n` : ''}${context.trim()}`
    })
  )

  const combined = sections.filter(Boolean).join('\n\n')
  const estimated = estimateTokens(combined)
  if (estimated <= maxTokens) {
    return combined.trim()
  }

  return combined.trim().slice(0, Math.max(0, Math.floor(maxTokens * 4)))
}
