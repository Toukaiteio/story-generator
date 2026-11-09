import type { ElementState, StoryElement } from '@/types/element'
import { elementStateAt } from './index'

export interface ElementContextCapsule {
  element: StoryElement
  state: ElementState
}

export interface ElementContextSlice {
  items: ElementContextCapsule[]
  hiddenCount: number
}

/**
 * Elements injected into generation at a chapter. One capsule per element id:
 * a duplicate element record must never surface twice, and the capsule always
 * carries the status that is true at this chapter.
 */
export function elementContextCapsules(
  elements: StoryElement[] | undefined,
  chapterIndex: number,
  limit = 8,
): ElementContextSlice {
  const seen = new Set<string>()
  const all: ElementContextCapsule[] = []

  for (const element of elements ?? []) {
    if (seen.has(element.id)) continue
    const state = elementStateAt(element, chapterIndex)
    if (!state) continue
    seen.add(element.id)
    all.push({ element, state })
  }

  return {
    items: all.slice(0, limit),
    hiddenCount: Math.max(0, all.length - limit),
  }
}
