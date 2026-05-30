import type { StoryProject } from '@/types/project'
import type { Character } from '@/types/character'
import type { CharacterRelationshipEvent, ExtractedRelationshipEvent } from '@/types/relationship'
import { getAgent } from '@/services/agent'
import { extractJsonPayload } from '@/services/agent/validation'
import { buildCharacterContextForTask, buildProjectRelationshipContext } from './context'
import { getLinkedKnowledgeBases, preparePlanningRuntime, prepareProviderRuntime, getContextTokens } from './runtime'
import { buildProofreadingSegments } from '@/services/proofreading/chunking'
import { generateId } from '@/lib/id'
import type { PlanningDraft } from './types'
import type { PlanningRuntime } from './runtime'

const NO_CHARACTER_SIGNAL_RE = /^(none|n\/a|na|no characters?|无|无需|不需要|没有|none needed|not needed)$/i

export function stripCodeFence(content: string) {
  return content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim()
}

export function normalizePlanningSectionName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[:：]+/g, '')
    .replace(/\s+/g, ' ')
}

export function extractPlanningSections(content: string) {
  const sections: Record<string, string> = {}
  const lines = content.split(/\r?\n/)
  let currentKey = 'preamble'
  let buffer: string[] = []

  const flush = () => {
    const text = buffer.join('\n').trim()
    if (!text) {
      buffer = []
      return
    }

    sections[currentKey] = sections[currentKey]
      ? `${sections[currentKey]}\n${text}`.trim()
      : text
    buffer = []
  }

  for (const line of lines) {
    const headingMatch = line.match(/^\s{0,3}(#{1,6})\s*(.+?)\s*$/)
    if (headingMatch) {
      flush()
      currentKey = normalizePlanningSectionName(headingMatch[2])
      continue
    }

    buffer.push(line)
  }

  flush()
  return sections
}

export function readPlanningBoolean(value: any): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return null
    if (['true', 'yes', 'y', '1', 'needed', 'need', 'required'].includes(normalized)) return true
    if (['false', 'no', 'n', '0', 'none', 'not needed', 'unneeded', 'skip'].includes(normalized)) return false
  }
  return null
}

export function normalizePlanningText(value: any): string {
  if (typeof value === 'string') return stripCodeFence(value).trim()
  if (Array.isArray(value)) {
    return value
      .map(item => typeof item === 'string' ? item.trim() : JSON.stringify(item))
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value, null, 2)
  }
  return ''
}

function getCharacterSignalsFromSections(sections: Record<string, string>) {
  return sections['character signals']
    ?? sections['character needs']
    ?? sections['characters needed']
    ?? sections.cast
    ?? sections['character brief']
    ?? sections['角色需求']
    ?? sections['角色信号']
    ?? sections['角色创建']
    ?? ''
}

export function parsePlanningDraft(response: string): PlanningDraft {
  const text = stripCodeFence(response).trim()
  const fallback: PlanningDraft = {
    title: '',
    synopsis: '',
    outline: text,
    characterSignals: '',
    needsCharacters: null,
  }

  if (!text) return fallback

  try {
    const raw = JSON.parse(extractJsonPayload(text))
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const title = typeof raw.title === 'string' ? raw.title.trim() : ''
      const synopsis = typeof raw.synopsis === 'string' ? raw.synopsis.trim() : ''
      const outline = typeof raw.outline === 'string' && raw.outline.trim() ? raw.outline.trim() : text
      const characterSignals = normalizePlanningText(raw.characterSignals ?? raw.characterNeeds ?? raw.charactersNeeded ?? raw.roleSignals)
      const needsCharacters = readPlanningBoolean(raw.needsCharacters ?? raw.needCharacters)
        ?? readPlanningBoolean(raw.characterSignals?.needsCharacters)
        ?? readPlanningBoolean(raw.characterNeeds?.needsCharacters)
      return {
        title,
        synopsis,
        outline,
        characterSignals,
        needsCharacters,
      }
    }
  } catch {
    // Fall back to a section-based parse.
  }

  const sections = extractPlanningSections(text)
  const characterSignals = getCharacterSignalsFromSections(sections)

  return {
    title: sections.title ?? '',
    synopsis: sections.synopsis ?? '',
    outline: sections.outline ?? sections['story outline'] ?? text,
    characterSignals,
    needsCharacters: readPlanningBoolean(sections['needs characters'])
      ?? (characterSignals.trim()
        ? !NO_CHARACTER_SIGNAL_RE.test(characterSignals.trim().toLowerCase())
        : null),
  }
}

