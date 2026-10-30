import type { ID, Timestamps } from './common'

export type ElementKind = 'character' | 'event' | 'thread' | 'location' | 'object'

export type ElementStatus =
  | 'introduced'
  | 'active'
  | 'changed'
  | 'resolved'
  | 'planted'
  | 'advanced'
  | 'paid'
  | 'unknown'

export interface ElementState {
  id: ID
  /** Story-time anchor. -1 means before the story starts. */
  chapterIndex: number
  time?: string
  location?: string
  status?: ElementStatus
  /** What is true about the element from this point on. */
  summary: string
  createdAt: string
}

export interface StoryElement extends Timestamps {
  id: ID
  kind: ElementKind
  name: string
  /** Set when kind is 'character' to link the rich Character profile. */
  characterId?: ID
  states: ElementState[]
}

export interface ElementStateProposal {
  /** Existing element id, empty when the proposal introduces a new element. */
  elementId?: ID
  name: string
  kind: ElementKind
  state: {
    chapterIndex: number
    time?: string
    location?: string
    status?: ElementStatus
    summary: string
  }
}
