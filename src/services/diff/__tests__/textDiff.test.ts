import { describe, expect, it } from 'vitest'
import {
  applyDiffHunks,
  buildTextDiff,
  diffFromOriginal,
  tokenizeText,
  type DiffHunk,
} from '../textDiff'

const allIds = (hunks: DiffHunk[]) => new Set(hunks.map(hunk => hunk.id))

function renderOriginal(diff: ReturnType<typeof buildTextDiff>): string {
  let cursor = 0
  let output = ''
  for (const segment of diff.segments) {
    if (segment.type === 'equal') {
      expect(segment.start).toBe(cursor)
      output += segment.text
      cursor = segment.end
      continue
    }
    if (segment.type === 'remove') {
      output += segment.text
      cursor += segment.text.length
    }
  }
  return output
}

function renderRevised(diff: ReturnType<typeof buildTextDiff>): string {
  return diff.segments
    .filter(segment => segment.type !== 'remove')
    .map(segment => segment.text)
    .join('')
}

describe('text diff hunks', () => {
  it('returns no hunks for identical text', () => {
    const diff = buildTextDiff('伊尔斯把海图摊开。', '伊尔斯把海图摊开。')
    expect(diff.hasChanges).toBe(false)
    expect(diff.hunks).toEqual([])
    expect(diff.addedChars).toBe(0)
    expect(diff.removedChars).toBe(0)
    expect(diff.segments).toEqual([{ type: 'equal', text: '伊尔斯把海图摊开。', start: 0, end: 9 }])
  })

  it('marks a pure insertion as one added hunk with an empty removed side', () => {
    const diff = buildTextDiff('伊尔斯推开门。', '伊尔斯推开门，雾涌了进来。')
    expect(diff.hunks).toHaveLength(1)
    expect(diff.hunks[0].removed).toBe('')
    expect(diff.hunks[0].added).toContain('雾涌了进来')
    expect(diff.addedChars).toBe(diff.hunks[0].added.length)
    expect(diff.removedChars).toBe(0)
    expect(renderOriginal(diff)).toBe('伊尔斯推开门。')
    expect(renderRevised(diff)).toBe('伊尔斯推开门，雾涌了进来。')
  })

  it('marks a pure deletion as removed hunks with no added text', () => {
    const diff = buildTextDiff('他沉默了很久，然后说：“走吧。”', '他沉默了很久。')
    expect(diff.hunks.length).toBeGreaterThan(0)
    expect(diff.hunks.every(hunk => hunk.added === '')).toBe(true)
    expect(diff.hunks.map(hunk => hunk.removed).join('')).toContain('然后说')
    expect(diff.removedChars).toBe(diff.hunks.reduce((sum, hunk) => sum + hunk.removed.length, 0))
    expect(diff.addedChars).toBe(0)
    expect(renderOriginal(diff)).toBe('他沉默了很久，然后说：“走吧。”')
    expect(renderRevised(diff)).toBe('他沉默了很久。')
  })

  it('pairs a replacement into a hunk with both sides', () => {
    const diff = buildTextDiff('门开了。', '窗碎了。')
    expect(diff.hunks.length).toBeGreaterThan(0)
    expect(diff.hunks.map(hunk => hunk.removed).join('')).toBe('门开')
    expect(diff.hunks.map(hunk => hunk.added).join('')).toBe('窗碎')
    expect(renderOriginal(diff)).toBe('门开了。')
    expect(renderRevised(diff)).toBe('窗碎了。')
  })

  it('keeps separate edits in document order with original offsets', () => {
    const original = '第一段很平静。\n第二段也平静。\n第三段仍然平静。'
    const revised = '第一段很紧张。\n第二段也平静。\n第三段起风了。'
    const diff = buildTextDiff(original, revised)
    expect(diff.hunks.length).toBe(2)
    const [first, second] = diff.hunks
    expect(first.originalStart).toBeLessThan(second.originalStart)
    expect(original.slice(first.originalStart, first.originalEnd)).toBe(first.removed)
    expect(original.slice(second.originalStart, second.originalEnd)).toBe(second.removed)
    expect(renderOriginal(diff)).toBe(original)
    expect(renderRevised(diff)).toBe(revised)
  })

  it('rebuilds both sides exactly for mixed edits including paragraph breaks', () => {
    const original = '开头\n\n伊尔斯数着潮声。她把海图折好，塞进外套里。\n\n结尾'
    const revised = '开头\n\n伊尔斯数着潮声。她把海图折好。\n\n结尾多了一句。'
    const diff = buildTextDiff(original, revised)
    expect(renderOriginal(diff)).toBe(original)
    expect(renderRevised(diff)).toBe(revised)
  })

  it('handles empty originals and empty revisions', () => {
    const pureAdd = buildTextDiff('', '新的开头。')
    expect(pureAdd.hunks).toHaveLength(1)
    expect(pureAdd.hunks[0].removed).toBe('')
    expect(pureAdd.revised).toBe('新的开头。')

    const pureClear = buildTextDiff('旧的结尾。', '')
    expect(pureClear.hunks).toHaveLength(1)
    expect(pureClear.hunks[0].added).toBe('')
    expect(pureClear.removedChars).toBe(5)
  })

  it('treats an unreachable edit distance as one whole-string hunk', () => {
    const original = 'a'.repeat(1200)
    const revised = 'b'.repeat(1200)
    const diff = buildTextDiff(original, revised)
    expect(diff.hunks).toHaveLength(1)
    expect(diff.hunks[0].removed).toBe(original)
    expect(diff.hunks[0].added).toBe(revised)
  })

  it('keeps Latin words, digits, and whitespace as single tokens', () => {
    expect(tokenizeText('Ilse read 3 maps.\n')).toEqual(['Ilse', ' ', 'read', ' ', '3', ' ', 'maps', '.', '\n'])
    expect(tokenizeText('“海图。”')).toEqual(['“', '海', '图', '。', '”'])
  })
})

