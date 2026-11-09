import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { useChapterReview } from '@/stores/chapterReview'
import { composeReviewedText, createDiffReview } from '../review'

const original = '第一段很平静。\n第二段也平静。\n第三段仍然平静。'
const revised = '第一段很紧张。\n第二段也平静。\n第三段起风了。'

describe('review store and chapter write-back', () => {
  it('never touches the chapter before an explicit accept', () => {
    setActivePinia(createPinia())
    const store = useChapterReview()
    const draft = original
    const proposed = store.propose({
      chapterId: 'ch-1',
      label: 'Inline edit',
      base: draft,
      original,
      revised,
      start: 0,
      end: original.length,
      inline: true,
    })
    expect(proposed).toBe(true)
    expect(draft).toBe(original)
    expect(store.active?.diff.hasChanges).toBe(true)
  })

  it('composes the chapter from accepted hunks only', () => {
    setActivePinia(createPinia())
    const store = useChapterReview()
    store.propose({
      chapterId: 'ch-1',
      label: 'Inline edit',
      base: original,
      original,
      revised,
      start: 0,
      end: original.length,
      inline: true,
    })
    const firstHunk = store.active!.diff.hunks[0]
    store.decide(firstHunk.id, 'accepted')
    const text = store.reviewedText(store.active!)
    expect(text).toContain(firstHunk.added)
    expect(text).not.toBe(revised)
  })

  it('returns the original base after every hunk is rejected', () => {
    setActivePinia(createPinia())
    const store = useChapterReview()
    store.propose({
      chapterId: 'ch-1',
      label: 'Polish',
      base: `前面。\n\n${original}`,
      original,
      revised,
      start: 5,
      end: 5 + original.length,
    })
    store.decideAll('rejected')
    expect(store.reviewedText(store.active!)).toBe(`前面。\n\n${original}`)
  })

  it('writes back the whole revision after accepting every hunk', () => {
    setActivePinia(createPinia())
    const store = useChapterReview()
    store.propose({
      chapterId: 'ch-1',
      label: 'Polish',
      base: `前面。\n\n${original}`,
      original,
      revised,
      start: 5,
      end: 5 + original.length,
    })
    store.decideAll('accepted')
    expect(store.reviewedText(store.active!)).toBe(`前面。\n\n${revised}`)
  })

  it('takes a settled review exactly once', () => {
    setActivePinia(createPinia())
    const store = useChapterReview()
    store.propose({
      chapterId: 'ch-1',
      label: 'Inline edit',
      base: original,
      original,
      revised,
      start: 0,
      end: original.length,
      inline: true,
    })
    expect(store.takeSettled('ch-1')).toBeNull()
    store.decideAll('accepted')
    const settled = store.takeSettled('ch-1')
    expect(settled?.text).toBe(revised)
    expect(store.takeSettled('ch-1')).toBeNull()
  })

  it('scopes reviews to their chapter and to inline/panel mode', () => {
    setActivePinia(createPinia())
    const store = useChapterReview()
    store.propose({
      chapterId: 'ch-1',
      label: 'Inline edit',
      base: original,
      original,
      revised,
      start: 0,
      end: original.length,
      inline: true,
    })
    expect(store.reviewFor('ch-2', true)).toBeNull()
    expect(store.reviewFor('ch-1', false)).toBeNull()
    expect(store.reviewFor('ch-1', true)).not.toBeNull()
  })

  it('drops unchanged proposals instead of opening an empty review', () => {
    setActivePinia(createPinia())
    const store = useChapterReview()
    expect(store.propose({
      chapterId: 'ch-1',
      label: 'Polish',
      base: original,
      original,
      revised: original,
      start: 0,
      end: original.length,
    })).toBe(false)
    expect(store.active).toBeNull()
  })

  it('composeReviewedText keeps offsets outside the reviewed range', () => {
    const review = createDiffReview('Inline edit', original, revised)
    const base = `开头。${original}结尾。`
    const text = composeReviewedText(base, review, 3, 3 + original.length)
    expect(text.startsWith('开头。')).toBe(true)
    expect(text.endsWith('结尾。')).toBe(true)
  })
})
