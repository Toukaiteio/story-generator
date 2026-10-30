/**
 * Pure presentation helpers re-exported for the UI. They have no state and no
 * network access, so keeping them behind the app layer prevents components from
 * reaching into engine module paths for formatting/rendering logic.
 */
export { detectMarkdown, markdownToHtml } from '@/services/markdown'
export { sanitizeGeneratedChapterContent } from '@/services/writingFormat'
export { countWords } from '@/services/agent/validation'
export { estimateTokens } from '@/services/knowledge/chunker'
export { buildProofreadingSegments } from '@/services/proofreading/chunking'
export type { ProofreadingSegment } from '@/services/proofreading/chunking'
export { hasAnyChapterPlanInfo, isChapterPlanComplete } from '@/services/generation/flow'
