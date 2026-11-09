import { describe, expect, it } from 'vitest'
import {
  ELEMENT_STATUS_BY_KIND,
  isStatusValidForKind,
  statusesForKind,
} from '../status'
import { createElement, createElementState } from '../index'
import type { ElementKind, ElementStatus } from '@/types/element'

const KINDS: ElementKind[] = ['character', 'event', 'thread', 'location', 'object']
const ALL_STATUSES: ElementStatus[] = [
  'introduced', 'active', 'changed', 'resolved', 'planted', 'advanced', 'paid', 'unknown',
]

describe('per-kind element status map', () => {
  it('defines a non-empty status list for every kind', () => {
    for (const kind of KINDS) {
      expect(statusesForKind(kind).length).toBeGreaterThan(0)
    }
  })

  it('never offers thread-only statuses for a character', () => {
    for (const status of ['planted', 'advanced', 'paid'] as ElementStatus[]) {
      expect(isStatusValidForKind('character', status)).toBe(false)
      expect(isStatusValidForKind('event', status)).toBe(false)
      expect(isStatusValidForKind('location', status)).toBe(false)
      expect(isStatusValidForKind('object', status)).toBe(false)
    }
  })

  it('keeps planted, advanced and paid for threads only', () => {
    expect(statusesForKind('thread')).toEqual(['planted', 'advanced', 'paid', 'resolved'])
    for (const kind of KINDS.filter(kind => kind !== 'thread')) {
      for (const status of ['planted', 'advanced', 'paid'] as ElementStatus[]) {
        expect(ELEMENT_STATUS_BY_KIND[kind]).not.toContain(status)
      }
    }
  })

  it('treats unknown and empty statuses as invalid', () => {
    for (const kind of KINDS) {
      expect(isStatusValidForKind(kind, 'unknown')).toBe(false)
      expect(isStatusValidForKind(kind, undefined)).toBe(false)
      expect(isStatusValidForKind(kind, null)).toBe(false)
    }
  })

  it('keeps every kind status inside the global status union', () => {
    for (const kind of KINDS) {
      for (const status of statusesForKind(kind)) {
        expect(ALL_STATUSES).toContain(status)
      }
    }
  })

  it('stores a state whose status is not valid for the kind without rewriting it', () => {
    const element = createElement({
      kind: 'character',
      name: 'Ilse',
      states: [createElementState({ chapterIndex: 1, summary: 'Lies to the clerk.', status: 'planted' })],
    })
    expect(element.states[0].status).toBe('planted')
    expect(isStatusValidForKind(element.kind, element.states[0].status)).toBe(false)
  })
})
