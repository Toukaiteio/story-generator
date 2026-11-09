import { describe, expect, it } from 'vitest'
import {
  appendElementState,
  applyElementProposals,
  createElement,
  createElementState,
  elementStateAt,
} from '../index'
import type { ElementState, ElementStatus, StoryElement } from '@/types/element'

const storage = new Map<string, string>()
const localStorageStub = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => { storage.delete(key) },
  clear: () => { storage.clear() },
  key: (index: number) => [...storage.keys()][index] ?? null,
  get length() { return storage.size },
}
;(globalThis as any).window = { localStorage: localStorageStub }
;(globalThis as any).localStorage = localStorageStub
;(globalThis as any).document = { documentElement: {} }

function elementWith(name: string, states: Array<{ chapterIndex: number; summary: string; status?: ElementStatus; location?: string }>): StoryElement {
  return createElement({
    kind: 'thread',
    name,
    states: states.map(state => createElementState(state)),
  })
}

describe('element timeline', () => {
  it('returns the state that is true at each chapter while sliding the timeline', () => {
    const thread = elementWith('The forged map', [
      { chapterIndex: -1, summary: 'Hidden in the attic.', status: 'planted' },
      { chapterIndex: 3, summary: 'Handed to Lin at the harbor.', status: 'advanced', location: 'Harbor' },
      { chapterIndex: 7, summary: 'Burned to hide the forgery.', status: 'paid' },
    ])

    expect(elementStateAt(thread, 0)?.status).toBe('planted')
    expect(elementStateAt(thread, 2)?.summary).toBe('Hidden in the attic.')
    expect(elementStateAt(thread, 3)?.status).toBe('advanced')
    expect(elementStateAt(thread, 3)?.location).toBe('Harbor')
    expect(elementStateAt(thread, 6)?.status).toBe('advanced')
    expect(elementStateAt(thread, 7)?.status).toBe('paid')
  })

  it('shows an accepted proposal at the chapter it targets', () => {
    const thread = elementWith('The forged map', [
      { chapterIndex: 1, summary: 'Found in the ledger.', status: 'planted' },
    ])

    const proposal = {
      chapterIndex: 4,
      summary: 'The harbor clerk admits he copied it.',
      status: 'advanced' as ElementStatus,
      location: 'Harbor',
    }

    expect(elementStateAt(thread, 3)?.status).toBe('planted')
    expect(elementStateAt(thread, 4)?.status).toBe('planted')

    const accepted = appendElementState(thread, proposal)

    expect(elementStateAt(accepted, 3)?.status).toBe('planted')
    expect(elementStateAt(accepted, 4)?.summary).toBe(proposal.summary)
    expect(elementStateAt(accepted, 9)?.location).toBe('Harbor')
    expect(accepted.states).toHaveLength(2)
  })

  it('keeps the latest state when several states share a chapter', () => {
    const states: ElementState[] = [
      createElementState({ chapterIndex: 2, summary: 'First pass.' }),
      createElementState({ chapterIndex: 2, summary: 'Corrected in revision.' }),
    ]
    const element = createElement({ kind: 'event', name: 'The duel', states })

    expect(elementStateAt(element, 2)?.summary).toBe('Corrected in revision.')
  })

  it('returns null before the element enters story time', () => {
    const element = elementWith('The stranger', [{ chapterIndex: 5, summary: 'Arrives at the gate.' }])
    expect(elementStateAt(element, 4)).toBeNull()
    expect(elementStateAt(element, 5)?.summary).toBe('Arrives at the gate.')
  })
})

describe('element proposal acceptance', () => {
  it('makes an accepted proposal visible on the timeline', () => {
    const element = elementWith('The forged map', [
      { chapterIndex: 1, summary: 'Found in the ledger.', status: 'planted' },
    ])

    const elements = applyElementProposals([element], [{
      elementId: element.id,
      name: element.name,
      kind: 'thread',
      state: {
        chapterIndex: 4,
        summary: 'The harbor clerk admits he copied it.',
        status: 'advanced',
        location: 'Harbor',
      },
    }])

    const saved = elements[0]
    expect(elementStateAt(saved, 3)?.status).toBe('planted')
    expect(elementStateAt(saved, 4)?.summary).toBe('The harbor clerk admits he copied it.')
    expect(elementStateAt(saved, 4)?.location).toBe('Harbor')
    expect(elementStateAt(saved, 8)?.status).toBe('advanced')
  })

  it('creates an element when an accepted proposal names one that does not exist', () => {
    const elements = applyElementProposals([], [{
      name: 'The night ferry',
      kind: 'location',
      state: { chapterIndex: 2, summary: 'Stops running after the storm.', status: 'changed' },
    }])

    expect(elements).toHaveLength(1)
    expect(elements[0].kind).toBe('location')
    expect(elementStateAt(elements[0], 1)).toBeNull()
    expect(elementStateAt(elements[0], 2)?.status).toBe('changed')
  })
})
