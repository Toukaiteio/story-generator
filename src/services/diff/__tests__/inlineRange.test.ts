import { describe, expect, it } from 'vitest'
import { paragraphRangeAt } from '@/services/diff/inlineRange'

const chapter = [
  '伊尔斯把海图摊在桌上。',
  '',
  '她数着潮声，想起档案员的话。',
  '',
  '灯塔在雾里只剩一个轮廓。',
].join('\n')

describe('Ctrl+I paragraph targeting', () => {
  it('takes the whole paragraph under the caret, not the chapter', () => {
    const caret = chapter.indexOf('档案员')
    const range = paragraphRangeAt(chapter, caret)
    expect(chapter.slice(range.start, range.end)).toBe('她数着潮声，想起档案员的话。')
  })

  it('covers a paragraph when the caret sits at its first and last character', () => {
    const start = chapter.indexOf('伊尔斯')
    const end = start + '伊尔斯把海图摊在桌上。'.length
    expect(chapter.slice(...Object.values(paragraphRangeAt(chapter, start)) as [number, number]))
      .toBe('伊尔斯把海图摊在桌上。')
    expect(chapter.slice(...Object.values(paragraphRangeAt(chapter, end)) as [number, number]))
      .toBe('伊尔斯把海图摊在桌上。')
  })

  it('does not swallow the blank lines around the paragraph', () => {
    const range = paragraphRangeAt(chapter, chapter.indexOf('灯塔'))
    expect(range.start).toBe(chapter.indexOf('灯塔'))
    expect(chapter[range.start - 1]).toBe('\n')
    expect(range.end).toBe(chapter.length)
  })

  it('falls through to the next paragraph when the caret sits on a blank line', () => {
    const text = '开头\n\n   \n\n结尾'
    const caret = text.indexOf('   ') + 1
    const range = paragraphRangeAt(text, caret)
    expect(text.slice(range.start, range.end).trim()).toBe('结尾')
  })

  it('returns an empty range for empty text', () => {
    expect(paragraphRangeAt('', 0)).toEqual({ start: 0, end: 0 })
    expect(paragraphRangeAt('   ', 1)).toEqual({ start: 0, end: 0 })
  })
})
