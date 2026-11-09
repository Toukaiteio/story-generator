import { describe, expect, it } from 'vitest'
import { buildIssueChangeRuns } from '../issuePreview'

describe('proofreading issue inline preview', () => {
  it('keeps shared text plain and marks only the changed words', () => {
    const runs = buildIssueChangeRuns({
      excerpt: '灯塔的光在雾里只剩一个模糊的轮廓。',
      suggestedFix: '灯塔的光在雾里只剩一团发白的光晕。',
    })
    expect(runs[0]?.type).toBe('equal')
    expect(runs[0]?.text.startsWith('灯塔的光在雾里只剩')).toBe(true)
    expect(runs.some(run => run.type === 'removed' && run.text.includes('模糊的轮廓'))).toBe(true)
    expect(runs.some(run => run.type === 'added' && run.text.includes('发白的光晕'))).toBe(true)
    expect(runs.every(run => run.text.length > 0)).toBe(true)
    expect(runs.filter(run => run.type !== 'added').map(run => run.text).join(''))
      .toBe('灯塔的光在雾里只剩一个模糊的轮廓。')
  })

  it('renders an insertion-only fix as added text', () => {
    expect(buildIssueChangeRuns({ excerpt: '', suggestedFix: '补上缺失的句号。' }))
      .toEqual([{ type: 'added', text: '补上缺失的句号。' }])
  })

  it('renders a deletion-only fix as removed text', () => {
    expect(buildIssueChangeRuns({ excerpt: '他把重复的词重复了两遍。', suggestedFix: '' }))
      .toEqual([{ type: 'removed', text: '他把重复的词重复了两遍。' }])
  })

  it('returns nothing when the issue carries no text', () => {
    expect(buildIssueChangeRuns({ excerpt: '  ', suggestedFix: '  ' })).toEqual([])
  })
})
