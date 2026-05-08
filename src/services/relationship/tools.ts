import type { StoryProject } from '@/types/project'
import type { Character } from '@/types/character'
import type { ToolCall, ToolDefinition, ToolResult } from '@/services/provider/tools'
import type { RelationshipEventType } from '@/types/relationship'
import {
  getCharacterRelationshipsAt,
  getLatestRelationshipChapterIndex,
  getLatestRelationships,
  getRelationshipAt,
  getRelationshipEventById,
  getRelationshipEvents,
  getRelationshipsAt,
  locateRelationshipEvent,
} from './index'

function normalizeName(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function findCharacter(characters: Character[], name: unknown, id?: unknown): Character | null {
  const normalizedId = String(id ?? '').trim()
  if (normalizedId) {
    const byId = characters.find(character => character.id === normalizedId)
    if (byId) return byId
  }

  const normalized = normalizeName(name)
  if (!normalized) return null

  return characters.find(character => character.name.trim().toLowerCase() === normalized)
    ?? characters.find(character => {
      const candidate = character.name.trim().toLowerCase()
      return candidate.includes(normalized) || normalized.includes(candidate)
    })
    ?? null
}

function characterName(project: StoryProject, id: string) {
  return project.characters.find(character => character.id === id)?.name ?? id
}

function readChapterIndex(project: StoryProject, value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return getLatestRelationshipChapterIndex(project)
  return Math.max(-1, Math.min(project.chapters.length - 1, Math.trunc(parsed)))
}

function readLimit(value: unknown, fallback = 10) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(Math.trunc(parsed), 30))
}

function compactRelationship(project: StoryProject, state: ReturnType<typeof getRelationshipsAt>[number]) {
  return {
    fromId: state.fromId,
    fromName: characterName(project, state.fromId),
    toId: state.toId,
    toName: characterName(project, state.toId),
    label: state.label,
    description: state.description,
    status: state.status,
    trust: state.trust,
    affinity: state.affinity,
    tension: state.tension,
    updatedAtChapterIndex: state.updatedAtChapterIndex,
    recentEventIds: state.recentEventIds,
  }
}

function compactEvent(project: StoryProject, event: NonNullable<ReturnType<typeof getRelationshipEventById>>) {
  return {
    id: event.id,
    chapterIndex: event.chapterIndex,
    chapterTitle: project.chapters.find(chapter => chapter.id === event.chapterId)?.title
      ?? project.chapters.find(chapter => chapter.index === event.chapterIndex)?.title
      ?? '',
    fromId: event.fromId,
    fromName: characterName(project, event.fromId),
    toId: event.toId,
    toName: characterName(project, event.toId),
    type: event.type,
    label: event.label,
    summary: event.summary,
    description: event.description,
    evidence: event.evidence,
    deltas: {
      trust: event.trustDelta ?? 0,
      affinity: event.affinityDelta ?? 0,
      tension: event.tensionDelta ?? 0,
    },
  }
}

function compactCharacter(character: Character) {
  return {
    id: character.id,
    name: character.name,
    role: character.role,
    personality: character.personality,
    appearance: character.appearance,
    motivation: character.motivation,
    goals: character.goals,
    conflicts: character.conflicts,
    currentState: character.currentState,
  }
}

export function getRelationshipQueryTools(): ToolDefinition[] {
  return [
    {
      name: 'get_relationships_at_chapter',
      description: 'Get relationship states at the end of a chapter, optionally filtered to one character.',
      parameters: {
        type: 'object',
        properties: {
          chapterIndex: {
            type: 'number',
            description: 'Zero-based chapter index. Use -1 for initial state before chapter 1.',
          },
          characterName: {
            type: 'string',
            description: 'Optional character name to filter the relationship network.',
          },
          characterId: {
            type: 'string',
            description: 'Optional character ID to filter the relationship network.',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of relationships to return.',
          },
        },
        required: ['chapterIndex'],
      },
    },
    {
      name: 'get_latest_relationships',
      description: 'Get the latest relationship states, optionally filtered to one character.',
      parameters: {
        type: 'object',
        properties: {
          characterName: {
            type: 'string',
            description: 'Optional character name to filter the relationship network.',
          },
          characterId: {
            type: 'string',
            description: 'Optional character ID to filter the relationship network.',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of relationships to return.',
          },
        },
        required: [],
      },
    },
    {
      name: 'get_relationship_between',
      description: 'Get one directed relationship between two characters at a chapter.',
      parameters: {
        type: 'object',
        properties: {
          chapterIndex: {
            type: 'number',
            description: 'Zero-based chapter index. Omit or use a negative value for latest available state.',
          },
          fromName: {
            type: 'string',
            description: 'Source character name.',
          },
          fromId: {
            type: 'string',
            description: 'Source character ID.',
          },
          toName: {
            type: 'string',
            description: 'Target character name.',
          },
          toId: {
            type: 'string',
            description: 'Target character ID.',
          },
        },
        required: [],
      },
    },
    {
      name: 'get_relationship_events',
      description: 'Search relationship events by character, pair, chapter, or event type. Returns compact entries with event IDs.',
      parameters: {
        type: 'object',
        properties: {
          fromName: { type: 'string', description: 'Optional source character name.' },
          fromId: { type: 'string', description: 'Optional source character ID.' },
          toName: { type: 'string', description: 'Optional target character name.' },
          toId: { type: 'string', description: 'Optional target character ID.' },
          characterName: { type: 'string', description: 'Optional character name appearing on either side.' },
          characterId: { type: 'string', description: 'Optional character ID appearing on either side.' },
          chapterIndex: { type: 'number', description: 'Optional zero-based chapter index.' },
          eventType: { type: 'string', description: 'Optional relationship event type.' },
          limit: { type: 'number', description: 'Maximum number of events to return.' },
        },
        required: [],
      },
    },
    {
      name: 'get_relationship_event',
      description: 'Get one relationship event by ID with a coarse location excerpt from the chapter text.',
      parameters: {
        type: 'object',
        properties: {
          eventId: {
            type: 'string',
            description: 'Relationship event ID returned by relationship event search or recentEventIds.',
          },
        },
        required: ['eventId'],
      },
    },
    {
      name: 'get_character_profile',
      description: 'Get one character profile by ID or name. Use this only when the compact character list is insufficient.',
      parameters: {
        type: 'object',
        properties: {
          characterId: {
            type: 'string',
            description: 'Character ID from the compact character list.',
          },
          characterName: {
            type: 'string',
            description: 'Character name.',
          },
        },
        required: [],
      },
    },
  ]
}