describe('accept and reject', () => {
  const original = '伊尔斯推开门。雾很薄。她收起海图。'
  const revised = '伊尔斯撞开门。雾气涌了进来。她收起海图。'

  it('applies every accepted hunk and reproduces the revision', () => {
    const diff = buildTextDiff(original, revised)
    expect(applyDiffHunks(original, diff.hunks, allIds(diff.hunks))).toBe(revised)
  })

  it('leaves the original untouched when every hunk is rejected', () => {
    const diff = buildTextDiff(original, revised)
    expect(applyDiffHunks(original, diff.hunks, new Set())).toBe(original)
  })

  it('applies one hunk at a time and keeps rejected hunks as original text', () => {
    const source = '第一段很平静。\n第二段也平静。\n第三段仍然平静。'
    const target = '第一段很紧张。\n第二段也平静。\n第三段起风了。'
    const diff = buildTextDiff(source, target)
    expect(diff.hunks.length).toBe(2)
    const firstOnly = new Set([diff.hunks[0].id])
    const partial = applyDiffHunks(source, diff.hunks, firstOnly)
    expect(partial).toContain(diff.hunks[0].added)
    expect(partial).not.toContain('起风了')
    expect(partial).toContain('第三段仍然平静。')
  })

  it('accepting a pure insertion keeps the surrounding paragraphs', () => {
    const source = '她合上本子。\n\n灯灭了。'
    const target = '她合上本子。\n\n灯灭了。\n\n她在黑暗里数到十。'
    const diff = buildTextDiff(source, target)
    expect(applyDiffHunks(source, diff.hunks, allIds(diff.hunks))).toBe(target)
    expect(applyDiffHunks(source, diff.hunks, new Set())).toBe(source)
  })

  it('diffFromOriginal replays accepted ids without mutating the inputs', () => {
    const diff = buildTextDiff(original, revised)
    const accepted = allIds(diff.hunks)
    expect(diffFromOriginal(original, revised, accepted)).toBe(revised)
    expect(diffFromOriginal(original, revised, new Set())).toBe(original)
    expect(original).toBe('伊尔斯推开门。雾很薄。她收起海图。')
  })
})
