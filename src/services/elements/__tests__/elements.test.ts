import { describe, expect, it } from 'vitest'
import type { ElementStatus } from '@/types/element'
import {
  appendElementState,
  buildElementContextForChapter,
  createElement,
  createElementState,
  elementStateAt,
  elementsActiveAt,
  latestElementState,
  normalizeElements,
} from '../index'

function makeElement(name: string, states: Array<{ chapterIndex: number; summary: string; status?: ElementStatus; location?: string }>) {
  return createElement({
    kind: 'character',
    name,
    states: states.map(state => createElementState(state)),
  })
}

describe('element states', () => {
  it('resolves the state true at a given story-time', () => {
    const element = makeElement('Lin', [
      { chapterIndex: -1, summary: 'Village blacksmith.', status: 'introduced' },
      { chapterIndex: 2, summary: 'Left the village with the map.', status: 'active' },
      { chapterIndex: 5, summary: 'Knows the map is forged.', status: 'changed' },
    ])

    expect(elementStateAt(element, 0)?.summary).toBe('Village blacksmith.')
    expect(elementStateAt(element, 2)?.summary).toBe('Left the village with the map.')
    expect(elementStateAt(element, 9)?.summary).toBe('Knows the map is forged.')
    expect(latestElementState(element)?.chapterIndex).toBe(5)
  })

  it('returns null before any state exists', () => {
    const element = makeElement('Ghost', [{ chapterIndex: 3, summary: 'Appears.' }])
    expect(elementStateAt(element, 1)).toBeNull()
  })

  it('builds a compact context block for the writer', () => {
    const elements = [
      makeElement('Lin', [{ chapterIndex: 1, summary: 'Holds the forged map.', status: 'active', location: 'Harbor' }]),
      makeElement('Map', [{ chapterIndex: 9, summary: 'Burned.', status: 'resolved' }]),
    ]

    const context = buildElementContextForChapter(elements, 2)
    expect(context).toContain('- Lin (character): [active] Holds the forged map. @Harbor')
    expect(context).not.toContain('Map')

    expect(buildElementContextForChapter([], 0)).toBe('')
    expect(buildElementContextForChapter(undefined, 0)).toBe('')
  })

  it('filters elements active at a chapter', () => {
    const early = makeElement('Lin', [{ chapterIndex: -1, summary: 'Introduced.' }])
    const late = makeElement('Map', [{ chapterIndex: 4, summary: 'Found.' }])
    const active = elementsActiveAt([early, late], 2)
    expect(active.map(item => item.name)).toEqual(['Lin'])
  })

  it('appends a new state without mutating the original', () => {
    const element = makeElement('Lin', [{ chapterIndex: 1, summary: 'Calm.' }])
    const next = appendElementState(element, { chapterIndex: 2, summary: 'Enraged.', status: 'changed' })

    expect(element.states).toHaveLength(1)
    expect(next.states).toHaveLength(2)
    expect(next.states[1].summary).toBe('Enraged.')
    expect(next.states[1].status).toBe('changed')
    expect(next.updatedAt >= element.updatedAt).toBe(true)
  })

  it('normalizes persisted elements defensively', () => {
    const normalized = normalizeElements([
      {
        id: 'el-1',
        kind: 'thread',
        name: 'The forged map',
        states: [
          { chapterIndex: '0', summary: 'Planted in chapter 1.', status: 'planted' },
          { chapterIndex: 99, summary: '' },
          null,
        ],
      },
      { kind: 'unknown-kind', name: '', states: [] },
    ])

    expect(normalized).toHaveLength(2)
    expect(normalized[0].states).toHaveLength(1)
    expect(normalized[0].states[0].chapterIndex).toBe(0)
    expect(normalized[0].states[0].status).toBe('planted')
    expect(normalized[1].kind).toBe('object')
    expect(normalized[1].name).toBe('Unnamed')
    expect(normalized[1].states[0].chapterIndex).toBe(-1)
  })
})
