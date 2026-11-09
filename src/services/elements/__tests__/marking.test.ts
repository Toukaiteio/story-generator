import { describe, expect, it } from 'vitest'
import type { StoryElement } from '@/types/element'
import { createElement, normalizeElementAliases, normalizeElements } from '../index'
import {
  buildMarkDictionary,
  extractPlainText,
  joinPlainText,
  markPlainText,
  markText,
  markTextToHtml,
  splicePlainText,
  splitPlainText,
} from '../marking'

function element(name: string, aliases?: string[], id = `el-${name}`): StoryElement {
  return createElement({ id, kind: 'character', name, aliases })
}

describe('element aliases', () => {
  it('normalizes missing, blank, duplicate and self aliases while keeping order', () => {
    expect(normalizeElementAliases(undefined, '伊尔斯')).toEqual([])
    expect(normalizeElementAliases([], '伊尔斯')).toEqual([])
    expect(normalizeElementAliases(['  伊尔  ', '', '伊尔', '伊尔斯', '绘图员'], '伊尔斯')).toEqual([
      '伊尔',
      '绘图员',
    ])
  })

  it('normalizes aliases on create and persists them through element normalization', () => {
    const created = element('伊尔斯', ['  绘图员 ', '绘图员', '伊尔斯', ''])
    expect(created.aliases).toEqual(['绘图员'])

    const normalized = normalizeElements([
      { id: 'old', kind: 'character', name: '档案员', states: [] },
      { id: 'new', kind: 'character', name: '伊尔斯', aliases: ['绘图员', ' 绘图员 ', '伊尔斯'], states: [] },
    ])
    expect(normalized[0].aliases).toEqual([])
    expect(normalized[1].aliases).toEqual(['绘图员'])
  })

  it('loads an element without an aliases field without inventing aliases', () => {
    const legacy: any = {
      id: 'el-legacy',
      kind: 'character',
      name: '档案员',
      states: [{ id: 'es-1', chapterIndex: 0, summary: '来访。', createdAt: '2026-01-01T00:00:00.000Z' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const normalized = normalizeElements([legacy])
    expect(normalized).toHaveLength(1)
    expect(normalized[0].aliases).toEqual([])
    expect(normalized[0].name).toBe('档案员')
  })
})

describe('marking service', () => {
  const elements = [
    element('伊尔斯·瓦恩', ['伊尔斯', '绘图员'], 'el-ilse'),
    element('旧海图', ['海图'], 'el-chart'),
    element('湾', undefined, 'el-bay'),
    element('档案员', ['灰外套'], 'el-clerk'),
  ]

  it('builds a deterministic dictionary, longest first, with single characters removed', () => {
    const dictionary = buildMarkDictionary(elements)
    expect(dictionary.entries.map(entry => entry.text)).toEqual([
      '伊尔斯·瓦恩',
      '伊尔斯',
      '旧海图',
      '档案员',
      '灰外套',
      '绘图员',
      '海图',
    ])
    expect(dictionary.entries.some(entry => entry.text === '湾')).toBe(false)
    expect(dictionary.entries.find(entry => entry.text === '绘图员')?.isAlias).toBe(true)
  })

  it('prefers the longest match at every position', () => {
    const dictionary = buildMarkDictionary(elements)
    const segments = markText('伊尔斯·瓦恩把旧海图摊开，海图边角发脆。', dictionary)
    expect(segments.filter(segment => segment.type === 'mark').map(segment => segment.type === 'mark' && segment.matchedText)).toEqual([
      '伊尔斯·瓦恩',
      '旧海图',
      '海图',
    ])
  })

  it('marks aliases and never emits overlapping matches', () => {
    const dictionary = buildMarkDictionary(elements)
    const segments = markText('绘图员伊尔斯翻看旧海图。', dictionary)
    const marks = segments.flatMap(segment => segment.type === 'mark' ? [segment] : [])
    expect(marks.map(mark => mark.matchedText)).toEqual(['绘图员', '伊尔斯', '旧海图'])
    expect(marks[0].isAlias).toBe(true)
    expect(marks[1].isAlias).toBe(true)
    expect(marks[2].isAlias).toBe(false)
    expect(marks.reduce((sum, mark) => sum + mark.text.length, 0))
      .toBe(marks.map(mark => mark.matchedText).join('').length)
  })

  it('returns one plain segment for an empty dictionary and empty text', () => {
    const dictionary = buildMarkDictionary([])
    expect(dictionary.entries).toEqual([])
    expect(markText('没有任何词典。', dictionary)).toEqual([{ type: 'text', text: '没有任何词典。' }])
    expect(markText('', dictionary)).toEqual([])
  })

  it('skips dictionary entries shorter than two characters', () => {
    const dictionary = buildMarkDictionary([element('湾'), element('灯塔', undefined, 'el-light')])
    expect(markText('湾口有座灯塔。', dictionary)).toEqual([
      { type: 'text', text: '湾口有座' },
      { type: 'mark', text: '灯塔', elementId: 'el-light', matchedText: '灯塔', isAlias: false },
      { type: 'text', text: '。' },
    ])
  })

  it('keeps empty paragraphs and leading/trailing blank lines through the save contract', () => {
    expect(splitPlainText('')).toEqual([''])
    expect(splitPlainText('a\n\nb\n')).toEqual(['a', '', 'b', ''])
    expect(joinPlainText(splitPlainText('\n开头\n\n结尾\n'))).toBe('\n开头\n\n结尾\n')
    expect(joinPlainText(['a', '', 'b'])).toBe('a\n\nb')
  })

  it('inserts a plain-text paste or newline without HTML and reports the caret', () => {
    expect(splicePlainText('伊尔斯看海图。', 3, 3, '\n')).toEqual({
      text: '伊尔斯\n看海图。',
      caret: 4,
    })
    expect(splicePlainText('伊尔斯看海图。', 3, 5, '翻开旧海图')).toEqual({
      text: '伊尔斯翻开旧海图图。',
      caret: 8,
    })
    expect(splicePlainText('abc', 1, 2, '\r\nX')).toEqual({ text: 'a\nXc', caret: 3 })
  })

  it('round-trips marked text to exactly the original plain text', () => {
    const source = '伊尔斯把旧海图压在玻璃板下。\n\n“绘图员，”档案员说，“海图是新的。”\n'
    const dictionary = buildMarkDictionary(elements)
    const marked = markPlainText(source, dictionary)
    expect(marked.text).toBe(source)
    const html = markTextToHtml(source, dictionary)
    expect(html).toContain('class="element-mark"')
    expect(extractPlainText(html)).toBe(source)
    expect(extractPlainText('<p>第一段</p><p>第二段</p>')).toBe('第一段\n第二段\n')
    expect(extractPlainText('a &amp; b')).toBe('a & b')
  })
})
