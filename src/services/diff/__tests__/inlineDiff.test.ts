import { describe, expect, it } from 'vitest'
import { buildInlineDiffLayout, INLINE_DIFF_CONTEXT_LINES } from '../inlineDiff'
import { createDiffReview, decideHunk } from '../review'

const base = [
  '开头一段，风还没起来。',
  '',
  '伊尔斯把海图摊在桌上。',
  '',
  '她数着潮声，想起档案员的话。',
  '',
  '灯塔在雾里只剩一个轮廓。',
  '',
  '结尾一段，潮水退了。',
].join('\n')

function layoutFor(original: string, revised: string, start: number) {
  const review = createDiffReview('行内改写', original, revised)
  return {
    review,
    layout: buildInlineDiffLayout({ base, start, end: start + original.length, review }),
  }
}

function runText(layout: ReturnType<typeof buildInlineDiffLayout>): string {
  return layout.paragraphs
    .map(paragraph => paragraph.runs.map(run => run.text).join(''))
    .join('\n')
}

describe('inline diff layout', () => {
  it('keeps unchanged prose and renders a pending hunk as removed then added', () => {
    const original = '她数着潮声，想起档案员的话。'
    const revised = '她数着浪声，想起档案员的话。'
    const start = base.indexOf(original)
    const { layout } = layoutFor(original, revised, start)
    const placed = layout.placements.h1
    expect(placed).toBeDefined()

    const paragraph = layout.paragraphs[placed.firstParagraph]
    expect(paragraph.runs.some(run => run.type === 'removed' && run.text.includes('潮'))).toBe(true)
    expect(paragraph.runs.some(run => run.type === 'added' && run.text.includes('浪'))).toBe(true)
    expect(runText(layout)).toContain('伊尔斯把海图摊在桌上。')
    expect(runText(layout)).toContain('灯塔在雾里只剩一个轮廓。')
    expect(layout.pendingIds).toEqual(['h1'])
  })

  it('gives every hunk two unchanged paragraphs of context on both sides', () => {
    const original = '她数着潮声，想起档案员的话。'
    const revised = '她数着浪声，想起档案员的话。'
    const start = base.indexOf(original)
    const { layout } = layoutFor(original, revised, start)
    const placed = layout.placements.h1
    expect(placed.firstParagraph - placed.contextStart).toBe(INLINE_DIFF_CONTEXT_LINES)
    expect(placed.contextEnd - placed.lastParagraph).toBe(INLINE_DIFF_CONTEXT_LINES)
    expect(layout.paragraphs[placed.contextStart].runs[0].text).toBe('伊尔斯把海图摊在桌上。')
    expect(layout.paragraphs[placed.contextEnd].runs[0].text).toBe('灯塔在雾里只剩一个轮廓。')
  })

  it('clamps context at the chapter edges instead of inventing lines', () => {
    const original = '开头一段，风还没起来。'
    const revised = '开头一段，风已经起来了。'
    const { layout } = layoutFor(original, revised, 0)
    const placed = layout.placements.h1
    expect(placed.contextStart).toBe(0)
    expect(placed.firstParagraph).toBe(0)
    expect(placed.contextEnd - placed.lastParagraph).toBe(INLINE_DIFF_CONTEXT_LINES)
  })

  it('renders accepted hunks as plain prose and rejected hunks as the original prose', () => {
    const original = base.slice(base.indexOf('她数着潮声'), base.indexOf('她数着潮声') + '她数着潮声，想起档案员的话。'.length)
    const revised = '她数着浪声，想起档案员的话。'
    const start = base.indexOf(original)
    let { review } = layoutFor(original, revised, start)
    review = decideHunk(review, 'h1', 'accepted')
    const acceptedLayout = buildInlineDiffLayout({ base, start, end: start + original.length, review })
    expect(acceptedLayout.pendingIds).toEqual([])
    expect(acceptedLayout.paragraphs.flatMap(paragraph => paragraph.runs).some(run => run.type === 'added')).toBe(false)
    expect(runText(acceptedLayout)).toContain(revised)

    review = decideHunk(review, 'h1', 'rejected')
    const rejectedLayout = buildInlineDiffLayout({ base, start, end: start + original.length, review })
    expect(rejectedLayout.pendingIds).toEqual([])
    expect(rejectedLayout.paragraphs.flatMap(paragraph => paragraph.runs).some(run => run.type === 'removed')).toBe(false)
    expect(runText(rejectedLayout)).toBe(base)
  })

  it('maps multiple hunks in document order and keeps append hunks at the end', () => {
    const original = '她数着潮声，想起档案员的话。'
    const revised = '她数着潮声，想起档案员的话。\n\n灯塔的灯灭了。'
    const start = base.indexOf(original)
    const review = createDiffReview('续写', original, revised)
    const layout = buildInlineDiffLayout({ base, start, end: start + original.length, review })
    expect(layout.pendingIds).toEqual(['h1'])
    const placed = layout.placements.h1
    expect(layout.paragraphs.flatMap(paragraph => paragraph.runs).some(run => run.type === 'added' && run.text === '灯塔的灯灭了。')).toBe(true)
    expect(placed.lastParagraph).toBeGreaterThan(placed.firstParagraph)
  })
})
