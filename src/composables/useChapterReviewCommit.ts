import type { Ref } from 'vue'
import { useChapterReview } from '@/stores/chapterReview'
import { composeReviewedText, pendingHunkCount, type DiffDecision } from '@/services/diff/review'

/**
 * Commits decisions from the reviewer into the chapter draft. Accepting a hunk
 * writes that hunk through the normal save path; rejecting leaves the original
 * text in place. While a review is open the draft is composed from the frozen
 * base plus accepted hunks, so decisions never land on stale offsets.
 */
export function useChapterReviewCommit(options: {
  chapterId: () => string | null
  content: Ref<string>
}) {
  const review = useChapterReview()

  function recompose() {
    const active = review.active
    if (!active) return
    options.content.value = composeReviewedText(active.base, active, active.start, active.end)
    if (pendingHunkCount(active) === 0) review.clear()
  }

  function decide(hunkId: string, decision: Exclude<DiffDecision, 'pending'>) {
    const active = review.active
    if (!active || !(hunkId in active.decisions)) return
    review.decide(hunkId, decision)
    recompose()
  }

  function decideAll(decision: Exclude<DiffDecision, 'pending'>) {
    const active = review.active
    if (!active) return
    if (decision === 'rejected') {
      for (const hunk of active.diff.hunks) {
        if (active.decisions[hunk.id] === 'pending') review.decide(hunk.id, 'rejected')
      }
      recompose()
      return
    }
    review.decideAll('accepted')
    recompose()
  }

  function cancel() {
    review.clear()
  }

  return { review, decide, decideAll, cancel }
}
