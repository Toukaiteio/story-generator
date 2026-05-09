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

export interface ChapterProofreadingIssue {
  id: string
  severity: 'low' | 'medium' | 'high'
  category: 'chapter_plan' | 'character' | 'relationship' | 'continuity' | 'factual' | 'logic' | 'style' | 'grammar' | 'typo' | 'pacing' | 'consistency'
  title: string
  excerpt: string
  explanation: string
  suggestedFix: string
  ignored?: boolean
  adjustment?: string
  polishStatus?: 'pending' | 'fixed' | 'ignored' | 'failed'
  polishResult?: string
  segmentIndex?: number
  segmentTotal?: number
  segmentCharStart?: number
  segmentCharEnd?: number
  segmentTokenStart?: number
  segmentTokenEnd?: number
  segmentTokenTotal?: number
}

export interface Chapter extends Timestamps {
  id: ID
  index: number
  title: string
  outline: ChapterOutline
  content: string
  proofreadContent: string
  proofreadingIssues: ChapterProofreadingIssue[]
  polishedContent: string
  status: ChapterStatus
  summary: string
  characterStateUpdates: Record<ID, string>
}
