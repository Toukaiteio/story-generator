import type { ElementKind, ElementState, ElementStatus, StoryElement } from '@/types/element'

const ELEMENT_KINDS: ElementKind[] = ['character', 'event', 'thread', 'location', 'object']
const ELEMENT_STATUSES: ElementStatus[] = [
  'introduced', 'active', 'changed', 'resolved', 'planted', 'advanced', 'paid', 'unknown',
]

export function isElementKind(value: unknown): value is ElementKind {
  return ELEMENT_KINDS.includes(value as ElementKind)
}

export function isElementStatus(value: unknown): value is ElementStatus {
  return ELEMENT_STATUSES.includes(value as ElementStatus)
}

/** The state that is true at story-time `chapterIndex` (inclusive). */
export function elementStateAt(element: StoryElement, chapterIndex: number): ElementState | null {
  let current: ElementState | null = null
  for (const state of element.states) {
    if (state.chapterIndex > chapterIndex) continue
    if (!current || state.chapterIndex >= current.chapterIndex) current = state
  }
  return current
}

export function latestElementState(element: StoryElement): ElementState | null {
  return element.states.length ? element.states[element.states.length - 1] : null
}

export function elementsActiveAt(elements: StoryElement[], chapterIndex: number): StoryElement[] {
  return elements.filter(element => elementStateAt(element, chapterIndex))
}

export function buildElementContextForChapter(
  elements: StoryElement[] | undefined,
  chapterIndex: number,
): string {
  if (!elements?.length) return ''
  const lines: string[] = []
  for (const element of elements) {
    const state = elementStateAt(element, chapterIndex)
    if (!state) continue
    const parts = [
      state.status ? `[${state.status}]` : '',
      state.summary,
      state.location ? `@${state.location}` : '',
      state.time ? `t:${state.time}` : '',
    ].filter(Boolean)
    lines.push(`- ${element.name} (${element.kind}): ${parts.join(' ')}`)
  }
  return lines.join('\n')
}

export function createElementState(
  state: Pick<ElementState, 'chapterIndex' | 'summary'> & Partial<ElementState>,
): ElementState {
  return {
    id: state.id ?? `es-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    chapterIndex: Number.isFinite(state.chapterIndex) ? Math.trunc(state.chapterIndex) : -1,
    time: state.time?.trim() || undefined,
    location: state.location?.trim() || undefined,
    status: isElementStatus(state.status) ? state.status : undefined,
    summary: state.summary.trim(),
    createdAt: state.createdAt ?? new Date().toISOString(),
  }
}

export function createElement(
  input: Pick<StoryElement, 'kind' | 'name'> & Partial<StoryElement>,
): StoryElement {
  const now = new Date().toISOString()
  const states = Array.isArray(input.states) ? input.states : []
  return {
    id: input.id?.trim() || `el-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: isElementKind(input.kind) ? input.kind : 'object',
    name: input.name.trim() || 'Unnamed',
    characterId: input.characterId?.trim() || undefined,
    states: states.length ? states : [createElementState({ chapterIndex: -1, summary: 'Introduced before the story begins.' })],
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  }
}

export function appendElementState(
  element: StoryElement,
  state: Pick<ElementState, 'chapterIndex' | 'summary'> & Partial<ElementState>,
): StoryElement {
  return {
    ...element,
    states: [...element.states, createElementState(state)],
    updatedAt: new Date().toISOString(),
  }
}

export function normalizeElements(raw: unknown): StoryElement[] {
  if (!Array.isArray(raw)) return []
  const usedIds = new Set<string>()
  return raw
    .filter(item => item && typeof item === 'object')
    .map((item: any) => {
      const id = typeof item.id === 'string' && item.id.trim() && !usedIds.has(item.id)
        ? item.id
        : `el-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      usedIds.add(id)
      const states = Array.isArray(item.states)
        ? item.states
          .filter((s: any) => s && typeof s === 'object' && typeof s.summary === 'string' && s.summary.trim())
          .map((s: any) => createElementState({
            ...s,
            chapterIndex: Number(s.chapterIndex),
          }))
        : []
      return createElement({ ...item, id, states })
    })
}
