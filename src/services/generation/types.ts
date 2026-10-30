export interface ChapterAuditIssue {
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

export type NextGenerationAction =
  | { stage: 'planning' }
  | { stage: 'chapter-outline'; chapterIndex?: number }
  | { stage: 'writing'; chapterIndex: number }
  | { stage: 'proofreading'; chapterIndex: number }
  | { stage: 'polishing'; chapterIndex: number }
  | { stage: 'done' }
