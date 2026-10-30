import { describe, expect, it } from 'vitest'
import { buildProjectStylePrompt, buildWritingStyleSnapshot, formatStyleSkill } from '../skill'
import { normalizeStyleSkill } from '../storage'
import type { StoryProject } from '@/types/project'
import type { WritingStyle } from '@/types/writingStyle'

const style: WritingStyle = {
  id: 'style-1',
  name: 'Cold Close Third',
  description: 'Detached close third for political thrillers.',
  content: '# Guide\nKeep sentences short. No metaphors.',
  source: 'ai-generated',
  tags: ['thriller'],
  isBuiltIn: false,
  skill: {
    whenToUse: 'Political thriller, close third, past tense.',
    signature: 'Short declaratives, 12-word average, little interiority.',
    rules: ['Name the action before the thought.', 'Cut every metaphor.'],
    antiPatterns: ['Purple prose', 'Omniscient asides'],
    exemplars: ['He read the file twice. The second name was his.'],
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function project(overrides: Partial<StoryProject> = {}): StoryProject {
  return {
    id: 'p1',
    name: 'Test',
    directoryPath: '',
    theme: '',
    genre: 'thriller',
    targetReader: '',
    language: 'English',
    style: style.content,
    styleId: style.id,
    writingStyleSnapshot: buildWritingStyleSnapshot(style, style.content),
    writingFormat: 'plaintext',
    chapterCount: 8,
    chapterConfig: { maxChapters: 8 },
    constraints: { required: [], forbidden: [] },
    customRequirements: '',
    chapters: [],
    characters: [],
    relationshipEvents: [],
    knowledgeBaseIds: [],
    status: 'draft',
    generationStage: 'idle',
    outline: '',
    summary: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('style skill normalization', () => {
  it('keeps valid fields and drops junk', () => {
    const skill = normalizeStyleSkill({
      whenToUse: '  Thriller. ',
      signature: '',
      rules: [' Rule one ', '', 42],
      antiPatterns: 'not an array',
      exemplars: ['Passage.'],
    })
    expect(skill).toEqual({
      whenToUse: 'Thriller.',
      signature: '',
      rules: ['Rule one', '42'],
      antiPatterns: [],
      exemplars: ['Passage.'],
    })
  })

  it('returns undefined for empty skills', () => {
    expect(normalizeStyleSkill({ rules: [] })).toBeUndefined()
    expect(normalizeStyleSkill(null)).toBeUndefined()
  })
})

describe('style skill prompt', () => {
  it('formats skill sections in load order', () => {
    const text = formatStyleSkill(style.skill, style.name)
    expect(text.indexOf('Voice skill')).toBeLessThan(text.indexOf('When to use'))
    expect(text).toContain('Voice signature')
    expect(text).toContain('- Cut every metaphor.')
    expect(text).toContain('Avoid:')
    expect(text).toContain('Exemplars')
  })

  it('puts the compact skill before the full guide', () => {
    const text = buildProjectStylePrompt(project())
    expect(text.indexOf('Voice skill')).toBe(0)
    expect(text.indexOf('Full style guide')).toBeGreaterThan(text.indexOf('Exemplars'))
  })

  it('falls back to the guide when there is no skill', () => {
    const text = buildProjectStylePrompt(project({
      writingStyleSnapshot: { ...project().writingStyleSnapshot!, skill: undefined },
    }))
    expect(text).toBe(style.content)
  })

  it('captures the skill in the project snapshot', () => {
    const snapshot = buildWritingStyleSnapshot(style, style.content)
    expect(snapshot?.skill?.rules).toEqual(['Name the action before the thought.', 'Cut every metaphor.'])
    expect(snapshot?.name).toBe('Cold Close Third')
  })
})
