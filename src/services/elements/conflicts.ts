import type { ElementKind, ElementState, StoryElement } from '@/types/element'

export type ElementConflictReason = 'location-conflict' | 'status-conflict' | 'proposal-conflict'

export interface ElementStateConflict {
  id: string
  elementId: string
  elementName: string
  kind: ElementKind
  chapterIndex: number
  stateIds: string[]
  reason: ElementConflictReason
  detail: string
}

const CLOSING_STATUSES = new Set(['paid', 'resolved'])

function conflictKey(elementId: string, chapterIndex: number, stateIds: string[]): string {
  return `${elementId}::${chapterIndex}::${[...stateIds].sort().join('|')}`
}

/**
 * Contradictions inside one element at one chapter: an object or character in
 * two places, a thread both planted and paid, or two closing statuses that
 * cannot both be true. The UI reviews these; nothing is overwritten silently.
 */
export function detectElementConflicts(elements: StoryElement[] | undefined): ElementStateConflict[] {
  const conflicts: ElementStateConflict[] = []

  for (const element of elements ?? []) {
    const byChapter = new Map<number, ElementState[]>()
    for (const state of element.states) {
      if (state.chapterIndex < 0) continue
      const bucket = byChapter.get(state.chapterIndex) ?? []
      bucket.push(state)
      byChapter.set(state.chapterIndex, bucket)
    }

    for (const [chapterIndex, states] of byChapter) {
      if (states.length < 2) continue

      for (let first = 0; first < states.length; first++) {
        for (let second = first + 1; second < states.length; second++) {
          const a = states[first]
          const b = states[second]
          const locations = [a.location?.trim(), b.location?.trim()].filter(Boolean) as string[]
          const statuses = [a.status, b.status].filter(Boolean) as string[]

          if (locations.length === 2 && locations[0] !== locations[1]) {
            conflicts.push({
              id: conflictKey(element.id, chapterIndex, [a.id, b.id]),
              elementId: element.id,
              elementName: element.name,
              kind: element.kind,
              chapterIndex,
              stateIds: [a.id, b.id],
              reason: 'location-conflict',
              detail: locations.join(' ↔ '),
            })
            continue
          }

          if (statuses.length === 2 && statuses[0] !== statuses[1]) {
            const closing = statuses.filter(status => CLOSING_STATUSES.has(status))
            const threadPair = element.kind === 'thread'
              && statuses.includes('planted')
              && statuses.includes('paid')
            if (threadPair || closing.length === 2) {
              conflicts.push({
                id: conflictKey(element.id, chapterIndex, [a.id, b.id]),
                elementId: element.id,
                elementName: element.name,
                kind: element.kind,
                chapterIndex,
                stateIds: [a.id, b.id],
                reason: 'status-conflict',
                detail: statuses.join(' ↔ '),
              })
            }
          }
        }
      }
    }
  }

  return conflicts
}

/** Conflicts a pending proposal would introduce if applied as-is. */
export function detectProposalConflicts(
  elements: StoryElement[] | undefined,
  proposals: Array<{
    elementId?: string
    name: string
    kind: ElementKind
    state: { chapterIndex: number; summary?: string; location?: string; status?: string }
  }>,
): ElementStateConflict[] {
  const byId = new Map((elements ?? []).map(element => [element.id, element]))
  const byName = new Map((elements ?? []).map(element => [`${element.kind}:${element.name}`, element]))
  const conflicts: ElementStateConflict[] = []

  for (const [index, proposal] of proposals.entries()) {
    const existing = proposal.elementId
      ? byId.get(proposal.elementId)
      : byName.get(`${proposal.kind}:${proposal.name}`)
    if (!existing) continue

    for (const state of existing.states) {
      if (state.chapterIndex !== proposal.state.chapterIndex) continue

      const locationChanged = Boolean(
        state.location?.trim()
        && proposal.state.location?.trim()
        && state.location.trim() !== proposal.state.location.trim(),
      )
      const statusChanged = Boolean(
        state.status
        && proposal.state.status
        && state.status !== proposal.state.status
        && (CLOSING_STATUSES.has(state.status) || CLOSING_STATUSES.has(proposal.state.status)),
      )

      if (!locationChanged && !statusChanged) continue

      conflicts.push({
        id: `proposal-${index}-${existing.id}-${state.id}`,
        elementId: existing.id,
        elementName: existing.name,
        kind: existing.kind,
        chapterIndex: proposal.state.chapterIndex,
        stateIds: [state.id],
        reason: 'proposal-conflict',
        detail: locationChanged
          ? `${state.location} ↔ ${proposal.state.location}`
          : `${state.status} ↔ ${proposal.state.status}`,
      })
    }
  }

  return conflicts
}

/**
 * Accepting a conflict keeps the later state at that chapter and drops the
 * earlier one. The caller persists the returned element list.
 */
export function resolveConflictKeepingLatest(
  elements: StoryElement[],
  conflict: ElementStateConflict,
): StoryElement[] {
  return elements.map(element => {
    if (element.id !== conflict.elementId) return element
    const states = element.states.filter(state =>
      !(conflict.stateIds.includes(state.id) && state.id !== conflict.stateIds[conflict.stateIds.length - 1]),
    )
    return { ...element, states, updatedAt: new Date().toISOString() }
  })
}
