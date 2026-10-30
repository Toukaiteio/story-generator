import type { ID, Timestamps } from './common'

export type WritingStyleSource = 'manual' | 'ai-generated'

/**
 * A writing style authored as a reusable voice skill: when it applies, its
 * measurable signature, imperative rules, anti-patterns, and short exemplars.
 * `WritingStyle.content` remains the long-form guide.
 */
export interface WritingStyleSkill {
  whenToUse: string
  signature: string
  rules: string[]
  antiPatterns: string[]
  exemplars: string[]
}

export interface WritingStyle extends Timestamps {
  id: ID
  name: string
  description: string
  content: string
  source: WritingStyleSource
  tags: string[]
  isBuiltIn: boolean
  skill?: WritingStyleSkill
}
