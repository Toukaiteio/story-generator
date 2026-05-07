import type { StoryProject } from '@/types/project'
import type { Chapter } from '@/types/chapter'
import type { Character } from '@/types/character'
import type { ProviderModelRef } from '@/types/provider'
import { getAgent } from '@/services/agent'
import { buildCharacterContext, buildPreviousSummary } from './context'
import { useProviderStore } from '@/stores/provider'
import { useKnowledgeStore } from '@/stores/knowledge'
import { providerManager } from '@/services/provider'
import { generateId } from '@/lib/id'
import { containsMetaCommentary, extractJsonObject, extractJsonPayload } from '@/services/agent/validation'
import { buildKnowledgeContextAsync, buildKnowledgeQuery } from '@/services/knowledge/context'
import { buildRelationshipContext } from '@/services/relationship/context'
import type { CharacterRelationshipEvent, ExtractedRelationshipEvent } from '@/types/relationship'
import { appendRelationshipEventsForChapter } from '@/services/relationship'

export interface PipelineCallbacks {
  onStageChange: (stage: string) => void
  onProgress: (message: string) => void
  onError: (error: string) => void
  onChapterStart: (index: number) => void
  onChapterComplete: (index: number) => void
  onToken?: (token: string) => void
  onIntermediateSave?: (project: StoryProject) => void
}

export interface PipelineRunOptions {
  stopAfterStage?: 'planning' | 'chapter-outline' | 'writing' | 'proofreading' | 'polishing'
}

interface PlanningDraft {
  title: string
  synopsis: string
  outline: string
  characterSignals: string
  needsCharacters: boolean | null
}

interface ChapterPlanEntry {
  chapterNumber: number
  title: string
  objective: string
  conflict: string
  keyEvents: string[]
  characterActions: string[]
  infoReveals: string[]
  endingHook: string
}

export class StoryPipeline {
  private cancelled = false

  cancel() {
    this.cancelled = true
  }