export function getPreferredCharacterCount(project: StoryProject): number {
  const existingCount = project.characters.length
  const chapterBasedCount = project.chapterCount <= 4
    ? 4
    : project.chapterCount >= 15
      ? 6
      : 5

  return Math.max(chapterBasedCount, existingCount, 1)
}

export function shouldCreateCharacters(project: StoryProject, draft: PlanningDraft): boolean {
  if (project.characters.length < getPreferredCharacterCount(project)) return true
  if (draft.needsCharacters !== null) return draft.needsCharacters

  const signals = draft.characterSignals.trim().toLowerCase()
  if (!signals) return false
  return !NO_CHARACTER_SIGNAL_RE.test(signals)
}

export function emitPlanningToken(onToken: ((token: string) => void) | undefined, label: string) {
  onToken?.(`\n\n[Planning] ${label}\n`)
}

export function parseGeneratedCharacters(response: string, context?: Record<string, any>): Character[] {
  const now = new Date().toISOString()

  if (context?._charactersData && Array.isArray(context._charactersData)) {
    return parseCharacterArray(context._charactersData, now)
  }

  let raw: any

  try {
    raw = JSON.parse(extractJsonPayload(response))
  } catch {
    raw = []
  }

  const items = Array.isArray(raw) ? raw : Array.isArray(raw?.characters) ? raw.characters : []
  return parseCharacterArray(items, now)
}

export function normalizeCharacterRole(role: any) {
  const normalized = typeof role === 'string' ? role.trim().toLowerCase() : ''
  if (normalized === 'protagonist' || normalized === 'antagonist' || normalized === 'supporting' || normalized === 'minor') {
    return normalized
  }
  return 'supporting'
}

export function parseCharacterArray(items: any[], now: string): Character[] {
  const nameToId = new Map<string, string>()
  const characters: Character[] = items.map((item: any, index: number) => {
    const id = generateId()
    const name = typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : `Character ${index + 1}`
    nameToId.set(name.toLowerCase(), id)

    return {
      id,
      name,
      role: normalizeCharacterRole(item?.role),
      personality: Array.isArray(item?.personality)
        ? item.personality.map((entry: any) => String(entry).trim()).filter(Boolean)
        : [],
      appearance: typeof item?.appearance === 'string' ? item.appearance.trim() : '',
      backstory: typeof item?.backstory === 'string' ? item.backstory.trim() : '',
      motivation: typeof item?.motivation === 'string' ? item.motivation.trim() : '',
      goals: typeof item?.goals === 'string' ? item.goals.trim() : '',
      conflicts: typeof item?.conflicts === 'string' ? item.conflicts.trim() : '',
      currentState: typeof item?.currentState === 'string' ? item.currentState.trim() : '',
      relations: [],
      createdAt: now,
      updatedAt: now,
    }
  })

  if (!characters.length) {
    characters.push({
      id: generateId(),
      name: 'Protagonist',
      role: 'protagonist',
      personality: ['determined', 'complex'],
      appearance: '',
      backstory: '',
      motivation: '',
      goals: '',
      conflicts: '',
      currentState: '',
      relations: [],
      createdAt: now,
      updatedAt: now,
    })
    return characters
  }

  items.slice(0, characters.length).forEach((item: any, index: number) => {
    if (!Array.isArray(item?.relations)) return
    const relationList = item.relations
      .map((relation: any) => {
        const targetName = typeof relation?.targetName === 'string' ? relation.targetName.trim().toLowerCase() : ''
        const targetId = targetName ? nameToId.get(targetName) : null
        if (!targetId) return null
        if (typeof relation?.relation !== 'string' || !relation.relation.trim()) return null
        if (typeof relation?.description !== 'string' || !relation.description.trim()) return null
        return {
          targetId,
          relation: relation.relation.trim(),
          description: relation.description.trim(),
        }
      })
      .filter(Boolean)

    characters[index].relations = relationList as Character['relations']
    characters[index].updatedAt = now
  })

  return characters
}

function validateCharacterRoleComposition(items: any[]): string[] {
  const issues: string[] = []
  let protagonistCount = 0
  let antagonistCount = 0

  for (const item of items) {
    const role = typeof item?.role === 'string' ? item.role.trim().toLowerCase() : ''
    if (role === 'protagonist') protagonistCount += 1
    if (role === 'antagonist') antagonistCount += 1
  }

  if (protagonistCount !== 1) {
    issues.push(`Character set must contain exactly one protagonist; found ${protagonistCount}.`)
  }

  if (antagonistCount < 1) {
    issues.push('Character set must contain at least one antagonist or opposing force.')
  }

  return issues
}

