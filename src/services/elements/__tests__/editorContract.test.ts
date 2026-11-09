import { describe, expect, it } from 'vitest'
import { buildMarkDictionary, joinPlainText, splitPlainText, splicePlainText } from '../marking'
import type { StoryElement } from '@/types/element'
import { createElement } from '../index'

const elements: StoryElement[] = [
  createElement({ id: 'el-ilse', kind: 'character', name: '伊尔斯', aliases: ['绘图员'] }),
  createElement({ id: 'el-map', kind: 'object', name: '旧海图' }),
]

const dictionary = buildMarkDictionary(elements)

/**
 * These checks cover the text contract the contenteditable layer relies on.
 * DOM, IME and clipboard acceptance is exercised in the browser run and
 * described in the task report.
 */
describe('enhanced editor text contract', () => {
  it('always restores the original text across the newline model', () => {
    const samples = [
      '',
      '\n',
      '开头\n',
      '\n中间\n',
      '第一段\n\n第三段',
      '甲\r\n乙',
      '结尾有两个空行\n\n',
    ]
    for (const sample of samples) {
      const text = sample.replace(/\r\n/g, '\n')
      expect(joinPlainText(splitPlainText(text))).toBe(text)
    }
  })

  it('keeps the caret after an inserted paragraph break mid-line', () => {
    const text = '伊尔斯把旧海图摊开。'
    const caret = text.indexOf('海图')
    const result = splicePlainText(text, caret, caret, '\n')
    expect(result.text).toBe('伊尔斯把旧\n海图摊开。')
    expect(result.caret).toBe(caret + 1)
    expect(result.text[result.caret - 1]).toBe('\n')
  })

  it('replaces a selection with plain pasted text and strips CRLF', () => {
    const text = '伊尔斯看旧海图。'
    const start = text.indexOf('看')
    const end = text.indexOf('旧')
    const result = splicePlainText(text, start, end, '翻开\r\n那张')
    expect(result.text).toBe('伊尔斯翻开\n那张旧海图。')
    expect(result.caret).toBe(start + '翻开\n那张'.length)
  })

  it('saves exactly what was typed even when the text contains marked names', () => {
    const typed = '绘图员伊尔斯看着旧海图。\n\n“海图是新的。”'
    expect(joinPlainText(splitPlainText(typed))).toBe(typed)
    expect(dictionary.byText.get('绘图员')?.isAlias).toBe(true)
    expect(dictionary.byText.get('伊尔斯')?.isAlias).toBe(false)
  })
})