  private stripCodeFence(content: string) {
    return content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/i, '')
      .trim()
  }

  private getModelForStage(
    providerStore: ReturnType<typeof useProviderStore>,
    stage: 'planning' | 'chapter-outline' | 'writing' | 'proofreading' | 'polishing'
  ) {
    if (stage === 'planning') {
      return providerStore.getAgentModelBinding('outline') ?? providerStore.getDefaultModelRefForRole('outline')
    }

    if (stage === 'chapter-outline') {
      return providerStore.getAgentModelBinding('chapterPlanner') ?? providerStore.getDefaultModelRefForRole('chapterPlanner')
    }

    if (stage === 'writing') {
      return providerStore.getAgentModelBinding('writer') ?? providerStore.getDefaultModelRefForRole('writer')
    }

    if (stage === 'proofreading') {
      return providerStore.getAgentModelBinding('proofreader') ?? providerStore.getDefaultModelRefForRole('proofreader')
    }

    return providerStore.getAgentModelBinding('polisher') ?? providerStore.getDefaultModelRefForRole('polisher')
  }

  private getContextTokens(providerStore: ReturnType<typeof useProviderStore>, modelRef: { providerId: string; modelId: string }): number | null {
    const match = providerStore.getModelByRef(modelRef)
    return match?.model.contextTokens ?? null
  }

  private getLinkedKnowledgeBases(project: StoryProject) {
    const knowledgeStore = useKnowledgeStore()
    return knowledgeStore.knowledgeBases.filter(base => project.knowledgeBaseIds.includes(base.id))
  }

  private async buildKnowledgeContextForProject(
    project: StoryProject,
    queryInput: Parameters<typeof buildKnowledgeQuery>[0],
    maxTokens = 2400
  ) {
    const bases = this.getLinkedKnowledgeBases(project)
    if (!bases.length) return ''

    const query = buildKnowledgeQuery(queryInput)
    if (!query.trim()) return ''

    return buildKnowledgeContextAsync(bases, query, maxTokens)
  }

  private prepareProviderRuntime() {
    const providerStore = useProviderStore()
    providerManager.setProviders(providerStore.providers)
    providerStore.ensureAgentModelBindings()
    return providerStore
  }

  private preparePlanningRuntime() {
    const providerStore = this.prepareProviderRuntime()
    const planningModel = this.getModelForStage(providerStore, 'planning')
    if (!planningModel) {
      throw new Error('At least one usable model is required for story planning.')
    }

    const outlineAgent = getAgent('outline')
    const characterAgent = getAgent('character')
    const storyPlannerAgent = getAgent('storyPlanner')

    outlineAgent.setModel(planningModel, 1536, 0.6, this.getContextTokens(providerStore, planningModel))
    storyPlannerAgent.setModel(planningModel, 3072, 0.6, this.getContextTokens(providerStore, planningModel))

    const characterModel = providerStore.getAgentModelBinding('character') ?? providerStore.getDefaultModelRefForRole('character')
    characterAgent.setModel(
      characterModel ?? null,
      4096,
      0.7,
      characterModel ? this.getContextTokens(providerStore, characterModel) : null
    )

    return {
      providerStore,
      planningModel,
      characterModel,
      outlineAgent,
      characterAgent,
      storyPlannerAgent,
    }
  }

  private normalizePlanningSectionName(name: string) {
    return name
      .trim()
      .toLowerCase()
      .replace(/[:：]+/g, '')
      .replace(/\s+/g, ' ')
  }

  private extractPlanningSections(content: string) {
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
        currentKey = this.normalizePlanningSectionName(headingMatch[2])
        continue
      }

      buffer.push(line)
    }

    flush()
    return sections
  }

  private readPlanningBoolean(value: any): boolean | null {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (!normalized) return null
      if (['true', 'yes', 'y', '1', 'needed', 'need', 'required'].includes(normalized)) return true
      if (['false', 'no', 'n', '0', 'none', 'not needed', 'unneeded', 'skip'].includes(normalized)) return false
    }
    return null
  }

  private normalizePlanningText(value: any): string {
    if (typeof value === 'string') return this.stripCodeFence(value).trim()
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

  private parsePlanningDraft(response: string): PlanningDraft {
    const text = this.stripCodeFence(response).trim()
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
        const characterSignals = this.normalizePlanningText(raw.characterSignals ?? raw.characterNeeds ?? raw.charactersNeeded ?? raw.roleSignals)
        const needsCharacters = this.readPlanningBoolean(raw.needsCharacters ?? raw.needCharacters)
          ?? this.readPlanningBoolean(raw.characterSignals?.needsCharacters)
          ?? this.readPlanningBoolean(raw.characterNeeds?.needsCharacters)
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

    const sections = this.extractPlanningSections(text)
    const title = sections.title ?? ''
    const synopsis = sections.synopsis ?? ''
    const outline = sections.outline ?? sections['story outline'] ?? text
    const characterSignals = sections['character signals']
      ?? sections['character needs']
      ?? sections['characters needed']
      ?? sections.cast
      ?? sections['character brief']
      ?? sections['角色需求']
      ?? sections['角色信号']
      ?? sections['角色创建']
      ?? ''

    const loweredSignals = characterSignals.trim().toLowerCase()
    const needsCharacters = this.readPlanningBoolean(sections['needs characters'])
      ?? (loweredSignals
        ? !/^(none|n\/a|na|no characters?|无需|不需要|不必|没有|none needed|not needed)$/i.test(loweredSignals)
        : null)

    return {
      title,
      synopsis,
      outline,
      characterSignals,
      needsCharacters,
    }
  }

  private shouldCreateCharacters(project: StoryProject, draft: PlanningDraft): boolean {
    if (project.characters.length < this.getPreferredCharacterCount(project)) return true
    if (draft.needsCharacters !== null) return draft.needsCharacters

    const signals = draft.characterSignals.trim().toLowerCase()
    if (!signals) return false
    return !/^(none|n\/a|na|no characters?|无需|不需要|不必|没有|none needed|not needed)$/i.test(signals)
  }

  private getPreferredCharacterCount(project: StoryProject): number {
    const existingCount = project.characters.length
    const lengthBasedCount = project.length === 'short'
      ? 4
      : project.length === 'long'
        ? 6
        : 5

    return Math.max(lengthBasedCount, existingCount, 1)
  }

  private emitPlanningToken(onToken: ((token: string) => void) | undefined, label: string) {
    onToken?.(`\n\n[Planning] ${label}\n`)
  }

  private prepareRuntime() {
    const providerStore = this.prepareProviderRuntime()

    const planningModel = this.getModelForStage(providerStore, 'planning')
    const chapterPlannerModel = this.getModelForStage(providerStore, 'chapter-outline')
    const writerModel = this.getModelForStage(providerStore, 'writing')
    const proofreaderModel = this.getModelForStage(providerStore, 'proofreading')
    const polisherModel = this.getModelForStage(providerStore, 'polishing')

    if (!planningModel || !chapterPlannerModel || !writerModel || !proofreaderModel || !polisherModel) {
      throw new Error('At least one usable model is required for every Agent role.')
    }

    const storyPlannerAgent = getAgent('storyPlanner')
    const chapterTitlePlannerAgent = getAgent('chapterTitlePlanner')
    const chapterPlannerAgent = getAgent('chapterPlanner')
    const writerAgent = getAgent('writer')
    const proofreaderAgent = getAgent('proofreader')
    const polisherAgent = getAgent('polisher')
    const relationshipTrackerAgent = getAgent('relationshipTracker')

    storyPlannerAgent.setModel(planningModel, 3072, 0.6, this.getContextTokens(providerStore, planningModel))
    chapterTitlePlannerAgent.setModel(chapterPlannerModel, 2048, 0.7, this.getContextTokens(providerStore, chapterPlannerModel))
    chapterPlannerAgent.setModel(chapterPlannerModel, 3072, 0.6, this.getContextTokens(providerStore, chapterPlannerModel))
    writerAgent.setModel(writerModel, 4096, 0.8, this.getContextTokens(providerStore, writerModel))
    proofreaderAgent.setModel(proofreaderModel, 2048, 0.3, this.getContextTokens(providerStore, proofreaderModel))
    polisherAgent.setModel(polisherModel, 2048, 0.5, this.getContextTokens(providerStore, polisherModel))
    relationshipTrackerAgent.setModel(proofreaderModel, 2048, 0.2, this.getContextTokens(providerStore, proofreaderModel))

    return {
      providerStore,
      planningModel,
      chapterPlannerModel,
      writerModel,
      proofreaderModel,
      polisherModel,
      storyPlannerAgent,
      chapterTitlePlannerAgent,
      chapterPlannerAgent,
      writerAgent,
      proofreaderAgent,
      polisherAgent,
      relationshipTrackerAgent,
    }
  }

  private buildChapterPlanPrompt(project: StoryProject, chapterCount: number, knowledgeContext = '') {
    const charContext = buildCharacterContext(project.characters)
    return `Create a chapter-by-chapter plan for the story below. Return ONLY valid JSON as an array. Each item must include:
- title
- objective
- conflict
- keyEvents (array of strings)
- characterActions (array of strings)
- infoReveals (array of strings)
- endingHook

Story theme:
${project.theme}

Genre: ${project.genre}
Target reader: ${project.targetReader}
Primary language: ${project.language || 'English'}
${project.style ? `Writing Style Guide:\n${project.style}` : 'Writing Style: Infer an appropriate style from the genre, theme, and target reader.'}
Desired chapter count: ${chapterCount}

Story outline:
${project.outline}

Characters:
${charContext || 'No characters yet.'}

${knowledgeContext ? `Reference Material:\n${knowledgeContext}\n` : ''}
Constraints:
Required: ${project.constraints.required.join(', ') || 'None'}
Forbidden: ${project.constraints.forbidden.join(', ') || 'None'}

Additional requirements:
${project.customRequirements || 'None'}

Please write the chapter plan in ${project.language || 'English'}.
    Return exactly ${chapterCount} chapter items.`
  }

  private validateChapterPlanResponse(response: string, chapterCount: number): string[] {
    const issues: string[] = []
    const text = response.trim()

    if (!text) {
      issues.push('Chapter plan response is empty')
      return issues
    }

    if (containsMetaCommentary(text)) {
      issues.push('Chapter plan contains meta commentary or code fences')
    }

    let raw: any
    try {
      raw = JSON.parse(extractJsonObject(text))
    } catch {
      issues.push('Chapter plan must be valid JSON')
      return issues
    }

    const items = Array.isArray(raw) ? raw : Array.isArray(raw?.chapters) ? raw.chapters : null
    if (!items) {
      issues.push('Chapter plan must be a JSON array or contain a chapters array')
      return issues
    }

    if (items.length !== chapterCount) {
      issues.push(`Chapter plan must contain exactly ${chapterCount} items`)
    }

    items.slice(0, chapterCount).forEach((item: any, index: number) => {
      const label = `Chapter ${index + 1}`
      if (!item || typeof item !== 'object') {
        issues.push(`${label} entry must be an object`)
        return
      }

      if (typeof item.title !== 'string' || !item.title.trim()) {
        issues.push(`${label} is missing a title`)
      }
      if (typeof item.objective !== 'string' || !item.objective.trim()) {
        issues.push(`${label} is missing an objective`)
      }
      if (typeof item.conflict !== 'string' || !item.conflict.trim()) {
        issues.push(`${label} is missing a conflict`)
      }
      if (!Array.isArray(item.keyEvents) || item.keyEvents.some((entry: any) => typeof entry !== 'string' || !entry.trim())) {
        issues.push(`${label} must include a non-empty keyEvents array`)
      }
      if (!Array.isArray(item.characterActions) || item.characterActions.some((entry: any) => typeof entry !== 'string' || !entry.trim())) {
        issues.push(`${label} must include a non-empty characterActions array`)
      }
      if (!Array.isArray(item.infoReveals) || item.infoReveals.some((entry: any) => typeof entry !== 'string' || !entry.trim())) {
        issues.push(`${label} must include a non-empty infoReveals array`)
      }
      if (typeof item.endingHook !== 'string' || !item.endingHook.trim()) {
        issues.push(`${label} is missing an endingHook`)
      }
    })

    return issues
  }

  private formatChapterPlanContext(chapters: Chapter[]) {
    if (!chapters.length) return ''

    return chapters.map((chapter) => {
      const objective = chapter.outline.objective.trim()
      const conflict = chapter.outline.conflict.trim()
      const keyEvents = chapter.outline.keyEvents.join(' | ')
      const characterActions = chapter.outline.characterActions.join(' | ')
      const infoReveals = chapter.outline.infoReveals.join(' | ')
      const endingHook = chapter.outline.endingHook.trim()

      return [
        `Chapter ${chapter.index + 1}: ${chapter.title}`,
        objective ? `Objective: ${objective}` : '',
        conflict ? `Conflict: ${conflict}` : '',
        keyEvents ? `Key Events: ${keyEvents}` : '',
        characterActions ? `Character Actions: ${characterActions}` : '',
        infoReveals ? `Info Reveals: ${infoReveals}` : '',
        endingHook ? `Ending Hook: ${endingHook}` : '',
      ].filter(Boolean).join('\n')
    }).join('\n\n')
  }

  private buildChapterPlanEntryMap(entries: ChapterPlanEntry[]) {
    const map = new Map<number, ChapterPlanEntry>()
    for (const entry of entries) {
      if (!entry || !Number.isInteger(entry.chapterNumber)) continue
      map.set(entry.chapterNumber, entry)
    }
    return map
  }

  private buildChaptersFromPlanEntries(
    entries: ChapterPlanEntry[],
    chapterCount: number,
    previousChapters: Chapter[] = []
  ): Chapter[] {
    const now = new Date().toISOString()
    const entryMap = this.buildChapterPlanEntryMap(entries)

    return Array.from({ length: chapterCount }, (_, index) => {
      const prev = previousChapters[index]
      const entry = entryMap.get(index + 1)

      return {
        id: prev?.id || generateId(),
        index,
        title: entry?.title?.trim() || `Chapter ${index + 1}`,
        outline: {
          objective: entry?.objective?.trim() || '',
          conflict: entry?.conflict?.trim() || '',
          keyEvents: Array.isArray(entry?.keyEvents)
            ? entry.keyEvents.map(item => String(item).trim()).filter(Boolean)
            : [],
          characterActions: Array.isArray(entry?.characterActions)
            ? entry.characterActions.map(item => String(item).trim()).filter(Boolean)
            : [],
          infoReveals: Array.isArray(entry?.infoReveals)
            ? entry.infoReveals.map(item => String(item).trim()).filter(Boolean)
            : [],
          endingHook: entry?.endingHook?.trim() || '',
        },
        content: prev?.content || '',
        proofreadContent: prev?.proofreadContent || '',
        polishedContent: prev?.polishedContent || '',
        status: prev?.status || 'outline',
        summary: prev?.summary || '',
        characterStateUpdates: prev?.characterStateUpdates || {},
        createdAt: prev?.createdAt || now,
        updatedAt: now,
      }
    })
  }

  private buildChapterPlanRepairPrompt(
    project: StoryProject,
    chapterCount: number,
    knowledgeContext: string,
    previousResponse: string,
    issues: string[]
  ) {
    return `The previous chapter plan failed validation.

Issues:
${issues.map(issue => `- ${issue}`).join('\n')}

Original task:
${this.buildChapterPlanPrompt(project, chapterCount, knowledgeContext)}

Previous response:
${previousResponse}

Return only a corrected JSON array (or an object containing a chapters array) with exactly ${chapterCount} chapter items. Do not add commentary or code fences.`
  }

  private async requestValidatedChapterPlan(
    project: StoryProject,
    chapterCount: number,
    chapterOutlineModel: ProviderModelRef
  ) {
    const retryLimit = 2
    let previousResponse = ''
    let lastIssues: string[] = []
    const systemPrompt = 'You are an expert story planner. Return only valid JSON.'

    for (let attempt = 0; attempt <= retryLimit; attempt++) {
      const knowledgeContext = await this.buildKnowledgeContextForProject(project, {
        theme: project.theme,
        genre: project.genre,
        targetReader: project.targetReader,
        language: project.language,
        customRequirements: project.customRequirements,
        outline: project.outline,
      })

      const userPrompt = attempt === 0
        ? this.buildChapterPlanPrompt(project, chapterCount, knowledgeContext)
        : this.buildChapterPlanRepairPrompt(project, chapterCount, knowledgeContext, previousResponse, lastIssues)

      const chapterPlanText = await providerManager.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        chapterOutlineModel,
        4096,
        attempt === 0 ? 0.7 : 0.2
      )

      previousResponse = chapterPlanText
      const issues = this.validateChapterPlanResponse(chapterPlanText, chapterCount)

      if (!issues.length) {
        return chapterPlanText
      }

      lastIssues = issues
    }

    throw new Error(`Chapter plan failed validation: ${lastIssues.join('; ')}`)
  }

  private parseChapterPlans(response: string, chapterCount: number, previousChapters: Chapter[] = []): Chapter[] {
    const now = new Date().toISOString()
    const fallback = Array.from({ length: chapterCount }, (_, index) => ({
      title: `Chapter ${index + 1}`,
      outline: {
        objective: '',
        conflict: '',
        keyEvents: [],
        characterActions: [],
        infoReveals: [],
        endingHook: '',
      },
    }))

    try {
      const raw = JSON.parse(this.stripCodeFence(response))
      const items = Array.isArray(raw) ? raw : Array.isArray(raw?.chapters) ? raw.chapters : []

      return Array.from({ length: chapterCount }, (_, index) => {
        const item = items[index] || {}
        const prev = previousChapters[index]
        return {
          id: prev?.id || generateId(),
          index,
          title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : fallback[index].title,
          outline: {
            objective: typeof item.objective === 'string' ? item.objective.trim() : '',
            conflict: typeof item.conflict === 'string' ? item.conflict.trim() : '',
            keyEvents: Array.isArray(item.keyEvents) ? item.keyEvents.map((entry: any) => String(entry).trim()).filter(Boolean) : [],
            characterActions: Array.isArray(item.characterActions) ? item.characterActions.map((entry: any) => String(entry).trim()).filter(Boolean) : [],
            infoReveals: Array.isArray(item.infoReveals) ? item.infoReveals.map((entry: any) => String(entry).trim()).filter(Boolean) : [],
            endingHook: typeof item.endingHook === 'string' ? item.endingHook.trim() : '',
          },
          content: prev?.content || '',
          proofreadContent: prev?.proofreadContent || '',
          polishedContent: prev?.polishedContent || '',
          status: prev?.status || 'outline',
          summary: prev?.summary || '',
          characterStateUpdates: prev?.characterStateUpdates || {},
          createdAt: prev?.createdAt || now,
          updatedAt: now,
        }
      })
    } catch {
      return Array.from({ length: chapterCount }, (_, index) => {
        const prev = previousChapters[index]
        return {
          id: prev?.id || generateId(),
          index,
          title: fallback[index].title,
          outline: fallback[index].outline,
          content: prev?.content || '',
          proofreadContent: prev?.proofreadContent || '',
          polishedContent: prev?.polishedContent || '',
          status: prev?.status || 'outline',
          summary: prev?.summary || '',
          characterStateUpdates: prev?.characterStateUpdates || {},
          createdAt: prev?.createdAt || now,
          updatedAt: now,
        }
      })
    }
  }

  private normalizeCharacterRole(role: any) {
    const normalized = typeof role === 'string' ? role.trim().toLowerCase() : ''
    if (normalized === 'protagonist' || normalized === 'antagonist' || normalized === 'supporting' || normalized === 'minor') {
      return normalized
    }
    return 'supporting'
  }

  private parseGeneratedCharacters(response: string, context?: Record<string, any>): Character[] {
    const now = new Date().toISOString()
    
    // Check if characters were created via tools
    if (context?._charactersData && Array.isArray(context._charactersData)) {
      return this.parseCharacterArray(context._charactersData, now)
    }
    
    let raw: any

    try {
      raw = JSON.parse(extractJsonPayload(response))
    } catch {
      raw = []
    }

    const items = Array.isArray(raw) ? raw : Array.isArray(raw?.characters) ? raw.characters : []

    return this.parseCharacterArray(items, now)
  }

  private parseCharacterArray(items: any[], now: string): Character[] {
    const nameToId = new Map<string, string>()
    const characters: Character[] = items.slice(0, 6).map((item: any, index: number) => {
      const id = generateId()
      const name = typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : `Character ${index + 1}`
      nameToId.set(name.toLowerCase(), id)

      return {
        id,
        name,
        role: this.normalizeCharacterRole(item?.role),
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

  private resolveCharacterIdByName(characters: Character[], name: string): string | null {
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

  private toRelationshipEvents(
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
      const fromId = this.resolveCharacterIdByName(project.characters, extracted.fromName)
      const toId = this.resolveCharacterIdByName(project.characters, extracted.toName)
      if (!fromId || !toId || fromId === toId) continue

      const key = `${fromId}->${toId}:${extracted.label ?? ''}:${extracted.evidence ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)

      events.push({
        id: generateId(),
        chapterId: chapter.id,
        chapterIndex,
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

  private async extractRelationshipEventsForChapter(
    project: StoryProject,
    chapterIndex: number,
    relationshipTrackerAgent: ReturnType<typeof getAgent>,
    onToken?: (token: string) => void
  ): Promise<CharacterRelationshipEvent[]> {
    const chapter = project.chapters[chapterIndex]
    if (!chapter?.content?.trim()) return []

    const context: Record<string, any> = {
      chapterIndex,
      chapterTitle: chapter.title,
      characters: buildCharacterContext(project.characters),
      previousRelationships: buildRelationshipContext(project, chapterIndex - 1),
      chapterContent: chapter.content,
      project,
      language: project.language,
    }

    await relationshipTrackerAgent.execute(context, onToken)
    const extracted = Array.isArray(context._relationshipEvents)
      ? context._relationshipEvents as ExtractedRelationshipEvent[]
      : []

    return this.toRelationshipEvents(project, chapterIndex, extracted)
  }

  private async runLegacyStoryPlanningWorkflow(
    project: StoryProject,
    runtime: any,
    onToken?: (token: string) => void,
    onProgress?: (message: string) => void
  ): Promise<{ outline: string; characters: Character[] }> {
    onProgress?.('Falling back to the combined story planner...')
    this.emitPlanningToken(onToken, 'Fallback to combined planner')

    const knowledgeContext = await this.buildKnowledgeContextForProject(project, {
      theme: project.theme,
      genre: project.genre,
      targetReader: project.targetReader,
      language: project.language,
      style: project.style,
      customRequirements: project.customRequirements,
      outline: project.outline,
    })

    // Create context that will be populated by tool calls
    const context: Record<string, any> = {
      theme: project.theme,
      genre: project.genre,
      targetReader: project.targetReader,
      language: project.language,
      style: project.style,
      length: project.length,
      constraints: project.constraints,
      customRequirements: project.customRequirements,
      preferredCount: this.getPreferredCharacterCount(project),
      knowledgeContext,
    }
    
    // Execute once - tool calls will populate context._outlineData and context._charactersData
    const result = await runtime.storyPlannerAgent.execute(context, onToken)
    
    // Get data from tool call results or parse from response
    const outlineData = context._outlineData || {}
    const charactersData = context._charactersData || []

    // If no tool call results, try to parse from response content
    let outline = typeof outlineData.outline === 'string' ? outlineData.outline : ''
    let characters: Character[] = []

    if (!outline && result.content) {
      try {
        const parsed = JSON.parse(extractJsonPayload(result.content))
        outline = typeof parsed.outline === 'string' ? parsed.outline : ''
        if (Array.isArray(parsed.characters)) {
          characters = this.parseCharacterArray(parsed.characters, new Date().toISOString())
        }
      } catch {
        // Use raw content as outline if parsing fails
        outline = result.content
      }
    }

    if (charactersData.length > 0) {
      characters = this.parseCharacterArray(charactersData, new Date().toISOString())
    } else if (characters.length === 0) {
      characters = this.parseGeneratedCharacters(result.content)
    }

    return {
      outline,
      characters,
    }
  }

  private async runOutlineFirstStoryPlanningWorkflow(
    project: StoryProject,
    runtime: any,
    onToken?: (token: string) => void,
    onProgress?: (message: string) => void,
    onIntermediateSave?: (updates: Partial<StoryProject>) => void
  ): Promise<{ outline: string; characters: Character[] }> {
    const { outlineAgent, characterAgent, characterModel } = runtime
    const knowledgeContext = await this.buildKnowledgeContextForProject(project, {
      theme: project.theme,
      genre: project.genre,
      targetReader: project.targetReader,
      language: project.language,
      style: project.style,
      customRequirements: project.customRequirements,
      outline: project.outline,
    })

    onProgress?.('Drafting story blueprint...')
    this.emitPlanningToken(onToken, 'Blueprint draft')

    const draftContext: Record<string, any> = {
      theme: project.theme,
      genre: project.genre,
      targetReader: project.targetReader,
      language: project.language,
      style: project.style,
      length: project.length,
      constraints: project.constraints,
      customRequirements: project.customRequirements,
      knowledgeContext,
      planningMode: 'draft',
    }
    
    const draftResult = await outlineAgent.execute(draftContext, onToken)
    const draft = draftContext._outlineData || this.parsePlanningDraft(draftResult.content)
    
    // Save intermediate draft
    if (draft.outline) {
      onIntermediateSave?.({ outline: draft.outline })
    }

    const needsCharacters = this.shouldCreateCharacters(project, draft)
    let characters = project.characters

    if (needsCharacters) {
      if (!characterModel) {
        throw new Error('At least one usable model is required for the character agent.')
      }

      onProgress?.('Creating characters from the blueprint...')
      this.emitPlanningToken(onToken, 'Character workflow')

      const charContext: Record<string, any> = {
        theme: project.theme,
        genre: project.genre,
        outline: draft.outline || draftResult.content,
        outlineTitle: draft.title,
        synopsis: draft.synopsis,
        targetReader: project.targetReader,
        language: project.language,
        existingCharacters: buildCharacterContext(project.characters),
        characterSignals: draft.characterSignals,
        preferredCount: this.getPreferredCharacterCount(project),
        knowledgeContext,
      }
      
      await characterAgent.execute(charContext, onToken)
      characters = this.parseGeneratedCharacters('', charContext)
      
      // Save intermediate characters
      if (characters.length > 0) {
        onIntermediateSave?.({ characters })
      }
    } else {
      onProgress?.('Reusing existing characters for blueprint refinement...')
    }

    onProgress?.('Refining story blueprint with the character set...')
    this.emitPlanningToken(onToken, 'Blueprint refinement')

    const refinedContext: Record<string, any> = {
      theme: project.theme,
      genre: project.genre,
      targetReader: project.targetReader,
      language: project.language,
      style: project.style,
      length: project.length,
      constraints: project.constraints,
      customRequirements: project.customRequirements,
      knowledgeContext,
      planningMode: 'refine',
      title: draft.title,
      synopsis: draft.synopsis,
      outline: draft.outline,
      characters: buildCharacterContext(characters.length ? characters : project.characters),
      characterSignals: draft.characterSignals,
    }
    
    const refinedResult = await outlineAgent.execute(refinedContext, onToken)
    const refinedOutline = refinedContext._outlineData?.outline || refinedResult.content.trim()

    return {
      outline: refinedOutline,
      characters,
    }
  }

  private async runStoryPlanningWorkflow(
    project: StoryProject,
    onToken?: (token: string) => void,
    onProgress?: (message: string) => void,
    onError?: (error: string) => void,
    onIntermediateSave?: (updates: Partial<StoryProject>) => void
  ): Promise<{ outline: string; characters: Character[] }> {
    const runtime = this.preparePlanningRuntime()

    try {
      return await this.runOutlineFirstStoryPlanningWorkflow(project, runtime, onToken, onProgress, onIntermediateSave)
    } catch (error: any) {
      const message = `Outline-first planning failed: ${error?.message || 'Unknown error'}`
      onError?.(message)
      onProgress?.(message)
      return this.runLegacyStoryPlanningWorkflow(project, runtime, onToken, onProgress)
    }
  }

  async generateOutline(project: StoryProject) {
    const { outlineAgent } = this.preparePlanningRuntime()
    const knowledgeContext = await this.buildKnowledgeContextForProject(project, {
      theme: project.theme,
      genre: project.genre,
      targetReader: project.targetReader,
      language: project.language,
      style: project.style,
      customRequirements: project.customRequirements,
      outline: project.outline,
    })
    const outlineResult = await outlineAgent.execute({
      theme: project.theme,
      genre: project.genre,
      targetReader: project.targetReader,
      language: project.language,
      style: project.style,
      length: project.length,
      constraints: project.constraints,
      customRequirements: project.customRequirements,
      knowledgeContext,
    })
    return outlineResult.content
  }

  async generateCharacters(project: StoryProject) {
    const providerStore = this.prepareProviderRuntime()
    const characterAgent = getAgent('character')
    const characterModel = providerStore.getAgentModelBinding('character') ?? providerStore.getDefaultModelRefForRole('character')
    if (!characterModel) throw new Error('At least one usable model is required for the character agent.')
    characterAgent.setModel(characterModel, 4096, 0.7, this.getContextTokens(providerStore, characterModel))

    const knowledgeContext = await this.buildKnowledgeContextForProject(project, {
      theme: project.theme,
      genre: project.genre,
      targetReader: project.targetReader,
      language: project.language,
      outline: project.outline,
    })

    const charContext: Record<string, any> = {
      theme: project.theme,
      genre: project.genre,
      outline: project.outline,
      targetReader: project.targetReader,
      language: project.language,
      existingCharacters: buildCharacterContext(project.characters),
      preferredCount: this.getPreferredCharacterCount(project),
      knowledgeContext,
    }
    
    await characterAgent.execute(charContext)
    return this.parseGeneratedCharacters('', charContext)
  }

  async generateStoryPlan(
    project: StoryProject,
    onToken?: (token: string) => void,
    onProgress?: (message: string) => void,
    onError?: (error: string) => void,
    onIntermediateSave?: (updates: Partial<StoryProject>) => void
  ): Promise<{ outline: string; characters: Character[] }> {
    return this.runStoryPlanningWorkflow(project, onToken, onProgress, onError, onIntermediateSave)
  }

  private async runChapterPlanningWorkflow(
    project: StoryProject,
    onToken?: (token: string) => void,
    onProgress?: (message: string) => void,
    onError?: (error: string) => void,
    onIntermediateSave?: (updates: Partial<StoryProject>) => void
  ): Promise<Chapter[]> {
    const runtime = this.prepareRuntime()
    const { chapterTitlePlannerAgent, chapterPlannerAgent } = runtime

    onProgress?.('Estimating chapter count and planning titles...')
    this.emitPlanningToken(onToken, 'Chapter Title Planning')

    const knowledgeContext = await this.buildKnowledgeContextForProject(project, {
      theme: project.theme,
      genre: project.genre,
      targetReader: project.targetReader,
      language: project.language,
      style: project.style,
      customRequirements: project.customRequirements,
      outline: project.outline,
    })

    const titleContext: Record<string, any> = {
      theme: project.theme,
      genre: project.genre,
      targetReader: project.targetReader,
      language: project.language,
      length: project.length,
      storyOutline: project.outline,
      knowledgeContext,
    }

    let titlesData
    try {
      const titleResult = await chapterTitlePlannerAgent.execute(titleContext, onToken)
      titlesData = titleContext._chapterTitlesData || JSON.parse(extractJsonPayload(titleResult.content))
    } catch (e: any) {
      const msg = `Title planning failed: ${e.message}`
      onError?.(msg)
      throw new Error(msg)
    }

    const chapterCount = titlesData?.chapterCount || this.estimateChapterCount(project.length)
    const titles = titlesData?.chapters || []

    const plannedEntries: ChapterPlanEntry[] = []
    
    for (let i = 0; i < titles.length; i++) {
      if (this.cancelled) break

      const titleEntry = titles[i]
      onProgress?.(`Planning outline for Chapter ${titleEntry.chapterNumber}/${chapterCount}: ${titleEntry.title}...`)
      this.emitPlanningToken(onToken, `Chapter ${titleEntry.chapterNumber} Outline`)

      const outlineContext: Record<string, any> = {
        theme: project.theme,
        genre: project.genre,
        targetReader: project.targetReader,
        language: project.language,
        style: project.style,
        storyOutline: project.outline,
        characters: buildCharacterContext(project.characters),
        existingChapters: this.formatChapterPlanContext(
          this.buildChaptersFromPlanEntries(plannedEntries, plannedEntries.length, project.chapters)
        ),
        knowledgeContext,
        targetChapter: titleEntry,
        chapterCount,
      }

      try {
        const outlineResult = await chapterPlannerAgent.execute(outlineContext, onToken)
        const outlineData = outlineContext._chapterOutlineData || JSON.parse(extractJsonPayload(outlineResult.content))
        plannedEntries.push(outlineData)

        // Emit intermediate save
        const currentChapters = this.buildChaptersFromPlanEntries(plannedEntries, chapterCount, project.chapters)
        onIntermediateSave?.({ chapters: currentChapters })
      } catch (e: any) {
        const msg = `Outline planning failed for Chapter ${titleEntry.chapterNumber}: ${e.message}`
        onError?.(msg)
        throw new Error(msg)
      }
    }

    return this.buildChaptersFromPlanEntries(plannedEntries, chapterCount, project.chapters)
  }

  async generateChapterPlan(
    project: StoryProject,
    onToken?: (token: string) => void,
    onProgress?: (message: string) => void,
    onError?: (error: string) => void,
    onIntermediateSave?: (updates: Partial<StoryProject>) => void
  ): Promise<Chapter[]> {
    return this.runChapterPlanningWorkflow(project, onToken, onProgress, onError, onIntermediateSave)
  }

  async generateChapterDraft(project: StoryProject, chapterIndex: number, onToken?: (token: string) => void) {
    const { writerAgent } = this.prepareRuntime()
    const chapter = project.chapters[chapterIndex]
    if (!chapter) throw new Error(`Chapter ${chapterIndex + 1} not found`)

    const knowledgeContext = await this.buildKnowledgeContextForProject(project, {
      theme: project.theme,
      genre: project.genre,
      targetReader: project.targetReader,
      language: project.language,
      chapterTitle: chapter.title,
      chapterOutline: JSON.stringify(chapter.outline),
      previousSummary: buildPreviousSummary(project, chapterIndex),
    })
    const relationshipContext = buildRelationshipContext(project, chapterIndex - 1)

    const writerContext: Record<string, any> = {
      chapterOutline: chapter.outline,
      chapterTitle: chapter.title,
      chapterIndex,
      characters: buildCharacterContext(project.characters),
      relationships: relationshipContext,
      previousSummary: buildPreviousSummary(project, chapterIndex),
      language: project.language,
      style: project.style,
      knowledgeContext,
    }

    const writerResult = await writerAgent.execute(writerContext, onToken)
    const chapterContent = typeof writerContext._chapterContent === 'string' && writerContext._chapterContent.trim()
      ? writerContext._chapterContent.trim()
      : writerResult.content
    const chapterSummary = typeof writerContext._chapterSummary === 'string' && writerContext._chapterSummary.trim()
      ? writerContext._chapterSummary.trim()
      : `${chapterContent.substring(0, 200)}...`

    return {
      ...chapter,
      content: chapterContent,
      summary: chapterSummary,
      status: 'draft' as const,
    }
  }

  async proofreadChapter(project: StoryProject, chapterIndex: number, onToken?: (token: string) => void) {
    const { proofreaderAgent } = this.prepareRuntime()
    const chapter = project.chapters[chapterIndex]
    if (!chapter) throw new Error(`Chapter ${chapterIndex + 1} not found`)

    const knowledgeContext = await this.buildKnowledgeContextForProject(project, {
      theme: project.theme,
      genre: project.genre,
      targetReader: project.targetReader,
      language: project.language,
      chapterTitle: chapter.title,
      chapterOutline: JSON.stringify(chapter.outline),
      content: chapter.content,
      previousSummary: buildPreviousSummary(project, chapterIndex),
    })

    const result = await proofreaderAgent.execute({
      content: chapter.content,
      chapterTitle: chapter.title,
      chapterOutline: chapter.outline,
      characters: buildCharacterContext(project.characters),
      previousSummary: buildPreviousSummary(project, chapterIndex),
      language: project.language,
      project,
      knowledgeContext,
    }, onToken)

    return {
      ...chapter,
      proofreadContent: result.content,
      status: 'proofread' as const,
    }
  }

  async polishChapter(project: StoryProject, chapterIndex: number, onToken?: (token: string) => void) {
    const { polisherAgent } = this.prepareRuntime()
    const chapter = project.chapters[chapterIndex]
    if (!chapter) throw new Error(`Chapter ${chapterIndex + 1} not found`)

    const contentToPolish = chapter.proofreadContent || chapter.content
    const knowledgeContext = await this.buildKnowledgeContextForProject(project, {
      theme: project.theme,
      genre: project.genre,
      targetReader: project.targetReader,
      language: project.language,
      chapterTitle: chapter.title,
      content: contentToPolish,
    })
    const result = await polisherAgent.execute({
      content: contentToPolish,
      chapterTitle: chapter.title,
      language: project.language,
      style: project.style,
      project,
      knowledgeContext,
    }, onToken)

    return {
      ...chapter,
      polishedContent: result.content,
      status: 'polished' as const,
    }
  }

  async run(
    project: StoryProject,
    callbacks: PipelineCallbacks,
    options: PipelineRunOptions = {}
  ): Promise<StoryProject> {
    this.cancelled = false
    const runtime = this.prepareRuntime()
    const {
      chapterPlannerAgent,
      writerAgent,
      proofreaderAgent,
      polisherAgent,
      relationshipTrackerAgent,
    } = runtime

    let updatedProject = { ...project }
    const stopAfter = options.stopAfterStage
    const save = () => callbacks.onIntermediateSave?.(updatedProject)

    // Stage 1: Story Planning (outline -> characters -> outline refine)
    if (this.cancelled) return updatedProject
    callbacks.onStageChange('planning')
    callbacks.onProgress('Planning story outline and characters...')

    try {
      const planResult = await this.runStoryPlanningWorkflow(project, callbacks.onToken, callbacks.onProgress, callbacks.onError)
      updatedProject.outline = planResult.outline
      updatedProject.characters = planResult.characters
      updatedProject.generationStage = 'chapter-outline'
      save()
    } catch (e: any) {
      callbacks.onError(`Story planning failed: ${e.message}`)
      return updatedProject
    }

    if (stopAfter === 'planning') {
      return updatedProject
    }

    // Stage 2: Chapter outlines
    if (this.cancelled) return updatedProject
    callbacks.onStageChange('chapter-outline')
    callbacks.onProgress('Planning chapter outlines...')

    try {
      const plannedChapters = await this.runChapterPlanningWorkflow(
        updatedProject,
        callbacks.onToken,
        callbacks.onProgress,
        callbacks.onError,
        (updates) => {
          Object.assign(updatedProject, updates)
          save()
        }
      )
      
      updatedProject.chapters = plannedChapters
      updatedProject.generationStage = 'writing'
      save()
    } catch (e: any) {
      callbacks.onError(`Chapter outline planning failed: ${e.message}`)
      return updatedProject
    }

    if (stopAfter === 'chapter-outline') {
      return updatedProject
    }

    // Stage 4: Writing
    if (this.cancelled) return updatedProject
    callbacks.onStageChange('writing')
    callbacks.onProgress('Writing chapter drafts...')

    for (let i = 0; i < updatedProject.chapters.length; i++) {
      if (this.cancelled) break
      callbacks.onChapterStart(i)
      callbacks.onProgress(`Writing chapter ${i + 1} of ${updatedProject.chapters.length}...`)

      try {
        const charContext = buildCharacterContext(updatedProject.characters)
        const knowledgeContext = await this.buildKnowledgeContextForProject(updatedProject, {
          theme: updatedProject.theme,
          genre: updatedProject.genre,
          targetReader: updatedProject.targetReader,
          language: updatedProject.language,
          chapterTitle: updatedProject.chapters[i].title,
          chapterOutline: JSON.stringify(updatedProject.chapters[i].outline),
          previousSummary: buildPreviousSummary(updatedProject, i),
        })
        const relationshipContext = buildRelationshipContext(updatedProject, i - 1)
        const writerContext: Record<string, any> = {
          chapterOutline: updatedProject.chapters[i].outline,
          chapterTitle: updatedProject.chapters[i].title,
          chapterIndex: i,
          characters: charContext,
          relationships: relationshipContext,
          previousSummary: buildPreviousSummary(updatedProject, i),
          language: project.language,
          style: project.style,
          knowledgeContext,
        }

        const writerResult = await writerAgent.execute(writerContext, callbacks.onToken)
        const chapterContent = typeof writerContext._chapterContent === 'string' && writerContext._chapterContent.trim()
          ? writerContext._chapterContent.trim()
          : writerResult.content
        const chapterSummary = typeof writerContext._chapterSummary === 'string' && writerContext._chapterSummary.trim()
          ? writerContext._chapterSummary.trim()
          : `${chapterContent.substring(0, 200)}...`

        updatedProject.chapters[i].content = chapterContent
        updatedProject.chapters[i].summary = chapterSummary
        updatedProject.chapters[i].status = 'draft'

        const relationshipEvents = await this.extractRelationshipEventsForChapter(
          updatedProject,
          i,
          relationshipTrackerAgent,
          callbacks.onToken
        )
        updatedProject.relationshipEvents = appendRelationshipEventsForChapter(
          updatedProject,
          updatedProject.chapters[i].id,
          relationshipEvents
        )

        callbacks.onChapterComplete(i)
        save()
      } catch (e: any) {
        callbacks.onError(`Chapter ${i + 1} writing failed: ${e.message}`)
      }
    }

    updatedProject.generationStage = 'proofreading'
    save()

    if (stopAfter === 'writing') {
      return updatedProject
    }

    // Stage 5: Proofreading
    if (this.cancelled) return updatedProject
    callbacks.onStageChange('proofreading')
    callbacks.onProgress('Proofreading chapter drafts...')

    for (let i = 0; i < updatedProject.chapters.length; i++) {
      if (this.cancelled) break
      callbacks.onProgress(`Proofreading chapter ${i + 1}...`)

      try {
        const charContext = buildCharacterContext(updatedProject.characters)
        const knowledgeContext = await this.buildKnowledgeContextForProject(updatedProject, {
          theme: updatedProject.theme,
          genre: updatedProject.genre,
          targetReader: updatedProject.targetReader,
          language: updatedProject.language,
          chapterTitle: updatedProject.chapters[i].title,
          chapterOutline: JSON.stringify(updatedProject.chapters[i].outline),
          content: updatedProject.chapters[i].content,
          previousSummary: buildPreviousSummary(updatedProject, i),
        })
        const proofreadContext: Record<string, any> = {
          content: updatedProject.chapters[i].content,
          chapterTitle: updatedProject.chapters[i].title,
          chapterOutline: updatedProject.chapters[i].outline,
          characters: charContext,
          previousSummary: buildPreviousSummary(updatedProject, i),
          language: project.language,
          project: updatedProject,
          knowledgeContext,
        }

        const result = await proofreaderAgent.execute(proofreadContext, callbacks.onToken)

        updatedProject.chapters[i].proofreadContent = typeof proofreadContext._proofreadContent === 'string' && proofreadContext._proofreadContent.trim()
          ? proofreadContext._proofreadContent.trim()
          : result.content
        updatedProject.chapters[i].status = 'proofread'
        save()
      } catch (e: any) {
        callbacks.onError(`Proofreading chapter ${i + 1} failed: ${e.message}`)
      }
    }

    updatedProject.generationStage = 'polishing'
    save()

    if (stopAfter === 'proofreading') {
      return updatedProject
    }

    // Stage 6: Polishing
    if (this.cancelled) return updatedProject
    callbacks.onStageChange('polishing')
    callbacks.onProgress('Polishing chapter drafts...')

    for (let i = 0; i < updatedProject.chapters.length; i++) {
      if (this.cancelled) break
      callbacks.onProgress(`Polishing chapter ${i + 1}...`)

      try {
        const contentToPolish = updatedProject.chapters[i].proofreadContent || updatedProject.chapters[i].content
        const knowledgeContext = await this.buildKnowledgeContextForProject(updatedProject, {
          theme: updatedProject.theme,
          genre: updatedProject.genre,
          targetReader: updatedProject.targetReader,
          language: updatedProject.language,
          chapterTitle: updatedProject.chapters[i].title,
          content: contentToPolish,
        })
        const polishContext: Record<string, any> = {
          content: contentToPolish,
          chapterTitle: updatedProject.chapters[i].title,
          language: project.language,
          style: project.style,
          project: updatedProject,
          knowledgeContext,
        }

        const result = await polisherAgent.execute(polishContext, callbacks.onToken)

        updatedProject.chapters[i].polishedContent = typeof polishContext._polishedContent === 'string' && polishContext._polishedContent.trim()
          ? polishContext._polishedContent.trim()
          : result.content
        updatedProject.chapters[i].status = 'polished'
        save()
      } catch (e: any) {
        callbacks.onError(`Polishing chapter ${i + 1} failed: ${e.message}`)
      }
    }

    updatedProject.status = 'completed'
    updatedProject.generationStage = 'done'
    save()
    callbacks.onStageChange('done')
    callbacks.onProgress('Generation complete!')

    return updatedProject
  }

  private estimateChapterCount(length: string): number {
    switch (length) {
      case 'short': return 4
      case 'medium': return 8
      case 'long': return 15
      default: return 8
    }
  }

}