export function resolveCharacterIdByName(characters: Character[], name: string): string | null {
  const normalized = name.trim().toLowerCase()
  if (!normalized) return null

  const exact = characters.find(character => character.name.trim().toLowerCase() === normalized)
  if (exact) return exact.id

  const partial = characters.find(character => {
    const candidate = character.name.trim().toLowerCase()
    return candidate.includes(normalized) || normalized.includes(candidate)
  })

  return partial?.id ?? null
}

export function toRelationshipEvents(
  project: StoryProject,
  chapterIndex: number,
  extractedEvents: ExtractedRelationshipEvent[]
): CharacterRelationshipEvent[] {
  const chapter = project.chapters[chapterIndex]
  if (!chapter) return []

  const now = new Date().toISOString()
  const seen = new Set<string>()
  const events: CharacterRelationshipEvent[] = []

  for (const extracted of extractedEvents) {
    const fromId = resolveCharacterIdByName(project.characters, extracted.fromName)
    const toId = resolveCharacterIdByName(project.characters, extracted.toName)
    if (!fromId || !toId || fromId === toId) continue

    const key = `${fromId}->${toId}:${extracted.label ?? ''}:${extracted.evidence ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)

    events.push({
      id: generateId(),
      chapterId: chapter.id,
      chapterIndex: chapter.index,
      fromId,
      toId,
      type: extracted.type ?? 'other',
      summary: extracted.summary?.trim()
        || extracted.description?.trim()
        || extracted.label?.trim()
        || 'Relationship changed.',
      label: extracted.label?.trim() || undefined,
      description: extracted.description?.trim() || undefined,
      status: extracted.status ?? 'changed',
      trustDelta: extracted.trustDelta,
      affinityDelta: extracted.affinityDelta,
      tensionDelta: extracted.tensionDelta,
      evidence: extracted.evidence?.trim() || undefined,
      source: 'generated',
      createdAt: now,
      updatedAt: now,
    })
  }

  return events
}

export async function extractRelationshipEventsForChapter(
  project: StoryProject,
  chapterIndex: number,
  relationshipTrackerAgent: ReturnType<typeof getAgent>,
  onToken?: (token: string) => void
): Promise<CharacterRelationshipEvent[]> {
  const chapter = project.chapters[chapterIndex]
  if (!chapter?.content?.trim()) return []
  const chapterNumber = chapter.index + 1

  const segments = buildProofreadingSegments(chapter.content, 1600)
  const extracted: ExtractedRelationshipEvent[] = []
  for (const segment of segments) {
    const context: Record<string, any> = {
      chapterIndex,
      chapterNumber,
      chapterTitle: chapter.title,
      characters: buildCharacterContextForTask(project.characters, 'planning'),
      chapterContent: segment.content,
      project: buildProjectRelationshipContext(project),
      language: project.language,
      range: segment,
    }

    await relationshipTrackerAgent.execute(context, onToken)
    if (Array.isArray(context._relationshipEvents)) {
      extracted.push(...context._relationshipEvents as ExtractedRelationshipEvent[])
    }
  }

  return toRelationshipEvents(project, chapterIndex, extracted)
}

async function runLegacyStoryPlanningWorkflow(
  project: StoryProject,
  runtime: PlanningRuntime,
  onToken?: (token: string) => void,
  onProgress?: (message: string) => void
): Promise<{ outline: string; characters: Character[] }> {
  onProgress?.('Falling back to the combined story planner...')
  emitPlanningToken(onToken, 'Fallback to combined planner')

  const knowledgeBases = getLinkedKnowledgeBases(project)

  const context: Record<string, any> = {
    theme: project.theme,
    genre: project.genre,
    targetReader: project.targetReader,
    language: project.language,
    style: project.style,
    chapterCount: project.chapterCount,
    constraints: project.constraints,
    customRequirements: project.customRequirements,
    preferredCount: getPreferredCharacterCount(project),
    knowledgeBases,
  }

  const result = await runtime.storyPlannerAgent.execute(context, onToken)
  const outlineData = context._outlineData || {}
  const charactersData = context._charactersData || []

  let outline = typeof outlineData.outline === 'string' ? outlineData.outline : ''
  let characters: Character[] = []

  if (!outline && result.content) {
    try {
      const parsed = JSON.parse(extractJsonPayload(result.content))
      outline = typeof parsed.outline === 'string' ? parsed.outline : ''
      if (Array.isArray(parsed.characters)) {
        characters = parseCharacterArray(parsed.characters, new Date().toISOString())
      }
    } catch {
      outline = result.content
    }
  }

  if (charactersData.length > 0) {
    characters = parseCharacterArray(charactersData, new Date().toISOString())
  } else if (characters.length === 0) {
    characters = parseGeneratedCharacters(result.content)
  }

  return {
    outline,
    characters,
  }
}

async function runOutlineFirstStoryPlanningWorkflow(
  project: StoryProject,
  runtime: PlanningRuntime,
  onToken?: (token: string) => void,
  onProgress?: (message: string) => void,
  onIntermediateSave?: (updates: Partial<StoryProject>) => void | Promise<void>
): Promise<{ outline: string; characters: Character[] }> {
  const { outlineAgent, characterAgent, characterModel } = runtime
  const knowledgeBases = getLinkedKnowledgeBases(project)

  onProgress?.('Drafting story blueprint...')
  emitPlanningToken(onToken, 'Blueprint draft')

  const draftContext: Record<string, any> = {
    theme: project.theme,
    genre: project.genre,
    targetReader: project.targetReader,
    language: project.language,
    style: project.style,
    chapterCount: project.chapterCount,
    constraints: project.constraints,
    customRequirements: project.customRequirements,
    knowledgeBases,
    planningMode: 'draft',
    _onOutlineUpdated: async (outlineData: any) => {
      if (typeof outlineData?.outline === 'string' && outlineData.outline.trim()) {
        await onIntermediateSave?.({ outline: outlineData.outline })
      }
    },
  }

  const draftResult = await outlineAgent.execute(draftContext, onToken)
  const draft = draftContext._outlineData || parsePlanningDraft(draftResult.content)

  if (draft.outline) {
    await onIntermediateSave?.({ outline: draft.outline })
  }

  const needsCharacters = shouldCreateCharacters(project, draft)
  let characters = project.characters

  if (needsCharacters) {
    if (!characterModel) {
      throw new Error('At least one usable model is required for the character agent.')
    }

    onProgress?.('Creating characters from the blueprint...')
    emitPlanningToken(onToken, 'Character workflow')

    const charContext: Record<string, any> = {
      theme: project.theme,
      genre: project.genre,
      outline: draft.outline || draftResult.content,
      outlineTitle: draft.title,
      synopsis: draft.synopsis,
      targetReader: project.targetReader,
      language: project.language,
      existingCharacters: buildCharacterContextForTask(project.characters, 'planning'),
      characterSignals: draft.characterSignals,
      preferredCount: getPreferredCharacterCount(project),
      knowledgeBases,
      _onCharactersUpdated: async (rawCharacters: any[]) => {
        const partialCharacters = parseCharacterArray(rawCharacters, new Date().toISOString())
        if (partialCharacters.length > 0) {
          await onIntermediateSave?.({ characters: partialCharacters })
        }
      },
    }

    await characterAgent.execute(charContext, onToken)
    characters = parseGeneratedCharacters('', charContext)

    if (characters.length > 0) {
      await onIntermediateSave?.({ characters })
    }
  } else {
    onProgress?.('Reusing existing characters for blueprint refinement...')
  }

  onProgress?.('Refining story blueprint with the character set...')
  emitPlanningToken(onToken, 'Blueprint refinement')

  const refinedContext: Record<string, any> = {
    theme: project.theme,
    genre: project.genre,
    targetReader: project.targetReader,
    language: project.language,
    style: project.style,
    chapterCount: project.chapterCount,
    constraints: project.constraints,
    customRequirements: project.customRequirements,
    knowledgeBases,
    planningMode: 'refine',
    title: draft.title,
    synopsis: draft.synopsis,
    outline: draft.outline,
    characters: buildCharacterContextForTask(characters.length ? characters : project.characters, 'outlining'),
    characterSignals: draft.characterSignals,
    _onOutlineUpdated: async (outlineData: any) => {
      if (typeof outlineData?.outline === 'string' && outlineData.outline.trim()) {
        await onIntermediateSave?.({ outline: outlineData.outline })
      }
    },
  }

  const refinedResult = await outlineAgent.execute(refinedContext, onToken)
  const refinedOutline = refinedContext._outlineData?.outline || refinedResult.content.trim()

  onProgress?.('Quickly reviewing the blueprint for obvious issues...')
  const reviewContext: Record<string, any> = {
    ...refinedContext,
    planningMode: 'review',
    title: draft.title || refinedContext.title || 'Untitled',
    synopsis: draft.synopsis || refinedContext.synopsis || '',
    outline: refinedOutline,
    characters: buildCharacterContextForTask(characters.length ? characters : project.characters, 'outlining'),
  }
  delete reviewContext._outlineData
  const reviewResult = await outlineAgent.execute(reviewContext)
  const reviewedOutline = reviewContext._outlineData?.outline || reviewResult.content.trim() || refinedOutline

  if (reviewedOutline && reviewedOutline !== refinedOutline) {
    await onIntermediateSave?.({ outline: reviewedOutline })
  }

  return {
    outline: reviewedOutline || refinedOutline,
    characters,
  }
}

export async function runStoryPlanningWorkflow(
  project: StoryProject,
  onToken?: (token: string) => void,
  onProgress?: (message: string) => void,
  onError?: (error: string) => void,
  onIntermediateSave?: (updates: Partial<StoryProject>) => void | Promise<void>
): Promise<{ outline: string; characters: Character[] }> {
  const runtime = preparePlanningRuntime()

  try {
    return await runOutlineFirstStoryPlanningWorkflow(project, runtime, onToken, onProgress, onIntermediateSave)
  } catch (error: any) {
    const message = `Outline-first planning failed: ${error?.message || 'Unknown error'}`
    onError?.(message)
    onProgress?.(message)
    return runLegacyStoryPlanningWorkflow(project, runtime, onToken, onProgress)
  }
}

export async function generateOutline(project: StoryProject) {
  const { outlineAgent } = preparePlanningRuntime()
  const knowledgeBases = getLinkedKnowledgeBases(project)
  const outlineContext: Record<string, any> = {
    theme: project.theme,
    genre: project.genre,
    targetReader: project.targetReader,
    language: project.language,
    style: project.style,
    chapterCount: project.chapterCount,
    constraints: project.constraints,
    customRequirements: project.customRequirements,
    knowledgeBases,
  }
  const outlineResult = await outlineAgent.execute(outlineContext)
  const draft = outlineContext._outlineData || parsePlanningDraft(outlineResult.content)
  const candidateOutline = typeof draft.outline === 'string' ? draft.outline : outlineResult.content

  const reviewContext: Record<string, any> = {
    ...outlineContext,
    planningMode: 'review',
    title: draft.title || 'Untitled',
    synopsis: draft.synopsis || '',
    outline: candidateOutline,
    characters: buildCharacterContextForTask(project.characters, 'outlining'),
  }
  delete reviewContext._outlineData
  const reviewResult = await outlineAgent.execute(reviewContext)

  return reviewContext._outlineData?.outline || reviewResult.content.trim() || candidateOutline
}

export async function generateCharacters(
  project: StoryProject,
  options: { preferredCount?: number; characterRequirements?: string } = {}
) {
  const providerStore = prepareProviderRuntime()
  const characterAgent = getAgent('character')
  const characterModel = providerStore.getAgentModelBinding('character') ?? providerStore.getDefaultModelRefForRole('character')
  if (!characterModel) throw new Error('At least one usable model is required for the character agent.')
  characterAgent.setModel(characterModel, 4096, 0.7, getContextTokens(providerStore, characterModel))

  const knowledgeBases = getLinkedKnowledgeBases(project)

  const charContext: Record<string, any> = {
    theme: project.theme,
    genre: project.genre,
    outline: project.outline,
    targetReader: project.targetReader,
    language: project.language,
    existingCharacters: buildCharacterContextForTask(project.characters, 'planning'),
    preferredCount: Number.isFinite(Number(options.preferredCount))
      ? Math.max(1, Math.min(24, Math.trunc(Number(options.preferredCount))))
      : getPreferredCharacterCount(project),
    characterRequirements: typeof options.characterRequirements === 'string' ? options.characterRequirements.trim() : '',
    knowledgeBases,
  }

  await characterAgent.execute(charContext)
  return parseGeneratedCharacters('', charContext)
}

export async function generateStoryPlan(
  project: StoryProject,
  onToken?: (token: string) => void,
  onProgress?: (message: string) => void,
  onError?: (error: string) => void,
  onIntermediateSave?: (updates: Partial<StoryProject>) => void | Promise<void>
): Promise<{ outline: string; characters: Character[] }> {
  return runStoryPlanningWorkflow(project, onToken, onProgress, onError, onIntermediateSave)
}
