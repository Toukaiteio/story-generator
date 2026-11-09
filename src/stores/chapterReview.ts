import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  acceptedHunkIds,
  composeReviewedText,
  createDiffReview,
  decideAll as applyDecisionToAll,
  decideHunk as applyDecisionToHunk,
  hasAcceptedHunks,
  pendingHunkCount,
  type DiffDecision,
  type DiffReview,
} from '@/services/diff/review'

export interface ReviewProposal {
  chapterId: string
  label: string
  /** Chapter text at the moment the AI result arrived. Never edited in place. */
  base: string
  /** The exact text the AI was given. */
  original: string
  /** The AI result, frozen for the life of the review. */
  revised: string
  /** Range of `original` inside `base`. */
  start: number
  end: number
  /** Kept for routing compatibility; every review now renders inline. */
  inline?: boolean
}

export type ReviewSession = DiffReview & ReviewProposal

export interface SettledReview {
  chapterId: string
  start: number
  end: number
  original: string
  text: string
  label: string
}

/**
 * One AI proposal at a time, shared across the workstation so a polish started
 * from the board, Copilot, or the command palette lands in the same inline
 * review. Nothing here writes the chapter.
 */
export const useChapterReview = defineStore('chapterReview', () => {
  const active = ref<ReviewSession | null>(null)

  const visible = computed(() => Boolean(active.value))
  const settled = computed(() => Boolean(active.value) && pendingHunkCount(active.value as ReviewSession) === 0)
  const pendingCount = computed(() => active.value ? pendingHunkCount(active.value as ReviewSession) : 0)
  const addedChars = computed(() => active.value?.diff.addedChars ?? 0)
  const removedChars = computed(() => active.value?.diff.removedChars ?? 0)

  function propose(proposal: ReviewProposal): boolean {
    const review = createDiffReview(proposal.label, proposal.original, proposal.revised)
    if (!review.diff.hasChanges) return false
    active.value = { ...proposal, ...review }
    return true
  }

  function decide(hunkId: string, decision: DiffDecision) {
    if (!active.value) return
    active.value = { ...active.value, ...applyDecisionToHunk(active.value, hunkId, decision) }
  }

  function decideAll(decision: Exclude<DiffDecision, 'pending'>) {
    if (!active.value) return
    active.value = { ...active.value, ...applyDecisionToAll(active.value, decision) }
  }

  function clear() {
    active.value = null
  }

  function reviewFor(chapterId: string | null | undefined, inline?: boolean) {
    const current = active.value
    if (!current || !chapterId || current.chapterId !== chapterId) return null
    if (inline !== undefined && Boolean(current.inline) !== inline) return null
    return current
  }

  /** Full chapter text with every accepted hunk applied, base otherwise. */
  function reviewedText(review: ReviewSession): string {
    return composeReviewedText(review.base, review, review.start, review.end)
  }

  /** Removes and returns the settled result so the caller writes it exactly once. */
  function takeSettled(chapterId: string): SettledReview | null {
    const current = active.value
    if (!current || current.chapterId !== chapterId) return null
    if (pendingHunkCount(current) > 0) return null
    const payload: SettledReview = {
      chapterId,
      start: current.start,
      end: current.end,
      original: current.original,
      text: reviewedText(current),
      label: current.label,
    }
    active.value = null
    return payload
  }

  return {
    active,
    visible,
    settled,
    pendingCount,
    addedChars,
    removedChars,
    propose,
    decide,
    decideAll,
    clear,
    reviewFor,
    reviewedText,
    takeSettled,
    acceptedHunkIds,
    hasAcceptedHunks,
  }
})
