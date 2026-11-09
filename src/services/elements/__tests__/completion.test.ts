import { describe, expect, it } from 'vitest'
import type { StoryElement } from '@/types/element'
import { buildMarkDictionary } from '../marking'
import { createElement, createElementState } from '../index'
import {
  applyCompletion,
  buildCompletionItems,
  minimumPrefixLength,
  readCompletionContext,
  resolveCompletion,
  type CompletionRequest,
} from '../completion'

function element(
  name: string,
  aliases: string[] | undefined,
  id: string,
  options: { chapterIndex?: number; status?: 'active' | 'resolved' } = {},
): StoryElement {
  return createElement({
    id,
    kind: 'character',
    name,
    aliases,
    states: [
      createElementState({
        chapterIndex: options.chapterIndex ?? 0,
        summary: `${name} state.`,
        status: options.status,
      }),
    ],
  })
}

const elements: StoryElement[] = [
  element('伊尔斯', ['绘图员'], 'el-ilse', { status: 'active' }),
  element('旧海图', ['海图'], 'el-chart'),
  element('档案员', ['灰外套', '灰衣人'], 'el-clerk', { chapterIndex: 4 }),
  element('灯塔', undefined, 'el-light', { status: 'resolved' }),
  element('伊尔斯·瓦恩', ['瓦恩'], 'el-ilse-full'),
]

const dictionary = buildMarkDictionary(elements)

function request(overrides: Partial<CompletionRequest>): CompletionRequest {
  return {
    text: '',
    caret: 0,
    trigger: 'manual',
    composing: false,
    elementList: elements,
    dictionary,
    chapterIndex: 0,
    ...overrides,
  }
}

describe('completion token boundaries', () => {
  it('splits on Chinese punctuation, quotes, brackets, and whitespace', () => {
    const cases: Array<[string, string, number]> = [
      ['他说：“伊尔斯', '伊尔斯', 4],
      ['（伊尔', '伊尔', 1],
      ['「档案', '档案', 1],
      ['旧海图，灯', '灯', 4],
      ['——瓦恩', '瓦恩', 2],
      ['a 灯塔', '灯塔', 2],
      ['伊尔斯。', '', 4],
      ['', '', 0],
    ]
    for (const [text, query, start] of cases) {
      const context = readCompletionContext(text, text.length)
      expect(context.query).toBe(query)
      expect(context.start).toBe(start)
      expect(context.end).toBe(text.length)
    }
  })

  it('recognises the explicit @ trigger and keeps the @ out of the query', () => {
    expect(readCompletionContext('@伊尔', 3)).toEqual({ query: '伊尔', start: 0, end: 3, trigger: 'explicit' })
    expect(readCompletionContext('开头 @draw', 8)).toEqual({ query: 'draw', start: 3, end: 8, trigger: 'explicit' })
    expect(readCompletionContext('after@', 6)).toEqual({ query: '', start: 5, end: 6, trigger: 'explicit' })
    expect(readCompletionContext('after@', 5).trigger).toBe('auto')
  })

  it('uses one character as the minimum for every language', () => {
    expect(minimumPrefixLength('伊')).toBe(1)
    expect(minimumPrefixLength('I')).toBe(1)
    expect(minimumPrefixLength('伊尔')).toBe(1)
    expect(minimumPrefixLength('Ilse')).toBe(1)
  })

  it('opens automatically on a single character, CJK or Latin', () => {
    expect(resolveCompletion(request({ text: '伊', caret: 1, trigger: 'auto' })).items.length).toBeGreaterThan(0)
    const latin = resolveCompletion(request({
      text: 'I',
      caret: 1,
      trigger: 'auto',
      elementList: [element('Ilse', undefined, 'el-latin')],
      dictionary: buildMarkDictionary([element('Ilse', undefined, 'el-latin')]),
    }))
    expect(latin.items.map(item => item.insertText)).toEqual(['Ilse'])
  })
})

