import type { ID, Timestamps } from './common'

export type WritingStyleSource = 'manual' | 'ai-generated'

export interface WritingStyle extends Timestamps {
  id: ID
  name: string
  description: string
  content: string
  source: WritingStyleSource
  tags: string[]
  isBuiltIn: boolean
}
