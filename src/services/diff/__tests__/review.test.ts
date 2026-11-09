import { describe, expect, it } from 'vitest'
import {
  acceptedHunkIds,
  composeReviewedText,
  createDiffReview,
  decideAll,
  decideHunk,
  hasAcceptedHunks,
  hunkRangeInCurrentText,
  isReviewSettled,
  pendingHunkCount,
} from '../review'

const original = '第一段很平静。\n第二段也平静。\n第三段仍然平静。'
const revised = '第一段很紧张。\n第二段也平静。\n第三段起风了。'

describe('diff review decisions', () => {
  it('starts with every hunk pending and changes nothing', () => {
    const review = createDiffReview('行内改写', original, revised)
    expect(review.decisions).toEqual({ h1: 'pending', h2: 'pending' })
    expect(pendingHunkCount(review)).toBe(2)
    expect(isReviewSettled(review)).toBe(false)
    expect(hasAcceptedHunks(review)).toBe(false)
    expect(composeReviewedText(original, review, 0, original.length)).toBe(original)
  })

  it('accepting one hunk writes only that hunk back', () => {
    let review = createDiffReview('行内改写', original, revised)
    review = decideHunk(review, 'h1', 'accepted')
    const text = composeReviewedText(original, review, 0, original.length)
    expect(text).toContain('第一段很紧张。')
    expect(text).toContain('第三段仍然平静。')
    expect(text).not.toContain('起风了')
  })

  it('rejecting every hunk restores the original exactly', () => {
    let review = createDiffReview('行内改写', original, revised)
    review = decideAll(review, 'rejected')
    expect(isReviewSettled(review)).toBe(true)
    expect(hasAcceptedHunks(review)).toBe(false)
    expect(composeReviewedText(original, review, 0, original.length)).toBe(original)
  })

  it('accepting every hunk reproduces the revision', () => {
    let review = createDiffReview('行内改写', original, revised)
    review = decideAll(review, 'accepted')
    expect(acceptedHunkIds(review).size).toBe(review.diff.hunks.length)
    expect(composeReviewedText(original, review, 0, original.length)).toBe(revised)
  })

  it('keeps text outside the reviewed range untouched', () => {
    const base = `开头。\n\n${original}\n\n结尾。`
    const start = base.indexOf(original)
    let review = createDiffReview('行内改写', original, revised)
    review = decideHunk(review, 'h1', 'accepted')
    const text = composeReviewedText(base, review, start, start + original.length)
    expect(text.startsWith('开头。')).toBe(true)
    expect(text.endsWith('结尾。')).toBe(true)
    expect(text).toContain('第一段很紧张。')
    expect(text).toContain('第三段仍然平静。')
  })

  it('maps original hunk offsets onto the current text after prior accepts', () => {
    let review = createDiffReview('行内改写', original, revised)
    const second = review.diff.hunks[1]
    review = decideHunk(review, review.diff.hunks[0].id, 'accepted')
    const range = hunkRangeInCurrentText(review, second)
    const text = composeReviewedText(original, review, 0, original.length)
    expect(text.slice(range.start, range.end)).toBe(second.removed)
  })
})