export async function handleRelationshipQueryTool(
  toolCall: ToolCall,
  project: StoryProject
): Promise<ToolResult | null> {
  const args = toolCall.arguments ?? {}

  if (toolCall.name === 'get_relationships_at_chapter') {
    const chapterIndex = readChapterIndex(project, args.chapterIndex)
    const limit = readLimit(args.limit)
    const character = findCharacter(project.characters, args.characterName, args.characterId)
    const relationships = character
      ? getCharacterRelationshipsAt(project, character.id, chapterIndex)
      : getRelationshipsAt(project, chapterIndex)

    return {
      tool_call_id: toolCall.id,
      content: JSON.stringify({
        chapterIndex,
        characterName: character?.name ?? null,
        relationships: relationships.slice(0, limit).map(state => compactRelationship(project, state)),
      }),
    }
  }

  if (toolCall.name === 'get_latest_relationships') {
    const limit = readLimit(args.limit)
    const latestIndex = getLatestRelationshipChapterIndex(project)
    const character = findCharacter(project.characters, args.characterName, args.characterId)
    const relationships = character
      ? getCharacterRelationshipsAt(project, character.id, latestIndex)
      : getLatestRelationships(project)

    return {
      tool_call_id: toolCall.id,
      content: JSON.stringify({
        chapterIndex: latestIndex,
        characterName: character?.name ?? null,
        relationships: relationships.slice(0, limit).map(state => compactRelationship(project, state)),
      }),
    }
  }

  if (toolCall.name === 'get_relationship_between') {
    const from = findCharacter(project.characters, args.fromName, args.fromId)
    const to = findCharacter(project.characters, args.toName, args.toId)
    if (!from || !to) {
      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({ error: 'Character not found', fromFound: !!from, toFound: !!to }),
      }
    }

    const chapterIndex = args.chapterIndex == null || Number(args.chapterIndex) < 0
      ? getLatestRelationshipChapterIndex(project)
      : readChapterIndex(project, args.chapterIndex)
    const relationship = getRelationshipAt(project, from.id, to.id, chapterIndex)

    return {
      tool_call_id: toolCall.id,
      content: JSON.stringify({
        chapterIndex,
        relationship: relationship ? compactRelationship(project, relationship) : null,
      }),
    }
  }

  if (toolCall.name === 'get_relationship_events') {
    const from = findCharacter(project.characters, args.fromName, args.fromId)
    const to = findCharacter(project.characters, args.toName, args.toId)
    const character = findCharacter(project.characters, args.characterName, args.characterId)
    const events = getRelationshipEvents(project, {
      fromId: from?.id,
      toId: to?.id,
      characterId: character?.id,
      chapterIndex: args.chapterIndex == null ? undefined : readChapterIndex(project, args.chapterIndex),
      type: args.eventType as RelationshipEventType | undefined,
      limit: readLimit(args.limit, 8),
    })

    return {
      tool_call_id: toolCall.id,
      content: JSON.stringify({
        events: events.map(event => compactEvent(project, event)),
      }),
    }
  }

  if (toolCall.name === 'get_relationship_event') {
    const event = getRelationshipEventById(project, String(args.eventId ?? '').trim())
    if (!event) {
      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({ error: 'Relationship event not found' }),
      }
    }

    return {
      tool_call_id: toolCall.id,
      content: JSON.stringify({
        event: compactEvent(project, event),
        location: locateRelationshipEvent(project, event.id),
      }),
    }
  }

  if (toolCall.name === 'get_character_profile') {
    const character = findCharacter(project.characters, args.characterName, args.characterId)
    return {
      tool_call_id: toolCall.id,
      content: JSON.stringify({
        character: character ? compactCharacter(character) : null,
      }),
    }
  }

  return null
}
