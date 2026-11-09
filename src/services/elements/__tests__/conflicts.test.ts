import { describe, expect, it } from 'vitest'
import {
  detectElementConflicts,
  detectProposalConflicts,
  resolveConflictKeepingLatest,
} from '../conflicts'
import { createElement, createElementState, elementStateAt } from '../index'

function characterWithTwoPlaces() {
  return createElement({
    kind: 'character',
    name: 'Ilse Varn',
    states: [
      createElementState({ chapterIndex: 2, summary: 'At the harbor.', location: 'Harbor', status: 'active' }),
      createElementState({ chapterIndex: 2, summary: 'At the chart office.', location: 'Chart office', status: 'active' }),
    ],
  })
}

describe('element timeline conflict detection', () => {
  it('flags one character in two places in the same chapter', () => {
    const conflicts = detectElementConflicts([characterWithTwoPlaces()])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].reason).toBe('location-conflict')
    expect(conflicts[0].chapterIndex).toBe(2)
    expect(conflicts[0].detail).toContain('Harbor')
  })

  it('flags a thread both planted and paid in the same chapter', () => {
    const thread = createElement({
      kind: 'thread',
      name: 'The forged map',
      states: [
        createElementState({ chapterIndex: 4, summary: 'Hidden again.', status: 'planted' }),
        createElementState({ chapterIndex: 4, summary: 'Burned.', status: 'paid' }),
      ],
    })
    const conflicts = detectElementConflicts([thread])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].reason).toBe('status-conflict')
  })

  it('accepts compatible states at the same chapter', () => {
    const element = createElement({
      kind: 'object',
      name: 'The brass weight',
      states: [
        createElementState({ chapterIndex: 1, summary: 'On the chart table.', location: 'Chart office', status: 'active' }),
        createElementState({ chapterIndex: 1, summary: 'Moved with the map.', location: 'Chart office', status: 'active' }),
      ],
    })
    expect(detectElementConflicts([element])).toEqual([])
  })

  it('flags a proposal that would contradict the saved state', () => {
    const element = createElement({
      kind: 'thread',
      name: 'The forged map',
      states: [createElementState({ chapterIndex: 3, summary: 'Handed over.', status: 'paid' })],
    })
    const conflicts = detectProposalConflicts([element], [{
      elementId: element.id,
      name: element.name,
      kind: 'thread',
      state: { chapterIndex: 3, summary: 'Planted again.', status: 'planted' },
    }])

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].reason).toBe('proposal-conflict')
  })

  it('keeps the latest state when the reviewer accepts the conflict', () => {
    const element = characterWithTwoPlaces()
    const conflict = detectElementConflicts([element])[0]
    const latestId = element.states[element.states.length - 1].id

    const resolved = resolveConflictKeepingLatest([element], conflict)[0]
    expect(resolved.states).toHaveLength(1)
    expect(resolved.states[0].id).toBe(latestId)
    expect(elementStateAt(resolved, 2)?.location).toBe('Chart office')
  })
})
