import type { Character } from '@/types/character'
import type { StoryProject } from '@/types/project'
import type {
  CharacterRelationshipEvent,
  CharacterRelationshipState,
  RelationshipEventLocation,
  RelationshipEventType,
  RelationshipSource,
  RelationshipStatus,
} from '@/types/relationship'

const MIN_SCORE = -100
const MAX_SCORE = 100
const MIN_TENSION = 0
const RECENT_EVENT_LIMIT = 8

function clamp(value: number, min = MIN_SCORE, max = MAX_SCORE) {
  if (!Number.isFinite(value)) return 0
  return Math.max(min, Math.min(max, Math.round(value)))
}

function relationKey(fromId: string, toId: string) {
  return `${fromId}->${toId}`
}

function normalizeStatus(value: unknown): RelationshipStatus {
  if (value === 'active' || value === 'changed' || value === 'ended' || value === 'unknown') {
    return value
  }
  return 'active'
}

function normalizeSource(value: unknown): RelationshipSource {
  if (value === 'initial' || value === 'planned' || value === 'generated' || value === 'manual') {
    return value
  }
  return 'manual'
}

function normalizeEventType(value: unknown): RelationshipEventType {
  const allowed: RelationshipEventType[] = [
    'first_meeting',
    'cooperation',
    'conflict',
    'betrayal',
    'reconciliation',
    'revelation',
    'rescue',
    'threat',
    'promise',
    'secret_shared',
    'secret_hidden',
    'romantic_shift',
    'trust_gain',
    'trust_loss',
    'separation',
    'other',
  ]
  return allowed.includes(value as RelationshipEventType) ? value as RelationshipEventType : 'other'
}

function createInitialState(
  character: Character,
  relation: Character['relations'][number]
): CharacterRelationshipState {
  return {
    fromId: character.id,
    toId: relation.targetId,
    label: relation.relation,
    description: relation.description,
    status: 'active',
    trust: 0,
    affinity: 0,
    tension: 0,
    evidence: 'Initial character relationship.',
    updatedAtChapterIndex: -1,
    source: 'initial',
    recentEventIds: [],
  }
}

function normalizeEvent(event: CharacterRelationshipEvent): CharacterRelationshipEvent {
  return {
    ...event,
    type: normalizeEventType(event.type),
    summary: event.summary?.trim() || event.description?.trim() || event.label?.trim() || 'Relationship changed.',
    status: event.status ? normalizeStatus(event.status) : undefined,
    source: normalizeSource(event.source),
  }
}

function applyEvent(
  current: CharacterRelationshipState | undefined,
  event: CharacterRelationshipEvent
): CharacterRelationshipState {
  const normalized = normalizeEvent(event)
  const previous = current ?? {
    fromId: normalized.fromId,
    toId: normalized.toId,
    label: '',
    description: '',
    status: 'unknown' as RelationshipStatus,
    trust: 0,
    affinity: 0,
    tension: 0,
    evidence: '',
    updatedAtChapterIndex: -1,
    source: normalized.source,
    recentEventIds: [],
  }

  const recentEventIds = normalized.id
    ? [...previous.recentEventIds.filter(id => id !== normalized.id), normalized.id].slice(-RECENT_EVENT_LIMIT)
    : previous.recentEventIds

  return {
    fromId: normalized.fromId,
    toId: normalized.toId,
    label: normalized.label?.trim() || previous.label,
    description: normalized.description?.trim() || previous.description,
    status: normalized.status ?? previous.status,
    trust: normalized.trust != null
      ? clamp(normalized.trust)
      : clamp(previous.trust + (normalized.trustDelta ?? 0)),
    affinity: normalized.affinity != null
      ? clamp(normalized.affinity)
      : clamp(previous.affinity + (normalized.affinityDelta ?? 0)),
    tension: normalized.tension != null
      ? clamp(normalized.tension, MIN_TENSION, MAX_SCORE)
      : clamp(previous.tension + (normalized.tensionDelta ?? 0), MIN_TENSION, MAX_SCORE),
    evidence: normalized.evidence?.trim() || previous.evidence,
    updatedAtChapterIndex: normalized.chapterIndex,
    source: normalized.source,
    recentEventIds,
  }
}

function buildInitialRelationshipMap(characters: Character[]) {
  const states = new Map<string, CharacterRelationshipState>()

  for (const character of characters) {
    for (const relation of character.relations) {
      if (!relation.targetId || relation.targetId === character.id) continue
      states.set(relationKey(character.id, relation.targetId), createInitialState(character, relation))
    }
  }

  return states
}

export function getRelationshipsAt(project: StoryProject, chapterIndex: number): CharacterRelationshipState[] {
  const states = buildInitialRelationshipMap(project.characters)
  const events = [...(project.relationshipEvents ?? [])]
    .filter(event => event.chapterIndex <= chapterIndex)
    .sort((a, b) => {
      if (a.chapterIndex !== b.chapterIndex) return a.chapterIndex - b.chapterIndex
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })

  for (const event of events) {
    if (!event.fromId || !event.toId || event.fromId === event.toId) continue
    const key = relationKey(event.fromId, event.toId)
    states.set(key, applyEvent(states.get(key), event))
  }

  return [...states.values()].filter(state => state.status !== 'ended')
}

