import type { WritingStyle } from '@/types/writingStyle'
import { generateId } from '@/lib/id'

export function createWritingStyle(data: {
  name: string
  description: string
  content: string
  source: 'manual' | 'ai-generated'
  tags: string[]
}): WritingStyle {
  const now = new Date().toISOString()
  return {
    id: generateId(),
    name: data.name,
    description: data.description,
    content: data.content,
    source: data.source,
    tags: data.tags,
    isBuiltIn: false,
    createdAt: now,
    updatedAt: now,
  }
}

export function normalizeWritingStyle(raw: Partial<WritingStyle>): WritingStyle {
  const now = new Date().toISOString()
  return {
    id: raw.id?.trim() || generateId(),
    name: raw.name?.trim() || 'Untitled Style',
    description: raw.description?.trim() || '',
    content: raw.content ?? '',
    source: raw.source === 'ai-generated' ? 'ai-generated' : 'manual',
    tags: Array.isArray(raw.tags) ? raw.tags.filter(Boolean) : [],
    isBuiltIn: Boolean(raw.isBuiltIn),
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
  }
}

export function normalizeWritingStyles(rawStyles: Partial<WritingStyle>[]): WritingStyle[] {
  return rawStyles.map(s => normalizeWritingStyle(s ?? {}))
}
