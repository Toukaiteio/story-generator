import type { WritingStyle, WritingStyleSkill } from '@/types/writingStyle'
import { generateId } from '@/lib/id'

export function normalizeStyleSkill(raw: unknown): WritingStyleSkill | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Partial<WritingStyleSkill>
  const skill: WritingStyleSkill = {
    whenToUse: typeof value.whenToUse === 'string' ? value.whenToUse.trim() : '',
    signature: typeof value.signature === 'string' ? value.signature.trim() : '',
    rules: Array.isArray(value.rules) ? value.rules.map(String).map(item => item.trim()).filter(Boolean) : [],
    antiPatterns: Array.isArray(value.antiPatterns) ? value.antiPatterns.map(String).map(item => item.trim()).filter(Boolean) : [],
    exemplars: Array.isArray(value.exemplars) ? value.exemplars.map(String).map(item => item.trim()).filter(Boolean) : [],
  }
  const hasContent = skill.whenToUse || skill.signature || skill.rules.length || skill.antiPatterns.length || skill.exemplars.length
  return hasContent ? skill : undefined
}

export function createWritingStyle(data: {
  name: string
  description: string
  content: string
  source: 'manual' | 'ai-generated'
  tags: string[]
  skill?: WritingStyleSkill
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
    skill: normalizeStyleSkill(data.skill),
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
    skill: normalizeStyleSkill(raw.skill),
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
  }
}

export function normalizeWritingStyles(rawStyles: Partial<WritingStyle>[]): WritingStyle[] {
  return rawStyles.map(s => normalizeWritingStyle(s ?? {}))
}