export function getLatestRelationshipChapterIndex(project: StoryProject): number {
  const eventMax = (project.relationshipEvents ?? []).reduce(
    (max, event) => Math.max(max, Number.isFinite(event.chapterIndex) ? event.chapterIndex : -1),
    -1
  )
  return Math.max(eventMax, project.chapters.length - 1, -1)
}

export function getLatestRelationships(project: StoryProject): CharacterRelationshipState[] {
  return getRelationshipsAt(project, getLatestRelationshipChapterIndex(project))
}

export function getRelationshipAt(
  project: StoryProject,
  fromId: string,
  toId: string,
  chapterIndex: number
): CharacterRelationshipState | null {
  return getRelationshipsAt(project, chapterIndex)
    .find(state => state.fromId === fromId && state.toId === toId) ?? null
}

export function getRelationshipTimeline(
  project: StoryProject,
  fromId: string,
  toId: string
): CharacterRelationshipEvent[] {
  return [...(project.relationshipEvents ?? [])]
    .filter(event => event.fromId === fromId && event.toId === toId)
    .sort((a, b) => {
      if (a.chapterIndex !== b.chapterIndex) return a.chapterIndex - b.chapterIndex
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })
}

export function getCharacterRelationshipsAt(
  project: StoryProject,
  characterId: string,
  chapterIndex: number
): CharacterRelationshipState[] {
  return getRelationshipsAt(project, chapterIndex)
    .filter(state => state.fromId === characterId || state.toId === characterId)
}

export interface RelationshipEventQuery {
  fromId?: string
  toId?: string
  characterId?: string
  chapterIndex?: number
  type?: RelationshipEventType
  limit?: number
}

export function getRelationshipEvents(
  project: StoryProject,
  query: RelationshipEventQuery = {}
): CharacterRelationshipEvent[] {
  const limit = Math.max(1, Math.min(query.limit ?? 12, 50))
  return [...(project.relationshipEvents ?? [])]
    .filter(event => {
      if (query.fromId && event.fromId !== query.fromId) return false
      if (query.toId && event.toId !== query.toId) return false
      if (query.characterId && event.fromId !== query.characterId && event.toId !== query.characterId) return false
      if (query.chapterIndex != null && event.chapterIndex !== query.chapterIndex) return false
      if (query.type && normalizeEventType(event.type) !== query.type) return false
      return true
    })
    .sort((a, b) => {
      if (a.chapterIndex !== b.chapterIndex) return b.chapterIndex - a.chapterIndex
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
    .slice(0, limit)
}

export function getRelationshipEventById(
  project: StoryProject,
  eventId: string
): CharacterRelationshipEvent | null {
  return (project.relationshipEvents ?? []).find(event => event.id === eventId) ?? null
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function buildExcerpt(content: string, offset: number, length = 420) {
  if (offset < 0) return content.slice(0, length).trim()
  const half = Math.floor(length / 2)
  const start = Math.max(0, offset - half)
  const end = Math.min(content.length, offset + half)
  return content.slice(start, end).trim()
}

export function locateRelationshipEvent(
  project: StoryProject,
  eventId: string
): RelationshipEventLocation | null {
  const event = getRelationshipEventById(project, eventId)
  if (!event) return null

  const chapter = project.chapters.find(item => item.id === event.chapterId)
    ?? project.chapters.find(item => item.index === event.chapterIndex)
    ?? null
  if (!chapter) return null

  const content = chapter.polishedContent || chapter.proofreadContent || chapter.content || ''
  const evidence = event.evidence?.trim() || event.summary?.trim() || event.description?.trim() || ''
  if (!content.trim()) {
    return {
      eventId,
      chapterId: chapter.id,
      chapterIndex: chapter.index,
      chapterTitle: chapter.title,
      evidence,
      excerpt: '',
      approximateOffset: null,
    }
  }

  let offset = evidence ? content.indexOf(evidence) : -1
  if (offset < 0 && evidence) {
    const normalizedEvidence = normalizeText(evidence)
    const normalizedContent = normalizeText(content)
    const normalizedOffset = normalizedContent.indexOf(normalizedEvidence)
    if (normalizedOffset >= 0) {
      offset = Math.min(normalizedOffset, content.length - 1)
    }
  }

  if (offset < 0 && evidence) {
    const keywords = evidence
      .split(/\s+/)
      .map(word => word.replace(/[^\p{L}\p{N}_-]/gu, '').trim())
      .filter(word => word.length >= 3)
      .slice(0, 8)
    const lowered = content.toLowerCase()
    const hits = keywords
      .map(word => lowered.indexOf(word.toLowerCase()))
      .filter(index => index >= 0)
    if (hits.length) offset = Math.min(...hits)
  }

  return {
    eventId,
    chapterId: chapter.id,
    chapterIndex: chapter.index,
    chapterTitle: chapter.title,
    evidence,
    excerpt: buildExcerpt(content, offset),
    approximateOffset: offset >= 0 ? offset : null,
  }
}

export function appendRelationshipEventsForChapter(
  project: StoryProject,
  chapterId: string,
  events: CharacterRelationshipEvent[],
  source: RelationshipSource = 'generated'
): CharacterRelationshipEvent[] {
  return [
    ...(project.relationshipEvents ?? []).filter(event =>
      !(event.chapterId === chapterId && event.source === source)
    ),
    ...events,
  ]
}
