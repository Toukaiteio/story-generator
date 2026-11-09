import { applyDiffHunks, buildTextDiff, type DiffHunk, type TextDiff } from './textDiff'

export type DiffDecision = 'pending' | 'accepted' | 'rejected'

export interface ReviewedRange {
  start: number
  end: number
}

export interface DiffReview {
  label: string
  /** The exact text the AI was given, frozen when the proposal was created. */
  original: string
  /** The AI result, frozen for the life of the review. */
  revised: string
  diff: TextDiff
  decisions: Record<string, DiffDecision>
}

export function createDiffReview(label: string, original: string, revised: string): DiffReview {
  const diff = buildTextDiff(original, revised)
  return {
    label,
    original,
    revised,
    diff,
    decisions: Object.fromEntries(diff.hunks.map(hunk => [hunk.id, 'pending' as DiffDecision])),
  }
}

export function decideHunk(review: DiffReview, hunkId: string, decision: DiffDecision): DiffReview {
  if (!(hunkId in review.decisions)) return review
  return { ...review, decisions: { ...review.decisions, [hunkId]: decision } }
}

export function decideAll(review: DiffReview, decision: Exclude<DiffDecision, 'pending'>): DiffReview {
  return {
    ...review,
    decisions: Object.fromEntries(review.diff.hunks.map(hunk => [hunk.id, decision])),
  }
}

export function acceptedHunkIds(review: DiffReview): Set<string> {
  return new Set(review.diff.hunks
    .filter(hunk => review.decisions[hunk.id] === 'accepted')
    .map(hunk => hunk.id))
}

export function pendingHunkCount(review: DiffReview): number {
  return review.diff.hunks.filter(hunk => review.decisions[hunk.id] === 'pending').length
}

export function isReviewSettled(review: DiffReview): boolean {
  return pendingHunkCount(review) === 0
}

export function hasAcceptedHunks(review: DiffReview): boolean {
  return review.diff.hunks.some(hunk => review.decisions[hunk.id] === 'accepted')
}

/**
 * Current chapter text after replaying only accepted hunks. `base` is the
 * chapter text that contains `review.original` between `start` and `end`.
 */
export function composeReviewedText(
  base: string,
  review: DiffReview,
  start: number,
  end: number,
): string {
  const from = Math.max(0, Math.min(start, base.length))
  const to = Math.max(from, Math.min(end, base.length))
  const region = applyDiffHunks(review.original, review.diff.hunks, acceptedHunkIds(review))
  return base.slice(0, from) + region + base.slice(to)
}

/** Map a hunk's original offsets onto the current text after accepted edits. */
export function hunkRangeInCurrentText(
  review: DiffReview,
  hunk: DiffHunk,
): { start: number; end: number } {
  let delta = 0
  for (const candidate of review.diff.hunks) {
    if (candidate.originalStart >= hunk.originalStart) break
    if (review.decisions[candidate.id] === 'accepted') {
      delta += candidate.added.length - candidate.removed.length
    }
  }
  return {
    start: hunk.originalStart + delta,
    end: hunk.originalEnd + delta,
  }
}
