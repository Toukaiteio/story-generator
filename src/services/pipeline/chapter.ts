import type { StoryProject } from '@/types/project'
import type { Chapter } from '@/types/chapter'
import { extractJsonPayload } from '@/services/agent/validation'
import { buildCharacterContextForTask, buildPreviousSummary, buildProjectRelationshipContext } from './context'
import { appendRelationshipEventsForChapter } from '@/services/relationship'
import { buildKnowledgeContextForProject, resolveChapterCount, prepareRuntime } from './runtime'
import type { ChapterPlanEntry, PipelineCallbacks, PipelineRunOptions } from './types'
import { generateId } from '@/lib/id'
import { extractRelationshipEventsForChapter, runStoryPlanningWorkflow } from './planning'
import { sanitizeGeneratedChapterContent } from '@/services/writingFormat'
import { buildProofreadingSegments } from '@/services/proofreading/chunking'
import { useProviderStore } from '@/stores/provider'
import { isChapterPlanComplete } from '@/services/generation/flow'

const ISSUE_SEVERITY_RANK: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
}

function issueMeetsSeverityThreshold(issue: any, threshold: string) {
  return (ISSUE_SEVERITY_RANK[issue?.severity] ?? 0) >= (ISSUE_SEVERITY_RANK[threshold] ?? 0)
}

