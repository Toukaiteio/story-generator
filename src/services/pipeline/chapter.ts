import type { StoryProject } from '@/types/project'
import type { Chapter } from '@/types/chapter'
import { extractJsonPayload } from '@/services/agent/validation'
import { buildCharacterContext, buildPreviousSummary } from './context'
import { appendRelationshipEventsForChapter } from '@/services/relationship'
import { buildRelationshipContext } from '@/services/relationship/context'
import { buildKnowledgeContextForProject, estimateChapterCount, prepareRuntime } from './runtime'
import type { ChapterPlanEntry, PipelineCallbacks, PipelineRunOptions } from './types'
import { generateId } from '@/lib/id'
import { extractRelationshipEventsForChapter, runStoryPlanningWorkflow } from './planning'

export function formatChapterPlanContext(chapters: Chapter[]) {
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

function buildChapterPlanEntryMap(entries: ChapterPlanEntry[]) {
  const map = new Map<number, ChapterPlanEntry>()
  for (const entry of entries) {
    if (!entry || !Number.isInteger(entry.chapterNumber)) continue
    map.set(entry.chapterNumber, entry)
  }
  return map
}

export function buildChaptersFromPlanEntries(
  entries: ChapterPlanEntry[],
  chapterCount: number,
  previousChapters: Chapter[] = []
): Chapter[] {
  const now = new Date().toISOString()
  const entryMap = buildChapterPlanEntryMap(entries)

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

export async function runChapterPlanningWorkflow(
  project: StoryProject,
  onToken?: (token: string) => void,
  onProgress?: (message: string) => void,
  onError?: (error: string) => void,
  onIntermediateSave?: (updates: Partial<StoryProject>) => void,
  isCancelled: () => boolean = () => false
): Promise<Chapter[]> {
  const runtime = prepareRuntime()
  const { chapterTitlePlannerAgent, chapterPlannerAgent } = runtime

  onProgress?.('Estimating chapter count and planning titles...')
  onToken?.('\n\n[Planning] Chapter Title Planning\n')

  const knowledgeContext = await buildKnowledgeContextForProject(project, {
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

  const chapterCount = titlesData?.chapterCount || estimateChapterCount(project.length)
  const titles = titlesData?.chapters || []

  const plannedEntries: ChapterPlanEntry[] = []

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
      characters: buildCharacterContext(project.characters),
      existingChapters: formatChapterPlanContext(
        buildChaptersFromPlanEntries(plannedEntries, plannedEntries.length, project.chapters)
      ),
      knowledgeContext,
      targetChapter: titleEntry,
      chapterCount,
    }

    try {
      const outlineResult = await chapterPlannerAgent.execute(outlineContext, onToken)
      const outlineData = outlineContext._chapterOutlineData || JSON.parse(extractJsonPayload(outlineResult.content))
      plannedEntries.push(outlineData)

      const currentChapters = buildChaptersFromPlanEntries(plannedEntries, chapterCount, project.chapters)
      onIntermediateSave?.({ chapters: currentChapters })
    } catch (e: any) {
      const msg = `Outline planning failed for Chapter ${titleEntry.chapterNumber}: ${e.message}`
      onError?.(msg)
      throw new Error(msg)
    }
  }

  return buildChaptersFromPlanEntries(plannedEntries, chapterCount, project.chapters)
}

export async function generateChapterPlan(
  project: StoryProject,
  onToken?: (token: string) => void,
  onProgress?: (message: string) => void,
  onError?: (error: string) => void,
  onIntermediateSave?: (updates: Partial<StoryProject>) => void,
  isCancelled: () => boolean = () => false
): Promise<Chapter[]> {
  return runChapterPlanningWorkflow(project, onToken, onProgress, onError, onIntermediateSave, isCancelled)
}

export async function generateChapterDraft(
  project: StoryProject,
  chapterIndex: number,
  onToken?: (token: string) => void
) {
  const { writerAgent } = prepareRuntime()
  const chapter = project.chapters[chapterIndex]
  if (!chapter) throw new Error(`Chapter ${chapterIndex + 1} not found`)

  const knowledgeContext = await buildKnowledgeContextForProject(project, {
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

export async function proofreadChapter(
  project: StoryProject,
  chapterIndex: number,
  onToken?: (token: string) => void
) {
  const { proofreaderAgent } = prepareRuntime()
  const chapter = project.chapters[chapterIndex]
  if (!chapter) throw new Error(`Chapter ${chapterIndex + 1} not found`)

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

export async function polishChapter(
  project: StoryProject,
  chapterIndex: number,
  onToken?: (token: string) => void
) {
  const { polisherAgent } = prepareRuntime()
  const chapter = project.chapters[chapterIndex]
  if (!chapter) throw new Error(`Chapter ${chapterIndex + 1} not found`)

  const contentToPolish = chapter.proofreadContent || chapter.content
  const knowledgeContext = await buildKnowledgeContextForProject(project, {
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
    polisherAgent,
    relationshipTrackerAgent,
  } = runtime

  let updatedProject = { ...project }
  const stopAfter = options.stopAfterStage
  const save = () => callbacks.onIntermediateSave?.(updatedProject)

  if (isCancelled()) return updatedProject
  callbacks.onStageChange('planning')
  callbacks.onProgress('Planning story outline and characters...')

  try {
    const planResult = await runStoryPlanningWorkflow(project, callbacks.onToken, callbacks.onProgress, callbacks.onError)
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

  if (stopAfter === 'chapter-outline') {
    return updatedProject
  }

  if (isCancelled()) return updatedProject
  callbacks.onStageChange('writing')
  callbacks.onProgress('Writing chapter drafts...')

  for (let i = 0; i < updatedProject.chapters.length; i++) {
    if (isCancelled()) break
    callbacks.onChapterStart(i)
    callbacks.onProgress(`Writing chapter ${i + 1} of ${updatedProject.chapters.length}...`)

    try {
      const charContext = buildCharacterContext(updatedProject.characters)
      const knowledgeContext = await buildKnowledgeContextForProject(updatedProject, {
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
      callbacks.onError(`Chapter ${i + 1} writing failed: ${e.message}`)
    }
  }

  updatedProject.generationStage = 'proofreading'
  save()

  if (stopAfter === 'writing') {
    return updatedProject
  }

  if (isCancelled()) return updatedProject
  callbacks.onStageChange('proofreading')
  callbacks.onProgress('Proofreading chapter drafts...')

  for (let i = 0; i < updatedProject.chapters.length; i++) {
    if (isCancelled()) break
    callbacks.onProgress(`Proofreading chapter ${i + 1}...`)

    try {
      const charContext = buildCharacterContext(updatedProject.characters)
      const knowledgeContext = await buildKnowledgeContextForProject(updatedProject, {
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

  if (isCancelled()) return updatedProject
  callbacks.onStageChange('polishing')
  callbacks.onProgress('Polishing chapter drafts...')

  for (let i = 0; i < updatedProject.chapters.length; i++) {
    if (isCancelled()) break
    callbacks.onProgress(`Polishing chapter ${i + 1}...`)

    try {
      const contentToPolish = updatedProject.chapters[i].proofreadContent || updatedProject.chapters[i].content
      const knowledgeContext = await buildKnowledgeContextForProject(updatedProject, {
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
