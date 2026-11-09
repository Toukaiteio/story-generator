import type { ElementKind, ElementStatus } from '@/types/element'

/** Only these statuses are meaningful for each kind of story element. */
export const ELEMENT_STATUS_BY_KIND: Record<ElementKind, ElementStatus[]> = {
  character: ['introduced', 'active', 'changed', 'resolved'],
  event: ['introduced', 'active', 'changed', 'resolved'],
  thread: ['planted', 'advanced', 'paid', 'resolved'],
  location: ['introduced', 'active', 'changed', 'resolved'],
  object: ['introduced', 'active', 'changed', 'resolved'],
}

export const ELEMENT_KINDS: ElementKind[] = ['character', 'event', 'thread', 'location', 'object']

export function statusesForKind(kind: ElementKind): ElementStatus[] {
  return ELEMENT_STATUS_BY_KIND[kind] ?? ELEMENT_STATUS_BY_KIND.object
}

export function isStatusValidForKind(kind: ElementKind, status: ElementStatus | undefined | null): boolean {
  if (!status) return false
  return statusesForKind(kind).includes(status)
}

/** Statuses that deserve a warning colour because they close out an element. */
export function isTerminalStatus(status: ElementStatus | undefined | null): boolean {
  return status === 'paid' || status === 'resolved'
}