export function formatChapterPlanContext(chapters: Chapter[]) {
  if (!chapters.length) return ''

  return [...chapters].sort((a, b) => a.index - b.index).map((chapter) => {
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

function hasStoryPlan(project: StoryProject) {
  return !!project.outline.trim() && project.characters.length > 0
}

function hasChapterPlan(project: StoryProject) {
  return project.chapters.length > 0 && project.chapters.every(isChapterPlanComplete)
}

function hasAllDrafts(project: StoryProject) {
  return project.chapters.length > 0 && project.chapters.every(chapter => chapter.content.trim())
}

function hasAllProofread(project: StoryProject) {
  return project.chapters.length > 0 && project.chapters.every(chapter =>
    ['proofread', 'polishing', 'polished'].includes(chapter.status)
  )
}

function hasAllPolished(project: StoryProject) {
  return project.chapters.length > 0 && project.chapters.every(chapter =>
    chapter.content.trim() && chapter.status === 'polished'
  )
}

function chapterPositionsInStoryOrder(chapters: Chapter[]) {
  return chapters
    .map((chapter, index) => ({ chapter, index }))
    .sort((a, b) => a.chapter.index - b.chapter.index)
    .map(item => item.index)
}

function buildChapterPlanEntryMap(entries: ChapterPlanEntry[]) {
  const map = new Map<number, ChapterPlanEntry>()
  for (const entry of entries) {
    if (!entry || !Number.isInteger(entry.chapterNumber)) continue
    map.set(entry.chapterNumber, entry)
  }
  return map
}

function formatChapterPlanEntryContext(entries: ChapterPlanEntry[], limit = 12) {
  if (!entries.length) return ''
  const recent = entries.slice(-limit)
  const omitted = entries.length - recent.length
  return [
    omitted > 0 ? `[${omitted} earlier planned chapters omitted from this local context. Use the overall story outline for global continuity.]` : '',
    ...recent.map(entry => [
      `Chapter ${entry.chapterNumber}: ${entry.title}`,
      entry.objective ? `Objective: ${entry.objective}` : '',
      entry.conflict ? `Conflict: ${entry.conflict}` : '',
      entry.keyEvents?.length ? `Key Events: ${entry.keyEvents.join(' | ')}` : '',
      entry.characterActions?.length ? `Character Actions: ${entry.characterActions.join(' | ')}` : '',
      entry.infoReveals?.length ? `Info Reveals: ${entry.infoReveals.join(' | ')}` : '',
      entry.endingHook ? `Ending Hook: ${entry.endingHook}` : '',
    ].filter(Boolean).join('\n')),
  ].filter(Boolean).join('\n\n')
}

function applyPlanEntryToChapter(chapter: Chapter, entry: ChapterPlanEntry): Chapter {
  return {
    ...chapter,
    title: entry.title?.trim() || chapter.title,
    outline: {
      objective: entry.objective?.trim() || chapter.outline.objective,
      conflict: entry.conflict?.trim() || chapter.outline.conflict,
      keyEvents: Array.isArray(entry.keyEvents) ? entry.keyEvents.map(item => String(item).trim()).filter(Boolean) : chapter.outline.keyEvents,
      characterActions: Array.isArray(entry.characterActions) ? entry.characterActions.map(item => String(item).trim()).filter(Boolean) : chapter.outline.characterActions,
      infoReveals: Array.isArray(entry.infoReveals) ? entry.infoReveals.map(item => String(item).trim()).filter(Boolean) : chapter.outline.infoReveals,
      endingHook: entry.endingHook?.trim() || chapter.outline.endingHook,
    },
    updatedAt: new Date().toISOString(),
  }
}

export function buildChaptersFromPlanEntries(
  entries: ChapterPlanEntry[],
  chapterCount: number,
  previousChapters: Chapter[] = []
): Chapter[] {
  const now = new Date().toISOString()
  const entryMap = buildChapterPlanEntryMap(entries)
  const previousByIndex = new Map(previousChapters.map(chapter => [chapter.index, chapter]))

  return Array.from({ length: chapterCount }, (_, index) => {
    const prev = previousByIndex.get(index)
    const entry = entryMap.get(index + 1)
    const preserveChapterState = Boolean(prev && entry && prev.index + 1 === entry.chapterNumber)

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
      content: preserveChapterState ? (prev?.content || '') : '',
      proofreadingIssues: preserveChapterState ? (prev?.proofreadingIssues || []) : [],
      proofreadingIssuesStale: preserveChapterState ? Boolean(prev?.proofreadingIssuesStale) : false,
      contentVersions: preserveChapterState ? (prev?.contentVersions || []) : [],
      polishedContent: '',
      status: preserveChapterState ? (prev?.status || 'outline') : 'outline',
      summary: preserveChapterState ? (prev?.summary || '') : '',
      characterStateUpdates: preserveChapterState ? (prev?.characterStateUpdates || {}) : {},
      createdAt: prev?.createdAt || now,
      updatedAt: now,
    }
  })
}

export async function runChapterPlanningWorkflow(
  project: StoryProject,
  onToken?: (token: string) => void,
  onProgress?: (message: string) => void,
  onError?: (error: string) => void,
  onIntermediateSave?: (updates: Partial<StoryProject>) => void | Promise<void>,
  isCancelled: () => boolean = () => false
): Promise<Chapter[]> {
  const runtime = prepareRuntime()
  const { chapterTitlePlannerAgent, chapterPlannerAgent } = runtime

  onProgress?.('Estimating chapter count and planning titles...')
  onToken?.('\n\n[Planning] Chapter Title Planning\n')
  const chapterCount = resolveChapterCount(project.chapterCount)
  const titleBatchSize = 50

  const knowledgeContext = await buildKnowledgeContextForProject(project, {
    theme: project.theme,
    genre: project.genre,
    targetReader: project.targetReader,
    language: project.language,
    style: project.style,
    customRequirements: project.customRequirements,
    outline: project.outline,
  })

  const titleEntries: ChapterPlanEntry[] = []
  try {
    for (let start = 1; start <= chapterCount; start += titleBatchSize) {
      if (isCancelled()) break
      const end = Math.min(chapterCount, start + titleBatchSize - 1)
      onProgress?.(`Planning chapter titles ${start}-${end} of ${chapterCount}...`)
      const titleContext: Record<string, any> = {
        theme: project.theme,
        genre: project.genre,
        targetReader: project.targetReader,
        language: project.language,
        chapterCount,
        batchChapterCount: end - start + 1,
        startChapterNumber: start,
        endChapterNumber: end,
        storyOutline: project.outline,
        knowledgeContext,
      }
      const titleResult = await chapterTitlePlannerAgent.execute(titleContext, onToken)
      const titlesData = titleContext._chapterTitlesData || JSON.parse(extractJsonPayload(titleResult.content))
      if (Array.isArray(titlesData?.chapters)) {
        titleEntries.push(...titlesData.chapters)
      }
    }
  } catch (e: any) {
    const msg = `Title planning failed: ${e.message}`
    onError?.(msg)
    throw new Error(msg)
  }

  const titles = Array.from({ length: chapterCount }, (_, index) => {
    const entry = titleEntries[index] ?? null
    return {
      chapterNumber: index + 1,
      title: typeof entry?.title === 'string' && entry.title.trim()
        ? entry.title.trim()
        : `Chapter ${index + 1}`,
      objective: typeof entry?.objective === 'string' && entry.objective.trim()
        ? entry.objective.trim()
        : `Advance the story through chapter ${index + 1}.`,
      conflict: typeof entry?.conflict === 'string' ? entry.conflict : '',
      keyEvents: Array.isArray(entry?.keyEvents) ? entry.keyEvents : [],
      characterActions: Array.isArray(entry?.characterActions) ? entry.characterActions : [],
      infoReveals: Array.isArray(entry?.infoReveals) ? entry.infoReveals : [],
      endingHook: typeof entry?.endingHook === 'string' ? entry.endingHook : '',
    }
  })

  const plannedEntries: ChapterPlanEntry[] = []
  const currentChapters = buildChaptersFromPlanEntries(titles, chapterCount, project.chapters)
  await onIntermediateSave?.({ chapters: currentChapters })

  for (let i = 0; i < titles.length; i++) {
    if (isCancelled()) break

    const titleEntry = titles[i]
    onProgress?.(`Planning outline for Chapter ${titleEntry.chapterNumber}/${chapterCount}: ${titleEntry.title}...`)
    onToken?.(`\n\n[Planning] Chapter ${titleEntry.chapterNumber} Outline\n`)

    const outlineContext: Record<string, any> = {
      theme: project.theme,
      genre: project.genre,
      targetReader: project.targetReader,
      language: project.language,
      style: project.style,
      storyOutline: project.outline,
      characters: buildCharacterContextForTask(project.characters, 'outlining'),
      existingChapters: formatChapterPlanEntryContext(plannedEntries),
      knowledgeContext,
      targetChapter: titleEntry,
      chapterCount,
      _onChapterOutlineUpdated: async (outlineData: ChapterPlanEntry) => {
        const chapterIndex = Math.max(0, Math.min(currentChapters.length - 1, outlineData.chapterNumber - 1))
        currentChapters[chapterIndex] = applyPlanEntryToChapter(currentChapters[chapterIndex], outlineData)
        await onIntermediateSave?.({ chapters: currentChapters })
      },
    }

    try {
      const outlineResult = await chapterPlannerAgent.execute(outlineContext, onToken)
      const outlineData = outlineContext._chapterOutlineData || JSON.parse(extractJsonPayload(outlineResult.content))
      plannedEntries.push(outlineData)
      const chapterIndex = Math.max(0, Math.min(currentChapters.length - 1, outlineData.chapterNumber - 1))
      currentChapters[chapterIndex] = applyPlanEntryToChapter(currentChapters[chapterIndex], outlineData)
      await onIntermediateSave?.({ chapters: currentChapters })
    } catch (e: any) {
      const msg = `Outline planning failed for Chapter ${titleEntry.chapterNumber}: ${e.message}`
      onError?.(msg)
      throw new Error(msg)
    }
  }

  return currentChapters
}

export async function generateChapterPlan(
  project: StoryProject,
  onToken?: (token: string) => void,
  onProgress?: (message: string) => void,
  onError?: (error: string) => void,
  onIntermediateSave?: (updates: Partial<StoryProject>) => void | Promise<void>,
  isCancelled: () => boolean = () => false
): Promise<Chapter[]> {
  return runChapterPlanningWorkflow(project, onToken, onProgress, onError, onIntermediateSave, isCancelled)
}

export async function generateAdditionalChapterPlan(
  project: StoryProject,
  onToken?: (token: string) => void,
  onProgress?: (message: string) => void,
  onError?: (error: string) => void,
  onIntermediateSave?: (updates: Partial<StoryProject>) => void | Promise<void>
): Promise<Chapter[]> {
  const runtime = prepareRuntime()
  const { chapterTitlePlannerAgent, chapterPlannerAgent } = runtime
  const nextChapterNumber = project.chapters.length + 1
  const chapterCount = Math.max(project.chapterConfig?.maxChapters ?? project.chapterCount ?? nextChapterNumber, nextChapterNumber)

  onProgress?.(`Planning title for Chapter ${nextChapterNumber}...`)
  onToken?.(`\n\n[Planning] Chapter ${nextChapterNumber} Title\n`)

  const knowledgeContext = await buildKnowledgeContextForProject(project, {
    theme: project.theme,
    genre: project.genre,
    targetReader: project.targetReader,
    language: project.language,
    style: project.style,
    customRequirements: project.customRequirements,
    outline: project.outline,
  })

  let titleEntry: ChapterPlanEntry
  try {
    const titleContext: Record<string, any> = {
      mode: 'nextChapter',
      theme: project.theme,
      genre: project.genre,
      targetReader: project.targetReader,
      language: project.language,
      chapterCount,
      maxChapters: project.chapterConfig?.maxChapters ?? chapterCount,
      nextChapterNumber,
      storyOutline: project.outline,
      existingChapters: formatChapterPlanContext(project.chapters),
      knowledgeContext,
    }
    const titleResult = await chapterTitlePlannerAgent.execute(titleContext, onToken)
    titleEntry = titleContext._nextChapterTitleData || JSON.parse(extractJsonPayload(titleResult.content))
  } catch (e: any) {
    const msg = `Next chapter title planning failed: ${e.message}`
    onError?.(msg)
    throw new Error(msg)
  }

  const currentChapters = [...project.chapters]
  const now = new Date().toISOString()
  const draftChapter: Chapter = {
    id: generateId(),
    index: nextChapterNumber - 1,
    title: titleEntry.title?.trim() || `Chapter ${nextChapterNumber}`,
    outline: {
      objective: titleEntry.objective?.trim() || `Advance the story through chapter ${nextChapterNumber}.`,
      conflict: '',
      keyEvents: [],
      characterActions: [],
      infoReveals: [],
      endingHook: '',
    },
    content: '',
    proofreadingIssues: [],
    proofreadingIssuesStale: false,
    contentVersions: [],
    polishedContent: '',
    status: 'outline',
    summary: '',
    characterStateUpdates: {},
    createdAt: now,
    updatedAt: now,
  }
  currentChapters.push(draftChapter)
  await onIntermediateSave?.({ chapters: currentChapters })

  onProgress?.(`Planning outline for Chapter ${nextChapterNumber}: ${draftChapter.title}...`)
  onToken?.(`\n\n[Planning] Chapter ${nextChapterNumber} Outline\n`)

  const outlineContext: Record<string, any> = {
    theme: project.theme,
    genre: project.genre,
    targetReader: project.targetReader,
    language: project.language,
    style: project.style,
    storyOutline: project.outline,
    characters: buildCharacterContextForTask(project.characters, 'outlining'),
    existingChapters: formatChapterPlanContext(project.chapters),
    knowledgeContext,
    targetChapter: titleEntry,
    chapterCount,
    _onChapterOutlineUpdated: async (outlineData: ChapterPlanEntry) => {
      currentChapters[currentChapters.length - 1] = applyPlanEntryToChapter(currentChapters[currentChapters.length - 1], outlineData)
      await onIntermediateSave?.({ chapters: currentChapters })
    },
  }

  try {
    const outlineResult = await chapterPlannerAgent.execute(outlineContext, onToken)
    const outlineData = outlineContext._chapterOutlineData || JSON.parse(extractJsonPayload(outlineResult.content))
    currentChapters[currentChapters.length - 1] = applyPlanEntryToChapter(currentChapters[currentChapters.length - 1], outlineData)
    await onIntermediateSave?.({ chapters: currentChapters })
  } catch (e: any) {
    const msg = `Outline planning failed for Chapter ${nextChapterNumber}: ${e.message}`
    onError?.(msg)
    throw new Error(msg)
  }

  return currentChapters
}


function formatCurrentChapterPlanContext(chapter: Chapter) {
  return [
    `Chapter ${chapter.index + 1}: ${chapter.title}`,
    chapter.outline.objective.trim() ? `Objective: ${chapter.outline.objective.trim()}` : '',
    chapter.outline.conflict.trim() ? `Conflict: ${chapter.outline.conflict.trim()}` : '',
    chapter.outline.keyEvents.length ? `Key Events: ${chapter.outline.keyEvents.join(' | ')}` : '',
    chapter.outline.characterActions.length ? `Character Actions: ${chapter.outline.characterActions.join(' | ')}` : '',
    chapter.outline.infoReveals.length ? `Info Reveals: ${chapter.outline.infoReveals.join(' | ')}` : '',
    chapter.outline.endingHook.trim() ? `Ending Hook: ${chapter.outline.endingHook.trim()}` : '',
  ].filter(Boolean).join('\n')
}

function chapterToPlanEntry(chapter: Chapter): ChapterPlanEntry {
  return {
    chapterNumber: chapter.index + 1,
    title: chapter.title?.trim() || `Chapter ${chapter.index + 1}`,
    objective: chapter.outline.objective?.trim() || `Advance the story through chapter ${chapter.index + 1}.`,
    conflict: chapter.outline.conflict,
    keyEvents: chapter.outline.keyEvents,
    characterActions: chapter.outline.characterActions,
    infoReveals: chapter.outline.infoReveals,
    endingHook: chapter.outline.endingHook,
  }
}

function formatOutlineAuditIssues(issues: any[]) {
  if (!issues.length) return 'No qualifying audit issues.'
  return issues.map((issue, index) => [
    `${index + 1}. ${String(issue.title ?? 'Outline issue').trim()}`,
    `Severity: ${issue.severity ?? 'medium'}`,
    `Category: ${issue.category ?? 'logic'}`,
    issue.excerpt ? `Outline excerpt: ${issue.excerpt}` : '',
    `Problem: ${String(issue.explanation ?? '').trim()}`,
    `Required fix: ${String(issue.suggestedFix ?? '').trim()}`,
  ].filter(Boolean).join('\n')).join('\n\n')
}

function isGenericChapterTitle(chapter: Chapter) {
  const title = chapter.title?.trim() || ''
  return !title || new RegExp(`^chapter\\s*${chapter.index + 1}$`, 'i').test(title)
}

export async function completeChapterPlan(
  project: StoryProject,
  chapterIndex: number,
  onToken?: (token: string) => void,
  onProgress?: (message: string) => void,
  onError?: (error: string) => void,
  onIntermediateSave?: (updates: Partial<StoryProject>) => void | Promise<void>
): Promise<Chapter[]> {
  const { chapterTitlePlannerAgent, chapterPlannerAgent } = prepareRuntime()
  const chapter = project.chapters[chapterIndex]
  if (!chapter) throw new Error(`Chapter at position ${chapterIndex + 1} not found`)

  const chapterCount = Math.max(project.chapterConfig?.maxChapters ?? project.chapterCount ?? project.chapters.length, project.chapters.length)
  onProgress?.(`Completing outline for Chapter ${chapter.index + 1}: ${chapter.title}...`)
  onToken?.(`\n\n[Planning] Complete Chapter ${chapter.index + 1} Outline\n`)

  const knowledgeContext = await buildKnowledgeContextForProject(project, {
    theme: project.theme,
    genre: project.genre,
    targetReader: project.targetReader,
    language: project.language,
    style: project.style,
    customRequirements: project.customRequirements,
    outline: project.outline,
    chapterTitle: chapter.title,
    chapterOutline: JSON.stringify(chapter.outline),
  })

  const currentChapters = [...project.chapters]
  const previousChapters = project.chapters.filter(item => item.index < chapter.index)
  let targetChapter = chapterToPlanEntry(chapter)

  if (isGenericChapterTitle(chapter) || !chapter.outline.objective?.trim()) {
    onProgress?.(`Planning title for Chapter ${chapter.index + 1}...`)
    const titleContext: Record<string, any> = {
      mode: 'nextChapter',
      theme: project.theme,
      genre: project.genre,
      targetReader: project.targetReader,
      language: project.language,
      chapterCount,
      maxChapters: project.chapterConfig?.maxChapters ?? chapterCount,
      nextChapterNumber: chapter.index + 1,
      storyOutline: project.outline,
      existingChapters: formatChapterPlanContext(previousChapters),
      knowledgeContext,
    }

    try {
      const titleResult = await chapterTitlePlannerAgent.execute(titleContext, onToken)
      const titleData = titleContext._nextChapterTitleData || JSON.parse(extractJsonPayload(titleResult.content))
      targetChapter = {
        ...targetChapter,
        title: titleData.title?.trim() || targetChapter.title,
        objective: titleData.objective?.trim() || targetChapter.objective,
      }
      currentChapters[chapterIndex] = {
        ...currentChapters[chapterIndex],
        title: targetChapter.title,
        outline: {
          ...currentChapters[chapterIndex].outline,
          objective: targetChapter.objective,
        },
        updatedAt: new Date().toISOString(),
      }
      await onIntermediateSave?.({ chapters: currentChapters })
    } catch (e: any) {
      const msg = `Title planning failed for Chapter ${chapter.index + 1}: ${e.message}`
      onError?.(msg)
      throw new Error(msg)
    }
  }

  const currentChapterForContext = currentChapters[chapterIndex]
  const outlineContext: Record<string, any> = {
    theme: project.theme,
    genre: project.genre,
    targetReader: project.targetReader,
    language: project.language,
    style: project.style,
    storyOutline: project.outline,
    characters: buildCharacterContextForTask(project.characters, 'outlining'),
    existingChapters: formatChapterPlanContext(previousChapters),
    currentChapterPlan: formatCurrentChapterPlanContext(currentChapterForContext),
    knowledgeContext,
    targetChapter,
    chapterCount,
    _onChapterOutlineUpdated: async (outlineData: ChapterPlanEntry) => {
      currentChapters[chapterIndex] = applyPlanEntryToChapter(currentChapters[chapterIndex], outlineData)
      await onIntermediateSave?.({ chapters: currentChapters })
    },
  }

  try {
    const outlineResult = await chapterPlannerAgent.execute(outlineContext, onToken)
    const outlineData = outlineContext._chapterOutlineData || JSON.parse(extractJsonPayload(outlineResult.content))
    currentChapters[chapterIndex] = applyPlanEntryToChapter(currentChapters[chapterIndex], outlineData)
    await onIntermediateSave?.({ chapters: currentChapters })
    return currentChapters
  } catch (e: any) {
    const msg = `Outline planning failed for Chapter ${chapter.index + 1}: ${e.message}`
    onError?.(msg)
    throw new Error(msg)
  }
}

export async function reviewAndRewriteChapterPlan(
  project: StoryProject,
  chapterIndex: number,
  onToken?: (token: string) => void,
  onProgress?: (message: string) => void,
  onError?: (error: string) => void,
  onIntermediateSave?: (updates: Partial<StoryProject>) => void | Promise<void>
): Promise<{ chapters: Chapter[]; issues: any[] }> {
  const { proofreaderAgent, chapterPlannerAgent } = prepareRuntime()
  const chapter = project.chapters[chapterIndex]
  if (!chapter) throw new Error(`Chapter at position ${chapterIndex + 1} not found`)

  const severityThreshold = useProviderStore().toolWorkflowSettings.minIssueSeverity
  const knowledgeContext = await buildKnowledgeContextForProject(project, {
    theme: project.theme,
    genre: project.genre,
    targetReader: project.targetReader,
    language: project.language,
    style: project.style,
    customRequirements: project.customRequirements,
    outline: project.outline,
    chapterTitle: chapter.title,
    chapterOutline: JSON.stringify(chapter.outline),
  })

  onProgress?.(`Reviewing outline for Chapter ${chapter.index + 1}...`)
  onToken?.(`\n\n[Review] Chapter ${chapter.index + 1} Outline Audit\n`)

  const previousChapters = project.chapters.filter(item => item.index < chapter.index)
  const auditContext: Record<string, any> = {
    auditTarget: 'chapter-outline',
    content: formatCurrentChapterPlanContext(chapter),
    chapterTitle: chapter.title,
    chapterNumber: chapter.index + 1,
    chapterOutline: project.outline,
    characters: buildCharacterContextForTask(project.characters, 'proofreading'),
    previousSummary: formatChapterPlanContext(previousChapters.slice(-12)),
    language: project.language,
    style: project.style,
    project: buildProjectRelationshipContext(project),
    writingFormat: project.writingFormat,
    knowledgeContext,
  }

  let qualifyingIssues: any[] = []
  try {
    const auditResult = await proofreaderAgent.execute(auditContext, onToken)
    const issues: any[] = Array.isArray(auditResult.data?.issues) ? auditResult.data.issues : []
    qualifyingIssues = issues.filter((issue: any) => issueMeetsSeverityThreshold(issue, severityThreshold))
  } catch (e: any) {
    const msg = `Outline review failed for Chapter ${chapter.index + 1}: ${e.message}`
    onError?.(msg)
    throw new Error(msg)
  }

  if (!qualifyingIssues.length) {
    onProgress?.(`No ${severityThreshold}+ outline issues found for Chapter ${chapter.index + 1}.`)
    return { chapters: project.chapters, issues: [] }
  }

  onProgress?.(`Rewriting outline for Chapter ${chapter.index + 1} from ${qualifyingIssues.length} review issue(s)...`)
  onToken?.(`\n\n[Planning] Rewrite Chapter ${chapter.index + 1} Outline From Review\n`)

  const currentChapters = [...project.chapters]
  const targetChapter = chapterToPlanEntry(chapter)
  const outlineContext: Record<string, any> = {
    theme: project.theme,
    genre: project.genre,
    targetReader: project.targetReader,
    language: project.language,
    style: project.style,
    storyOutline: project.outline,
    characters: buildCharacterContextForTask(project.characters, 'outlining'),
    existingChapters: formatChapterPlanContext(previousChapters),
    currentChapterPlan: [
      formatCurrentChapterPlanContext(chapter),
      '',
      `Quick review issues to fix (minimum severity: ${severityThreshold}):`,
      formatOutlineAuditIssues(qualifyingIssues),
      '',
      'Rewrite this chapter outline to preserve the useful intent while fixing every qualifying review issue. Keep the same chapter number, title, and objective unless the issue requires tightening the objective.',
    ].join('\n'),
    knowledgeContext,
    targetChapter,
    chapterCount: Math.max(project.chapterConfig?.maxChapters ?? project.chapterCount ?? project.chapters.length, project.chapters.length),
    _onChapterOutlineUpdated: async (outlineData: ChapterPlanEntry) => {
      currentChapters[chapterIndex] = applyPlanEntryToChapter(currentChapters[chapterIndex], outlineData)
      await onIntermediateSave?.({ chapters: currentChapters })
    },
  }

  try {
    const outlineResult = await chapterPlannerAgent.execute(outlineContext, onToken)
    const outlineData = outlineContext._chapterOutlineData || JSON.parse(extractJsonPayload(outlineResult.content))
    currentChapters[chapterIndex] = applyPlanEntryToChapter(currentChapters[chapterIndex], outlineData)
    await onIntermediateSave?.({ chapters: currentChapters })
    return { chapters: currentChapters, issues: qualifyingIssues }
  } catch (e: any) {
    const msg = `Outline rewrite failed for Chapter ${chapter.index + 1}: ${e.message}`
    onError?.(msg)
    throw new Error(msg)
  }
}

export async function generateChapterDraft(
  project: StoryProject,
  chapterIndex: number,
  onToken?: (token: string) => void,
  onIntermediateChapter?: (chapter: Chapter) => void | Promise<void>
) {
  const { writerAgent } = prepareRuntime()
  const chapter = project.chapters[chapterIndex]
  if (!chapter) throw new Error(`Chapter at position ${chapterIndex + 1} not found`)
  const chapterNumber = chapter.index + 1

  const knowledgeContext = await buildKnowledgeContextForProject(project, {
    theme: project.theme,
    genre: project.genre,
    targetReader: project.targetReader,
    language: project.language,
    chapterTitle: chapter.title,
    chapterOutline: JSON.stringify(chapter.outline),
    previousSummary: buildPreviousSummary(project, chapterIndex),
  })
  const relationshipContext = `Relationship query tools are available. Query prior relationship state at chapterIndex ${Math.max(-1, chapter.index - 1)} only for characters whose dynamics matter in this chapter.`

  const writerContext: Record<string, any> = {
    chapterOutline: chapter.outline,
    chapterTitle: chapter.title,
    chapterIndex,
    chapterNumber,
    characters: buildCharacterContextForTask(project.characters, 'writing'),
    relationships: relationshipContext,
    previousSummary: buildPreviousSummary(project, chapterIndex),
    language: project.language,
    style: project.style,
    project: buildProjectRelationshipContext(project),
    writingFormat: project.writingFormat,
    knowledgeContext,
  }

  let lastSavedContent = ''
  const saveIntermediateChapter = async () => {
    const draftContent = sanitizeGeneratedChapterContent(
      typeof writerContext._chapterContent === 'string' ? writerContext._chapterContent : '',
      {
        writingFormat: project.writingFormat,
        writingStyle: project.style,
        chapterTitle: chapter.title,
        chapterNumber,
      }
    )
    if (!draftContent || draftContent === lastSavedContent) return

    lastSavedContent = draftContent
    await onIntermediateChapter?.({
      ...chapter,
      content: draftContent,
      summary: typeof writerContext._chapterSummary === 'string' && writerContext._chapterSummary.trim()
        ? writerContext._chapterSummary.trim()
        : `${draftContent.substring(0, 200)}...`,
      status: 'writing' as const,
    })
  }
  writerContext._onChapterDraftUpdate = saveIntermediateChapter

  const writerResult = await writerAgent.execute(writerContext, onToken)
  await saveIntermediateChapter()
  const chapterContent = sanitizeGeneratedChapterContent(
    typeof writerContext._chapterContent === 'string' && writerContext._chapterContent.trim()
      ? writerContext._chapterContent
      : writerResult.content,
    {
      writingFormat: project.writingFormat,
      writingStyle: project.style,
      chapterTitle: chapter.title,
      chapterNumber,
    }
  )
  const chapterSummary = typeof writerContext._chapterSummary === 'string' && writerContext._chapterSummary.trim()
    ? writerContext._chapterSummary.trim()
    : `${chapterContent.substring(0, 200)}...`

  return {
    ...chapter,
    content: chapterContent,
    proofreadingIssues: [],
    proofreadingIssuesStale: false,
    polishedContent: '',
    summary: chapterSummary,
    status: 'draft' as const,
  }
}

export async function proofreadChapter(
  project: StoryProject,
  chapterIndex: number,
  onToken?: (token: string) => void
) {
  const { proofreaderAgent } = prepareRuntime()
  const chapter = project.chapters[chapterIndex]
  if (!chapter) throw new Error(`Chapter at position ${chapterIndex + 1} not found`)
  const chapterNumber = chapter.index + 1

  const knowledgeContext = await buildKnowledgeContextForProject(project, {
    theme: project.theme,
    genre: project.genre,
    targetReader: project.targetReader,
    language: project.language,
    chapterTitle: chapter.title,
    chapterOutline: JSON.stringify(chapter.outline),
    content: chapter.content,
    previousSummary: buildPreviousSummary(project, chapterIndex),
  })

  const segments = buildProofreadingSegments(chapter.content)
  for (const segment of segments) {
    const proofreadContext: Record<string, any> = {
      content: segment.content,
      chapterTitle: chapter.title,
      chapterNumber,
      chapterOutline: chapter.outline,
      characters: buildCharacterContextForTask(project.characters, 'proofreading'),
      previousSummary: buildPreviousSummary(project, chapterIndex),
      language: project.language,
      style: project.style,
      project: buildProjectRelationshipContext(project),
      writingFormat: project.writingFormat,
      knowledgeContext,
      range: segment,
    }
    await proofreaderAgent.execute(proofreadContext, onToken)
  }

  return {
    ...chapter,
    proofreadingIssues: [],
    status: 'proofread' as const,
  }
}

export async function polishChapter(
  project: StoryProject,
  chapterIndex: number,
  onToken?: (token: string) => void,
  proofreadingIssues?: any[],
  onIntermediateChapter?: (chapter: Chapter) => void | Promise<void>
) {
  const { polisherAgent } = prepareRuntime()
  const chapter = project.chapters[chapterIndex]
  if (!chapter) throw new Error(`Chapter at position ${chapterIndex + 1} not found`)
  const chapterNumber = chapter.index + 1

  const contentToPolish = chapter.content
  const minIssueSeverity = useProviderStore().toolWorkflowSettings.minIssueSeverity
  const issues = (proofreadingIssues || chapter.proofreadingIssues || []).map(issue => {
    const forcePolish = Boolean(issue.forcePolish)
    const belowThreshold = !forcePolish && !issueMeetsSeverityThreshold(issue, minIssueSeverity)
    return {
      ...issue,
      ignored: issue.ignored || belowThreshold,
      polishStatus: issue.ignored || belowThreshold ? 'ignored' : issue.polishStatus,
      polishResult: issue.ignored
        ? 'Ignored by user.'
        : belowThreshold
          ? `Ignored by minimum severity setting (${minIssueSeverity}).`
          : issue.polishResult,
    }
  })
  const activeIssues = issues.filter(issue => !issue.ignored && !issue.skipPolishRun && issue.polishStatus !== 'fixed')
  const segments = buildProofreadingSegments(contentToPolish)
  const segmentContents = segments.map(segment => segment.content)
  const issueResults = new Map<string, { status: 'fixed' | 'ignored' | 'failed'; result: string }>()

  for (const issue of issues) {
    if (issue.ignored) {
      issueResults.set(issue.id, { status: 'ignored', result: issue.polishResult || 'Ignored by user.' })
    }
  }

  const buildChapterSnapshot = (status: Chapter['status'] = 'polishing') => {
    const nextContent = sanitizeGeneratedChapterContent(
      segmentContents.join('\n\n'),
      {
        writingFormat: project.writingFormat,
        writingStyle: project.style,
        chapterTitle: chapter.title,
        chapterNumber,
      }
    )
    const nextIssues = issues.map(issue => {
      const { forcePolish, skipPolishRun, ...persistedIssue } = issue
      const result = issueResults.get(issue.id)
      if (!result) {
        return {
          ...persistedIssue,
          polishStatus: issue.polishStatus || (issue.ignored ? 'ignored' as const : 'pending' as const),
          polishResult: issue.ignored ? (issue.polishResult || 'Ignored by user.') : issue.polishResult,
        }
      }
      return {
        ...persistedIssue,
        polishStatus: result.status,
        polishResult: result.result,
      }
    })

    return {
      ...chapter,
      proofreadingIssues: nextIssues,
      content: nextContent,
      polishedContent: '',
      status,
    }
  }

  const resolveIssueSegmentIndex = (issue: any) => {
    if (typeof issue.segmentIndex === 'number' && segments[issue.segmentIndex]) return issue.segmentIndex
    const excerpt = String(issue.excerpt ?? '').trim()
    if (excerpt) {
      const foundIndex = segmentContents.findIndex(segment => segment.includes(excerpt))
      if (foundIndex >= 0) return foundIndex
    }
    return 0
  }

  if (!activeIssues.length) {
    return buildChapterSnapshot('polished')
  }

  for (let issueIndex = 0; issueIndex < activeIssues.length; issueIndex++) {
    const issue = activeIssues[issueIndex]
    const segmentIndex = resolveIssueSegmentIndex(issue)
    const segment = segments[segmentIndex]
    if (!segment) continue

    const polishContext: Record<string, any> = {
      content: segmentContents[segmentIndex],
      chapterTitle: chapter.title,
      chapterNumber,
      characters: buildCharacterContextForTask(project.characters, 'polishing'),
      language: project.language,
      style: project.style,
      project: buildProjectRelationshipContext(project),
      writingFormat: project.writingFormat,
      proofreadingIssues: [issue],
      range: segment,
    }
    onToken?.(`\n[Polishing issue ${issueIndex + 1}/${activeIssues.length}: ${issue.title}]\n`)
    const result = await polisherAgent.execute(polishContext, onToken)
    const polishedSegment = typeof polishContext._polishedContent === 'string' && polishContext._polishedContent.trim()
      ? polishContext._polishedContent
      : result.content
    segmentContents[segmentIndex] = polishedSegment
    const reported = Array.isArray(result.data?.issueResults) ? result.data.issueResults : []
    let hasCurrentIssueResult = false
    for (const item of reported) {
      if (!item?.issueId) continue
      if (item.issueId === issue.id) hasCurrentIssueResult = true
      issueResults.set(item.issueId, {
        status: item.status === 'ignored' || item.status === 'failed' ? item.status : 'fixed',
        result: String(item.result ?? '').trim(),
      })
    }
    if (!hasCurrentIssueResult) {
      issueResults.set(issue.id, {
        status: 'fixed',
        result: 'Polisher returned an updated segment for this issue.',
      })
    }

    await onIntermediateChapter?.(buildChapterSnapshot('polishing'))
  }

  return buildChapterSnapshot('polished')
}

export async function run(
  project: StoryProject,
  callbacks: PipelineCallbacks,
  options: PipelineRunOptions = {},
  isCancelled: () => boolean = () => false
): Promise<StoryProject> {
  const runtime = prepareRuntime()
  const {
    writerAgent,
    proofreaderAgent,
    relationshipTrackerAgent,
  } = runtime

  let updatedProject = { ...project }
  const stopAfter = options.stopAfterStage
  const save = () => callbacks.onIntermediateSave?.(updatedProject)

  if (!hasStoryPlan(updatedProject)) {
    if (isCancelled()) return updatedProject
    callbacks.onStageChange('planning')
    callbacks.onProgress('Planning story outline and characters...')

    try {
      const planResult = await runStoryPlanningWorkflow(updatedProject, callbacks.onToken, callbacks.onProgress, callbacks.onError)
      updatedProject.outline = planResult.outline
      updatedProject.characters = planResult.characters
      updatedProject.generationStage = 'chapter-outline'
      save()
    } catch (e: any) {
      callbacks.onError(`Story planning failed: ${e.message}`)
      return updatedProject
    }
  } else {
    updatedProject.generationStage = hasChapterPlan(updatedProject) ? updatedProject.generationStage : 'chapter-outline'
    callbacks.onProgress('Story plan already complete. Skipping planning.')
  }

  if (stopAfter === 'planning') {
    return updatedProject
  }

  if (!hasChapterPlan(updatedProject)) {
    if (isCancelled()) return updatedProject
    callbacks.onStageChange('chapter-outline')
    callbacks.onProgress('Planning chapter outlines...')

    try {
      const plannedChapters = await runChapterPlanningWorkflow(
        updatedProject,
        callbacks.onToken,
        callbacks.onProgress,
        callbacks.onError,
        (updates) => {
          Object.assign(updatedProject, updates)
          save()
        },
        isCancelled
      )

      updatedProject.chapters = plannedChapters
      updatedProject.generationStage = 'writing'
      save()
    } catch (e: any) {
      callbacks.onError(`Chapter outline planning failed: ${e.message}`)
      return updatedProject
    }
  } else {
    updatedProject.generationStage = hasAllDrafts(updatedProject) ? updatedProject.generationStage : 'writing'
    callbacks.onProgress('Chapter plan already complete. Skipping chapter outlining.')
  }

  if (stopAfter === 'chapter-outline') {
    return updatedProject
  }

  if (!hasAllDrafts(updatedProject)) {
    if (isCancelled()) return updatedProject
    callbacks.onStageChange('writing')
    callbacks.onProgress('Writing chapter drafts...')

    for (const i of chapterPositionsInStoryOrder(updatedProject.chapters)) {
      if (isCancelled()) break
      const chapter = updatedProject.chapters[i]
      const chapterNumber = chapter.index + 1
      if (chapter.content.trim()) continue

      callbacks.onChapterStart(i)
      callbacks.onProgress(`Writing chapter ${chapterNumber} of ${updatedProject.chapters.length}...`)

      try {
        const charContext = buildCharacterContextForTask(updatedProject.characters, 'writing')
        const knowledgeContext = await buildKnowledgeContextForProject(updatedProject, {
          theme: updatedProject.theme,
          genre: updatedProject.genre,
          targetReader: updatedProject.targetReader,
          language: updatedProject.language,
          chapterTitle: chapter.title,
          chapterOutline: JSON.stringify(chapter.outline),
          previousSummary: buildPreviousSummary(updatedProject, i),
        })
        const relationshipContext = `Relationship query tools are available. Query prior relationship state at chapterIndex ${Math.max(-1, chapter.index - 1)} only for characters whose dynamics matter in this chapter.`
        const writerContext: Record<string, any> = {
          chapterOutline: chapter.outline,
          chapterTitle: chapter.title,
          chapterIndex: i,
          chapterNumber,
          characters: charContext,
          relationships: relationshipContext,
          previousSummary: buildPreviousSummary(updatedProject, i),
          language: project.language,
          style: project.style,
          project: buildProjectRelationshipContext(updatedProject),
          writingFormat: project.writingFormat,
          knowledgeContext,
        }

        let lastSavedContent = ''
        const saveIntermediateChapter = () => {
          const draftContent = sanitizeGeneratedChapterContent(
            typeof writerContext._chapterContent === 'string' ? writerContext._chapterContent : '',
            {
              writingFormat: updatedProject.writingFormat,
              writingStyle: updatedProject.style,
              chapterTitle: chapter.title,
              chapterNumber,
            }
          )
          if (!draftContent || draftContent === lastSavedContent) return

          lastSavedContent = draftContent
          updatedProject.chapters[i].content = draftContent
          updatedProject.chapters[i].proofreadingIssues = []
          updatedProject.chapters[i].proofreadingIssuesStale = false
          updatedProject.chapters[i].summary = typeof writerContext._chapterSummary === 'string' && writerContext._chapterSummary.trim()
            ? writerContext._chapterSummary.trim()
            : `${draftContent.substring(0, 200)}...`
          updatedProject.chapters[i].status = 'writing'
          save()
        }
        writerContext._onChapterDraftUpdate = saveIntermediateChapter

        const writerResult = await writerAgent.execute(writerContext, callbacks.onToken)
        saveIntermediateChapter()
        const chapterContent = sanitizeGeneratedChapterContent(
          typeof writerContext._chapterContent === 'string' && writerContext._chapterContent.trim()
            ? writerContext._chapterContent
            : writerResult.content,
          {
            writingFormat: updatedProject.writingFormat,
            writingStyle: updatedProject.style,
            chapterTitle: chapter.title,
            chapterNumber,
          }
        )
        const chapterSummary = typeof writerContext._chapterSummary === 'string' && writerContext._chapterSummary.trim()
          ? writerContext._chapterSummary.trim()
          : `${chapterContent.substring(0, 200)}...`

        updatedProject.chapters[i].content = chapterContent
        updatedProject.chapters[i].proofreadingIssues = []
        updatedProject.chapters[i].proofreadingIssuesStale = false
        updatedProject.chapters[i].summary = chapterSummary
        updatedProject.chapters[i].status = 'draft'

        const relationshipEvents = await extractRelationshipEventsForChapter(
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
        callbacks.onError(`Chapter ${chapterNumber} writing failed: ${e.message}`)
      }
    }

    if (isCancelled()) return updatedProject
    updatedProject.generationStage = 'proofreading'
    save()
  } else {
    updatedProject.generationStage = hasAllProofread(updatedProject) ? updatedProject.generationStage : 'proofreading'
    callbacks.onProgress('Chapter drafts already complete. Skipping writing.')
  }

  if (stopAfter === 'writing') {
    return updatedProject
  }

  if (!hasAllProofread(updatedProject)) {
    if (isCancelled()) return updatedProject
    callbacks.onStageChange('proofreading')
    callbacks.onProgress('Proofreading chapter drafts...')

    for (const i of chapterPositionsInStoryOrder(updatedProject.chapters)) {
      if (isCancelled()) break
      const chapter = updatedProject.chapters[i]
      const chapterNumber = chapter.index + 1
      if (['proofread', 'polishing', 'polished'].includes(chapter.status)) continue

      callbacks.onChapterStart(i)
      callbacks.onProgress(`Proofreading chapter ${chapterNumber}...`)

      try {
        const allIssues: any[] = []
        const charContext = buildCharacterContextForTask(updatedProject.characters, 'proofreading')
        const knowledgeContext = await buildKnowledgeContextForProject(updatedProject, {
          theme: updatedProject.theme,
          genre: updatedProject.genre,
          targetReader: updatedProject.targetReader,
          language: updatedProject.language,
          chapterTitle: chapter.title,
          chapterOutline: JSON.stringify(chapter.outline),
          content: chapter.content,
          previousSummary: buildPreviousSummary(updatedProject, i),
        })
        const segments = buildProofreadingSegments(chapter.content)
        for (const segment of segments) {
          if (isCancelled()) break
          callbacks.onProgress(`Proofreading chapter ${chapterNumber} (Part ${segment.index + 1}/${segment.total})...`)
          const result = await proofreaderAgent.execute({
            content: segment.content,
            chapterTitle: chapter.title,
            chapterNumber,
            chapterOutline: chapter.outline,
            characters: charContext,
            previousSummary: buildPreviousSummary(updatedProject, i),
            language: project.language,
            style: project.style,
            project: buildProjectRelationshipContext(updatedProject),
            writingFormat: updatedProject.writingFormat,
            knowledgeContext,
            range: segment,
          }, callbacks.onToken)
          if (Array.isArray(result.data?.issues)) {
            allIssues.push(...result.data.issues.map((issue: any) => ({
              ...issue,
              segmentIndex: segment.index,
              segmentTotal: segment.total,
              segmentCharStart: segment.charStart,
              segmentCharEnd: segment.charEnd,
              segmentTokenStart: segment.tokenStart,
              segmentTokenEnd: segment.tokenEnd,
              segmentTokenTotal: segment.tokenTotal,
            })))
          }
        }

        updatedProject.chapters[i].proofreadingIssues = allIssues
        updatedProject.chapters[i].proofreadingIssuesStale = false
        updatedProject.chapters[i].status = 'proofread'
        callbacks.onChapterComplete(i)
        save()
      } catch (e: any) {
        callbacks.onError(`Proofreading chapter ${chapterNumber} failed: ${e.message}`)
      }
    }

    if (isCancelled()) return updatedProject
    updatedProject.generationStage = 'polishing'
    save()
  } else {
    updatedProject.generationStage = hasAllPolished(updatedProject) ? updatedProject.generationStage : 'polishing'
    callbacks.onProgress('Proofread chapters already complete. Skipping proofreading.')
  }

  if (stopAfter === 'proofreading') {
    return updatedProject
  }

  if (!hasAllPolished(updatedProject)) {
    if (isCancelled()) return updatedProject
    callbacks.onStageChange('polishing')
    callbacks.onProgress('Polishing chapter drafts...')

    for (const i of chapterPositionsInStoryOrder(updatedProject.chapters)) {
      if (isCancelled()) break
      const chapter = updatedProject.chapters[i]
      const chapterNumber = chapter.index + 1
      if (chapter.status === 'polished') continue

      callbacks.onChapterStart(i)
      callbacks.onProgress(`Polishing chapter ${chapterNumber}...`)

      try {
        updatedProject.chapters[i] = await polishChapter(
          updatedProject,
          i,
          callbacks.onToken,
          chapter.proofreadingIssues,
          async (intermediateChapter) => {
            updatedProject.chapters[i] = intermediateChapter
            save()
          }
        )
        callbacks.onChapterComplete(i)
        save()
      } catch (e: any) {
        callbacks.onError(`Polishing chapter ${chapterNumber} failed: ${e.message}`)
      }
    }
  }

  if (isCancelled()) return updatedProject
  updatedProject.status = 'completed'
  updatedProject.generationStage = 'done'
  save()
  callbacks.onStageChange('done')
  callbacks.onProgress('Generation complete!')

  return updatedProject
}
