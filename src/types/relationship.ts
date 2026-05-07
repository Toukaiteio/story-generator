import type { ID, Timestamps } from './common'

export type RelationshipSource = 'initial' | 'planned' | 'generated' | 'manual'
export type RelationshipStatus = 'active' | 'changed' | 'ended' | 'unknown'
export type RelationshipEventType =
  | 'first_meeting'
  | 'cooperation'
  | 'conflict'
  | 'betrayal'
  | 'reconciliation'
  | 'revelation'
  | 'rescue'
  | 'threat'
  | 'promise'
  | 'secret_shared'
  | 'secret_hidden'
  | 'romantic_shift'
  | 'trust_gain'
  | 'trust_loss'
  | 'separation'
  | 'other'

export interface CharacterRelationshipState {
  fromId: ID
  toId: ID
  label: string
  description: string
  status: RelationshipStatus
  trust: number
  affinity: number
  tension: number
  evidence: string
  updatedAtChapterIndex: number
  source: RelationshipSource
  recentEventIds: ID[]
}

export interface CharacterRelationshipEvent extends Timestamps {
  id: ID
  chapterId?: ID
  chapterIndex: number
  fromId: ID
  toId: ID
  type: RelationshipEventType
  summary: string
  label?: string
  description?: string
  status?: RelationshipStatus
  trustDelta?: number
  affinityDelta?: number
  tensionDelta?: number
  trust?: number
  affinity?: number
  tension?: number
  evidence?: string
  source: RelationshipSource
}

export interface ExtractedRelationshipEvent {
  fromName: string
  toName: string
  type?: RelationshipEventType
  summary?: string
  label?: string
  description?: string
  status?: RelationshipStatus
  trustDelta?: number
  affinityDelta?: number
  tensionDelta?: number
  evidence?: string
}

export interface RelationshipEventLocation {
  eventId: ID
  chapterId?: ID
  chapterIndex: number
  chapterTitle: string
  evidence: string
  excerpt: string
  approximateOffset: number | null
}
