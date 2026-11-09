export * from './engine'
export * from './data'
export * from './interactions'
export * from './textTools'
export * from './providerTools'
export * from './projectFiles'
export * from './workspace'
export * from './knowledge'
export * from './writingStyles'
export * from './vibe'

export type {
  ElementKind,
  ElementState,
  ElementStatus,
  StoryElement,
  ElementStateProposal,
} from '@/types/element'
export type { SelectionAction, SelectionContext, StudioActions } from './interactions'
export {
  elementStateAt,
  elementsActiveAt,
  latestElementState,
  buildElementContextForChapter,
  applyElementProposals as mergeElementProposals,
  isElementKind,
  isElementStatus,
  createElement,
  createElementState,
  appendElementState,
  normalizeElements,
  normalizeElementAliases,
} from '@/services/elements'
export {
  MARK_POPOVER_DELAY_MS,
  buildMarkDictionary,
  markText,
  extractPlainText,
  markPlainText,
  markTextToHtml,
  splitPlainText,
  joinPlainText,
  splicePlainText,
  type MarkDictionary,
  type MarkDictionaryEntry,
  type MarkedSegment,
  type MarkedText,
} from '@/services/elements/marking'
export { markPreviewHtml } from '@/services/elements/markingDom'
export {
  ELEMENT_STATUS_BY_KIND,
  ELEMENT_KINDS,
  statusesForKind,
  isStatusValidForKind,
  isTerminalStatus,
} from '@/services/elements/status'
export {
  applyCompletion,
  buildCompletionItems,
  isCjkChar,
  minimumPrefixLength,
  readCompletionContext,
  resolveCompletion,
  type CompletionContext,
  type CompletionItem,
  type CompletionRequest,
  type CompletionResult,
  type CompletionTrigger,
} from '@/services/elements/completion'
export {
  elementContextCapsules,
  type ElementContextCapsule,
  type ElementContextSlice,
} from '@/services/elements/context'
export {
  detectElementConflicts,
  detectProposalConflicts,
  resolveConflictKeepingLatest,
  type ElementStateConflict,
  type ElementConflictReason,
} from '@/services/elements/conflicts'
export {
  countStyleLibrary,
  styleCountLabel,
  type StyleLibraryCounts,
} from '@/services/writingStyle/library'

export {
  applyDiffHunks,
  buildTextDiff,
  diffFromOriginal,
  tokenizeText,
  type DiffHunk,
  type DiffSegment,
  type TextDiff,
} from '@/services/diff/textDiff'
export {
  acceptedHunkIds,
  composeReviewedText,
  createDiffReview,
  decideAll,
  decideHunk,
  hasAcceptedHunks,
  hunkRangeInCurrentText,
  isReviewSettled,
  pendingHunkCount,
  type DiffDecision,
  type DiffReview,
} from '@/services/diff/review'
export { paragraphRangeAt, type InlineTextRange } from '@/services/diff/inlineRange'
export {
  buildInlineDiffLayout,
  INLINE_DIFF_CONTEXT_LINES,
  type InlineDiffInput,
  type InlineDiffLayout,
  type InlineDiffParagraph,
  type InlineDiffPlacement,
  type InlineDiffRun,
  type InlineDiffRunType,
} from '@/services/diff/inlineDiff'
export {
  buildIssueChangeRuns,
  type IssueChangeRun,
  type IssueChangeRunType,
} from '@/services/proofreading/issuePreview'
