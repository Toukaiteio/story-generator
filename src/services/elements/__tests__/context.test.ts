import { describe, expect, it } from 'vitest'
import { elementContextCapsules } from '../context'
import { createElement, createElementState } from '../index'
import type { StoryElement } from '@/types/element'

function element(name: string, chapterIndex = 0, status: 'active' | 'planted' | 'paid' = 'active'): StoryElement {
  return createElement({
    kind: 'location',
    name,
    states: [createElementState({ chapterIndex, summary: `${name} is here.`, status })],
  })
}

describe('In context capsules', () => {
  it('returns one capsule per element id', () => {
    const archive = element('The chart office')
    const duplicate: StoryElement = { ...archive, states: [...archive.states] }
    const slice = elementContextCapsules([archive, duplicate], 0)

    expect(slice.items).toHaveLength(1)
    expect(slice.items[0].element.id).toBe(archive.id)
  })

  it('keeps the state that is true at the chapter on the capsule', () => {
    const office = createElement({
      kind: 'location',
      name: 'The chart office',
      states: [
        createElementState({ chapterIndex: 0, summary: 'A damp stone building.', status: 'active' }),
        createElementState({ chapterIndex: 2, summary: 'Sealed by the archive.', status: 'changed' }),
      ],
    })

    expect(elementContextCapsules([office], 0).items[0].state.status).toBe('active')
    expect(elementContextCapsules([office], 2).items[0].state.status).toBe('changed')
  })

  it('skips elements with no state at this chapter and reports hidden capsules', () => {
    const present = element('The chart office', 0)
    const future = element('The night ferry', 4)
    const slice = elementContextCapsules([present, future], 0, 8)

    expect(slice.items.map(item => item.element.name)).toEqual(['The chart office'])
    expect(slice.hiddenCount).toBe(0)

    const limited = elementContextCapsules(
      [present, element('Harbor'), element('Pier'), element('Lighthouse')],
      0,
      2,
    )
    expect(limited.items).toHaveLength(2)
    expect(limited.hiddenCount).toBe(2)
  })

  it('never emits a capsule without a status when one exists', () => {
    const thread = createElement({
      kind: 'thread',
      name: 'The erased harbor',
      states: [createElementState({ chapterIndex: 1, summary: 'Removed from the chart.', status: 'planted' })],
    })
    const slice = elementContextCapsules([thread], 1)
    expect(slice.items[0].state.status).toBe('planted')
  })
})
