import type { Character } from '@/types/character'
import type { StoryProject } from '@/types/project'
import type { CharacterRelationshipState } from '@/types/relationship'
import { getRelationshipsAt } from './index'

function characterName(charactersById: Map<string, Character>, id: string) {
  return charactersById.get(id)?.name ?? id
}

function formatScore(label: string, value: number) {
  if (!value) return ''
  return `${label} ${value > 0 ? '+' : ''}${value}`
}

function formatRelationshipState(
  state: CharacterRelationshipState,
  charactersById: Map<string, Character>
) {
  const scores = [
    formatScore('trust', state.trust),
    formatScore('affinity', state.affinity),
    state.tension ? `tension ${state.tension}` : '',
  ].filter(Boolean).join(', ')

  const from = characterName(charactersById, state.fromId)
  const to = characterName(charactersById, state.toId)
  const scoreText = scores ? ` (${scores})` : ''
  const evidence = state.evidence ? ` Evidence: ${state.evidence}` : ''
  const eventIds = state.recentEventIds.length ? ` Recent event IDs: ${state.recentEventIds.join(', ')}` : ''
  const description = state.description ? ` ${state.description}` : ''

  return `- ${from} -> ${to}: ${state.label || state.status}${scoreText}.${description}${evidence}${eventIds}`.trim()
}

export function buildRelationshipContext(project: StoryProject, chapterIndex: number, maxItems = 24): string {
  const relationships = getRelationshipsAt(project, chapterIndex)
  if (!relationships.length) return ''

  const charactersById = new Map(project.characters.map(character => [character.id, character]))
  const sorted = relationships
    .filter(state => charactersById.has(state.fromId) && charactersById.has(state.toId))
    .sort((a, b) => {
      const aWeight = Math.abs(a.trust) + Math.abs(a.affinity) + a.tension
      const bWeight = Math.abs(b.trust) + Math.abs(b.affinity) + b.tension
      return bWeight - aWeight
    })
    .slice(0, maxItems)

  if (!sorted.length) return ''

  const label = chapterIndex >= 0
    ? `Relationships at the end of Chapter ${chapterIndex + 1}:`
    : 'Initial relationships before Chapter 1:'

  return [
    label,
    ...sorted.map(state => formatRelationshipState(state, charactersById)),
  ].join('\n')
}
