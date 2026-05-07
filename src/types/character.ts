import type { ID, Timestamps } from './common'

export type CharacterRole = 'protagonist' | 'antagonist' | 'supporting' | 'minor'

export interface CharacterRelation {
  targetId: ID
  relation: string
  description: string
}

export interface Character extends Timestamps {
  id: ID
  name: string
  role: CharacterRole
  personality: string[]
  appearance: string
  backstory: string
  motivation: string
  goals: string
  conflicts: string
  currentState: string
  relations: CharacterRelation[]
}