describe('completion ranking', () => {
  it('puts prefix matches before contains matches and short names first', () => {
    const items = buildCompletionItems(
      { elementList: elements, dictionary, chapterIndex: 0 },
      { query: '伊', start: 0, end: 1, trigger: 'manual' },
    )
    expect(items.map(item => item.insertText)).toEqual(['伊尔斯', '伊尔斯·瓦恩'])
  })

  it('orders by length then by name and dedupes one row per element', () => {
    const items = buildCompletionItems(
      { elementList: elements, dictionary, chapterIndex: 0 },
      { query: '海', start: 0, end: 1, trigger: 'manual' },
    )
    expect(items.map(item => item.insertText)).toEqual(['海图'])
    expect(items[0].label).toBe('别名：海图')
    expect(items[0].isAlias).toBe(true)
    expect(new Set(items.map(item => item.elementId)).size).toBe(items.length)
  })

  it('shows the alias label when the alias is the hit and the name when the name is the hit', () => {
    const aliasHit = buildCompletionItems(
      { elementList: elements, dictionary, chapterIndex: 0 },
      { query: '绘图', start: 0, end: 2, trigger: 'manual' },
    )
    expect(aliasHit[0]).toMatchObject({ label: '别名：绘图员', insertText: '绘图员', isAlias: true })

    const fullNameHit = buildCompletionItems(
      { elementList: elements, dictionary, chapterIndex: 0 },
      { query: '瓦恩', start: 0, end: 2, trigger: 'manual' },
    )
    expect(fullNameHit[0].label).toBe('别名：瓦恩')
    expect(fullNameHit[0].name).toBe('伊尔斯·瓦恩')
  })

  it('carries chapter status only when the element has state at that chapter', () => {
    const items = buildCompletionItems(
      { elementList: elements, dictionary, chapterIndex: 0, limit: 8 },
      { query: '', start: 0, end: 0, trigger: 'manual' },
    )
    const ilse = items.find(item => item.elementId === 'el-ilse')
    const clerk = items.find(item => item.elementId === 'el-clerk')
    expect(ilse?.status).toBe('active')
    expect(clerk).toBeDefined()
    expect(clerk?.status).toBeUndefined()
  })

  it('puts elements present in the chapter first for an empty manual trigger', () => {
    const items = buildCompletionItems(
      { elementList: elements, dictionary, chapterIndex: 0, limit: 8 },
      { query: '', start: 0, end: 0, trigger: 'manual' },
    )
    const firstAbsent = items.findIndex(item => !item.presentThisChapter)
    expect(firstAbsent).toBeGreaterThan(0)
    expect(items.slice(firstAbsent).every(item => !item.presentThisChapter)).toBe(true)
  })

  it('caps the list at eight rows and never scrolls', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      element(`角色${String.fromCharCode(0x4e00 + index)}`, undefined, `el-${index}`))
    const items = resolveCompletion(request({
      text: '角',
      caret: 1,
      trigger: 'auto',
      elementList: many,
      dictionary: buildMarkDictionary(many),
    }))
    expect(items.items).toHaveLength(8)
  })

  it('returns nothing for an empty dictionary and empty manual query', () => {
    expect(resolveCompletion(request({
      text: '',
      caret: 0,
      trigger: 'manual',
      elementList: [],
      dictionary: buildMarkDictionary([]),
    }))).toEqual({ context: null, items: [] })
  })
})

describe('completion @ trigger and replacement', () => {
  it('filters after @ and replaces the @ plus the filter text, leaving the caret after the name', () => {
    const result = resolveCompletion(request({ text: '开头 @瓦恩', caret: 7, trigger: 'explicit' }))
    expect(result.items).toHaveLength(1)
    const replaced = applyCompletion('开头 @瓦恩', result.context!, result.items[0])
    expect(replaced).toEqual({ text: '开头 瓦恩', caret: 5 })
  })

  it('replaces only the token under the caret, not the whole line', () => {
    const result = resolveCompletion(request({ text: '他看见，灯', caret: 5, trigger: 'auto' }))
    const replaced = applyCompletion('他看见，灯', result.context!, result.items[0])
    expect(replaced.text).toBe('他看见，灯塔')
    expect(replaced.caret).toBe(6)
  })

  it('never opens while composing and opens on the next check after composition ends', () => {
    const composing = resolveCompletion(request({
      text: '伊',
      caret: 1,
      trigger: 'auto',
      composing: true,
    }))
    expect(composing).toEqual({ context: null, items: [] })

    const after = resolveCompletion(request({ text: '伊', caret: 1, trigger: 'auto', composing: false }))
    expect(after.items.map(item => item.insertText)).toContain('伊尔斯')
  })
})
