import type { ID, Timestamps } from './common'
import type { ChapterAuditIssue } from '@/services/generation/types'

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

export interface ChapterContentVersion {
  id: ID
  label: string
  content: string
  proofreadingIssues?: ChapterAuditIssue[]
  createdAt: string
}

export interface Chapter extends Timestamps {
  id: ID
  index: number
  title: string
  outline: ChapterOutline
  content: string
  proofreadingIssues: ChapterAuditIssue[]
  proofreadingIssuesStale?: boolean
  contentVersions: ChapterContentVersion[]
  polishedContent: string
  status: ChapterStatus
  summary: string
  characterStateUpdates: Record<ID, string>
}
