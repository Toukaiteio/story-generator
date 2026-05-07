import type { ID, Timestamps } from './common'

export type ChapterStatus =
  | 'outline'
  | 'writing'
  | 'draft'
  | 'proofreading'
  | 'proofread'
  | 'polishing'
  | 'polished'

export interface ChapterOutline {
  objective: string
  conflict: string
  keyEvents: string[]
  characterActions: string[]
  infoReveals: string[]
  endingHook: string
}

export interface Chapter extends Timestamps {
  id: ID
  index: number
  title: string
  outline: ChapterOutline
  content: string
  proofreadContent: string
  polishedContent: string
  status: ChapterStatus
  summary: string
  characterStateUpdates: Record<ID, string>
}
