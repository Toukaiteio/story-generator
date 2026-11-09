import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useChapterReviewCommit } from '../useChapterReviewCommit'
import { useChapterReview } from '@/stores/chapterReview'

const original = '第一段很平静。\n第二段也平静。\n第三段仍然平静。'
const revised = '第一段很紧张。\n第二段也平静。\n第三段起风了。'

function setup() {
  setActivePinia(createPinia())
  const content = ref(`开头。\n${original}\n结尾。`)
  const review = useChapterReview()
  const storeStart = '开头。\n'.length
  review.propose({
    chapterId: 'ch-1',
    label: 'Polish',
    base: content.value,
    original,
    revised,
    start: storeStart,
    end: storeStart + original.length,
  })
  const commit = useChapterReviewCommit({ chapterId: () => 'ch-1', content })
  return { content, review, commit, storeStart }
}

describe('diff commit writes back to the draft', () => {
  it('writes the whole chapter only after Accept all', () => {
    const { content, review, commit } = setup()
    expect(content.value).toBe(`开头。\n${original}\n结尾。`)
    commit.decideAll('accepted')
    expect(content.value).toBe(`开头。\n${revised}\n结尾。`)
    expect(review.active).toBeNull()
  })

  it('keeps the original text after Reject all', () => {
    const { content, review, commit } = setup()
    commit.decideAll('rejected')
    expect(content.value).toBe(`开头。\n${original}\n结尾。`)
    expect(review.active).toBeNull()
  })

  it('applies one hunk and keeps the other original', () => {
    const { content, review, commit } = setup()
    commit.decide('h1', 'accepted')
    expect(content.value).toContain('第一段很紧张。')
    expect(content.value).toContain('第三段仍然平静。')
    expect(content.value.startsWith('开头。')).toBe(true)
    expect(content.value.endsWith('结尾。')).toBe(true)
    expect(review.active).not.toBeNull()
  })

  it('rejecting a single hunk restores just that hunk', () => {
    const { content, commit } = setup()
    commit.decide('h1', 'accepted')
    commit.decide('h2', 'rejected')
    expect(content.value).toContain('第一段很紧张。')
    expect(content.value).toContain('第三段仍然平静。')
  })
})
