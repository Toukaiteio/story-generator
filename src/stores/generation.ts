import { defineStore } from 'pinia'
import { ref } from 'vue'
import { StoryPipeline } from '@/services/pipeline'
import { prepareRuntime, buildKnowledgeContextForProject } from '@/services/pipeline/runtime'
import { buildPreviousSummary, buildCharacterContextForTask } from '@/services/pipeline/context'
import { useProjectStore } from '@/stores/project'
import { useProviderStore } from '@/stores/provider'
import { providerManager } from '@/services/provider'
import { getRelationshipQueryTools } from '@/services/relationship/tools'
import { setToolContinuationHandler } from '@/services/agent/toolContinuation'
import { clearAgentTodoList, getTodoListTool, handleTodoListToolCall, isTodoListTool, type AgentTodoListState } from '@/services/agent/todolist'
import { countWords } from '@/services/agent/validation'
import { buildProofreadingSegments, buildSegmentedProofreadingPrompts } from '@/services/proofreading/chunking'
import { generationStageOrder, getNextGenerationAction, isChapterPlanComplete, resolveChapterIndexById, resolveNextChapterIndex } from '@/services/generation/flow'
import { getChapterIssueReportTool, getEditingAuditSystemPrompt, getProofreadingSystemPrompt, getProofreadingTools, getChapterRegion, mapEditingAuditIssues, mapProofreadingIssues } from '@/services/generation/proofreadingTools'
import { chatWithRelationshipTools, chatWithRelationshipToolsInPlace, getToolCall } from '@/services/generation/toolWorkflow'
import { fitMessagesToContextSmart, fitToContext } from '@/services/context'
import { injectCustomSystemPrompt } from '@/services/systemPrompt'
import type { GenerationStage, StoryProject } from '@/types/project'
import type { ChapterOutline } from '@/types/chapter'
import type { AgentType } from '@/types/agent'
import type { ChatMessage } from '@/types/provider'
import type { ProviderModelRef } from '@/types/provider'
import type { ToolDefinition } from '@/services/provider'
import type { FunctionCallingResponse } from '@/services/provider/types'
import type { ChapterAuditIssue } from '@/services/generation/types'

export type { ChapterAuditIssue } from '@/services/generation/types'

interface GenerationError {
  id: string
  stage: string
  message: string
  timestamp: string
}

interface ToolContinuationRequest {
  id: string
  workflow: string
  rounds: number
  finalToolNames: string[]
  continue: () => void
  stop: () => void
}

export const useGenerationStore = defineStore('generation', () => {
  const isGenerating = ref(false)
  const currentStage = ref<GenerationStage>('idle')
  const progressMessage = ref('')
  const streamContent = ref('')
  const errors = ref<GenerationError[]>([])
  const cancelled = ref(false)
  const currentProjectId = ref<string | null>(null)
  const isFollowingMode = ref(false)
  const currentChapterIndex = ref<number | null>(null)
  const toolContinuationRequest = ref<ToolContinuationRequest | null>(null)

  let errorCounter = 0
  let pipeline: StoryPipeline | null = null

  setToolContinuationHandler(waitForToolContinuation)

  const completedStages = ref<Set<string>>(new Set())

  function isStageComplete(stage: string): boolean {
    return completedStages.value.has(stage)
  }

  function resetRunState(projectId: string, follow = false) {
    isGenerating.value = true
    isFollowingMode.value = follow
    cancelled.value = false
    errors.value = []
    currentProjectId.value = projectId
    progressMessage.value = ''
    streamContent.value = ''
    clearAgentTodoList()
    currentStage.value = 'idle'
    currentChapterIndex.value = null
    pipeline = new StoryPipeline()
  }

  function appendStreamToken(token: string) {
    streamContent.value += token
  }

  function finishRun() {
    isGenerating.value = false
    isFollowingMode.value = false
    progressMessage.value = ''
    currentChapterIndex.value = null
    pipeline = null
  }

  function addError(stage: string, message: string) {
    errors.value.push({
      id: `err-${++errorCounter}`,
      stage,
      message,
      timestamp: new Date().toISOString(),
    })
  }

  function markCompleted(stage: GenerationStage) {
    completedStages.value = new Set([...completedStages.value, stage])
  }

  function markCompletedThrough(stage: GenerationStage) {
    for (const item of generationStageOrder) {
      markCompleted(item)
      if (item === stage) break
    }
  }

  const getNextAction = getNextGenerationAction
  const resolveChapterIndex = resolveNextChapterIndex

  async function applyProjectUpdate(projectId: string, updates: Partial<StoryProject>) {
    const projectStore = useProjectStore()
    const saved = await projectStore.updateProject(projectId, updates)
    if (!saved) {
      throw new Error('Failed to persist project update')
    }
  }

  function validateProject(projectId: string) {
    const projectStore = useProjectStore()
    const project = projectStore.projects.find(item => item.id === projectId)
    if (!project) throw new Error('Project not found')
    return project
  }

  async function generateOutline(projectId: string) {
    resetRunState(projectId)
    const project = validateProject(projectId)
    try {
      currentStage.value = 'planning'
      progressMessage.value = 'Generating story outline...'
      const generated = await (pipeline ?? new StoryPipeline()).generateOutline(project)
      await applyProjectUpdate(projectId, {
        outline: generated,
        generationStage: 'chapter-outline',
      })
      markCompletedThrough('planning')
      currentStage.value = 'chapter-outline'
      return generated
    } catch (error: any) {
      addError('planning', error?.message || 'Outline generation failed')
      throw error
    } finally {
      finishRun()
    }
  }

  async function generateCharacters(projectId: string, options: { preferredCount?: number; characterRequirements?: string } = {}) {
    resetRunState(projectId)
    const project = validateProject(projectId)
    try {
      currentStage.value = 'planning'
      progressMessage.value = 'Generating characters...'
      const generated = await (pipeline ?? new StoryPipeline()).generateCharacters(project, options)
      await applyProjectUpdate(projectId, {
        characters: generated,
        generationStage: 'chapter-outline',
      })
      markCompletedThrough('planning')
      currentStage.value = 'chapter-outline'
      return generated
    } catch (error: any) {
      addError('planning', error?.message || 'Character generation failed')
      throw error
    } finally {
      finishRun()
    }
  }

  async function generateStoryPlan(projectId: string) {
    resetRunState(projectId)
    const project = validateProject(projectId)
    try {
      currentStage.value = 'planning'
      progressMessage.value = 'Planning story outline and characters...'
      const result = await (pipeline ?? new StoryPipeline()).generateStoryPlan(
        project,
        appendStreamToken,
        message => { progressMessage.value = message },
        error => { addError('planning', error) },
        async updates => { await applyProjectUpdate(projectId, updates) }
      )
      await applyProjectUpdate(projectId, {
        outline: result.outline,
        characters: result.characters,
        generationStage: 'chapter-outline',
      })
      markCompletedThrough('planning')
      currentStage.value = 'chapter-outline'
      return result
    } catch (error: any) {
      addError('planning', error?.message || 'Story planning failed')
      throw error
    } finally {
      finishRun()
    }
  }

  async function generateChapterPlan(projectId: string) {
    resetRunState(projectId)
    const project = validateProject(projectId)
    try {
      currentStage.value = 'chapter-outline'
      progressMessage.value = 'Planning chapter outlines...'
      const generated = await (pipeline ?? new StoryPipeline()).generateChapterPlan(
        project,
        appendStreamToken,
        message => { progressMessage.value = message },
        error => { addError('chapter-outline', error) },
        async updates => { await applyProjectUpdate(projectId, updates) }
      )
      await applyProjectUpdate(projectId, {
        chapters: generated,
        generationStage: 'writing',
      })
      markCompletedThrough('chapter-outline')
      currentStage.value = 'writing'
      return generated
    } catch (error: any) {
      addError('chapter-outline', error?.message || 'Chapter plan generation failed')
      throw error
    } finally {
      finishRun()
    }
  }

  async function generateAdditionalChapterPlan(projectId: string) {
    resetRunState(projectId)
    const project = validateProject(projectId)
    try {
      currentStage.value = 'chapter-outline'
      progressMessage.value = 'Planning additional chapter outline...'
      const generated = await (pipeline ?? new StoryPipeline()).generateAdditionalChapterPlan(
        project,
        appendStreamToken,
        message => { progressMessage.value = message },
        error => { addError('chapter-outline', error) },
        async updates => { await applyProjectUpdate(projectId, updates) }
      )
      await applyProjectUpdate(projectId, {
        chapters: generated,
        generationStage: project.generationStage === 'idle' || project.generationStage === 'planning'
          ? 'chapter-outline'
          : project.generationStage,
      })
      markCompleted('chapter-outline')
      currentStage.value = 'chapter-outline'
      return generated
    } catch (error: any) {
      addError('chapter-outline', error?.message || 'Additional chapter plan generation failed')
      throw error
    } finally {
      finishRun()
    }
  }

  async function completeCurrentChapterPlan(projectId: string, chapterId?: string) {
    resetRunState(projectId)
    const project = validateProject(projectId)
    const action = getNextGenerationAction(project)
    const targetChapterIndex = chapterId
      ? resolveChapterIndexById(project, chapterId)
      : action.stage === 'chapter-outline' && typeof action.chapterIndex === 'number'
        ? action.chapterIndex
        : -1

    if (targetChapterIndex < 0) {
      throw new Error('No incomplete chapter plan found')
    }

    const targetChapter = project.chapters[targetChapterIndex]
    if (!targetChapter) throw new Error(`Chapter at position ${targetChapterIndex + 1} not found`)

    try {
      currentStage.value = 'chapter-outline'
      currentChapterIndex.value = targetChapterIndex
      progressMessage.value = `Completing chapter ${targetChapter.index + 1} outline...`
      const generated = await (pipeline ?? new StoryPipeline()).completeChapterPlan(
        project,
        targetChapterIndex,
        appendStreamToken,
        message => { progressMessage.value = message },
        error => { addError('chapter-outline', error) },
        async updates => { await applyProjectUpdate(projectId, updates) }
      )
      const allPlansComplete = generated.length > 0 && generated.every(isChapterPlanComplete)
      await applyProjectUpdate(projectId, {
        chapters: generated,
        generationStage: allPlansComplete ? 'writing' : 'chapter-outline',
      })
      if (allPlansComplete) markCompletedThrough('chapter-outline')
      else markCompleted('chapter-outline')
      currentStage.value = allPlansComplete ? 'writing' : 'chapter-outline'
      currentChapterIndex.value = null
      return generated
    } catch (error: any) {
      addError('chapter-outline', error?.message || 'Chapter plan completion failed')
      throw error
    } finally {
      finishRun()
    }
  }

  async function reviewAndRewriteChapterPlan(projectId: string, chapterId: string) {
    resetRunState(projectId)
    const project = validateProject(projectId)
    const targetChapterIndex = resolveChapterIndexById(project, chapterId)
    if (targetChapterIndex < 0) {
      throw new Error('No chapter selected for outline review')
    }

    const targetChapter = project.chapters[targetChapterIndex]
    if (!targetChapter) throw new Error(`Chapter at position ${targetChapterIndex + 1} not found`)

    try {
      currentStage.value = 'chapter-outline'
      currentChapterIndex.value = targetChapterIndex
      progressMessage.value = `Reviewing chapter ${targetChapter.index + 1} outline...`
      const result = await (pipeline ?? new StoryPipeline()).reviewAndRewriteChapterPlan(
        project,
        targetChapterIndex,
        appendStreamToken,
        message => { progressMessage.value = message },
        error => { addError('chapter-outline', error) },
        async updates => { await applyProjectUpdate(projectId, updates) }
      )
      await applyProjectUpdate(projectId, {
        chapters: result.chapters,
        generationStage: result.chapters.every(isChapterPlanComplete) ? 'writing' : 'chapter-outline',
      })
      markCompleted('chapter-outline')
      currentStage.value = 'chapter-outline'
      currentChapterIndex.value = null
      return result
    } catch (error: any) {
      addError('chapter-outline', error?.message || 'Chapter outline review failed')
      throw error
    } finally {
      finishRun()
    }
  }

  async function generateChapterDraftAt(projectId: string, targetChapterIndex: number) {
    const project = validateProject(projectId)
    const targetChapter = project.chapters[targetChapterIndex]
    if (!targetChapter) throw new Error(`Chapter at position ${targetChapterIndex + 1} not found`)

    currentStage.value = 'writing'
    currentChapterIndex.value = targetChapterIndex
    progressMessage.value = `Writing chapter ${targetChapter.index + 1}...`

    const generated = await (pipeline ?? new StoryPipeline()).generateChapterDraft(
      project,
      targetChapterIndex,
      appendStreamToken,
      async (intermediateChapter) => {
        const latestProject = validateProject(projectId)
        const chapters = latestProject.chapters.map((chapter) =>
          chapter.id === targetChapter.id ? intermediateChapter : chapter
        )
        await applyProjectUpdate(projectId, { chapters })
      }
    )
    const latestProject = validateProject(projectId)
    const chapters = latestProject.chapters.map((chapter) => chapter.id === targetChapter.id ? generated : chapter)
    const nextAction = getNextAction({ ...latestProject, chapters })
    await applyProjectUpdate(projectId, {
      chapters,
      generationStage: nextAction.stage === 'done' ? 'done' : nextAction.stage,
    })
    markCompleted('writing')
    currentStage.value = nextAction.stage
    currentChapterIndex.value = null
    return generated
  }

  async function generateChapterDraft(projectId: string, chapterId?: string) {
    resetRunState(projectId)
    const project = validateProject(projectId)
    const targetChapterIndex = chapterId
      ? resolveChapterIndexById(project, chapterId)
      : resolveChapterIndex(project, 'writing')
    if (targetChapterIndex < 0) {
      finishRun()
      throw new Error('No chapter is currently ready for writing')
    }

    try {
      return await generateChapterDraftAt(projectId, targetChapterIndex)
    } catch (error: any) {
      addError('writing', error?.message || 'Writing failed')
      throw error
    } finally {
      finishRun()
    }
  }

  async function generateAllChapterDrafts(projectId: string) {
    resetRunState(projectId)
    try {
      while (!cancelled.value) {
        const project = validateProject(projectId)
        const action = getNextAction(project)
        if (action.stage !== 'writing') return project
        streamContent.value = ''
        await generateChapterDraftAt(projectId, action.chapterIndex)
      }
      return validateProject(projectId)
    } catch (error: any) {
      addError('writing', error?.message || 'Writing failed')
      throw error
    } finally {
      finishRun()
    }
  }

  async function proofreadChapter(projectId: string, chapterId?: string) {
    resetRunState(projectId)
    const project = validateProject(projectId)
    const targetChapterIndex = chapterId
      ? resolveChapterIndexById(project, chapterId)
      : resolveChapterIndex(project, 'proofreading')
    if (targetChapterIndex < 0) {
      finishRun()
      throw new Error('No chapter is currently ready for proofreading')
    }

    try {
      return await proofreadChapterAt(projectId, targetChapterIndex)
    } catch (error: any) {
      addError('proofreading', error?.message || 'Proofreading failed')
      throw error
    } finally {
      finishRun()
    }
  }

  async function auditChapter(projectId: string, chapterIndex: number, mode: 'proofread' | 'edit' = 'proofread'): Promise<ChapterAuditIssue[]> {
    const project = validateProject(projectId)
    const chapter = project.chapters[chapterIndex]
    if (!chapter) throw new Error(`Chapter ${chapterIndex + 1} not found`)

    const { proofreaderAgent } = prepareRuntime()
    const content = chapter.content
    
    const segments = buildProofreadingSegments(content)

    const allIssues: ChapterAuditIssue[] = []
    const knowledgeContext = await buildKnowledgeContextForProject(project, {
      theme: project.theme,
      genre: project.genre,
      targetReader: project.targetReader,
      language: project.language,
      chapterTitle: chapter.title,
      chapterOutline: JSON.stringify(chapter.outline),
      content,
      previousSummary: buildPreviousSummary(project, chapterIndex),
    })

    for (let i = 0; i < segments.length; i++) {
      if (cancelled.value) break
      progressMessage.value = `Auditing chapter ${chapter.index + 1} (Part ${i + 1}/${segments.length})...`

      const context: Record<string, any> = {
        content: segments[i].content,
        chapterTitle: chapter.title,
        chapterNumber: chapter.index + 1,
        chapterOutline: chapter.outline,
        characters: buildCharacterContextForTask(project.characters, mode === 'proofread' ? 'proofreading' : 'polishing'),
        previousSummary: buildPreviousSummary(project, chapterIndex),
        language: project.language,
        style: project.style,
        project,
        writingFormat: project.writingFormat,
        knowledgeContext,
        range: segments[i],
      }

      const segment = segments[i]
      const result = await proofreaderAgent.execute(context)
      if (result.data?.issues) {
        allIssues.push(...result.data.issues.map((issue: ChapterAuditIssue) => ({
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

    return allIssues
  }

  async function fixChapterIssues(projectId: string, chapterIndex: number, issues: ChapterAuditIssue[]): Promise<string> {
    if (!issues.length) {
      const project = validateProject(projectId)
      return project.chapters[chapterIndex]?.content || ''
    }

    const project = validateProject(projectId)
    const chapter = project.chapters[chapterIndex]
    const content = chapter.content

    const issueText = issues.map((issue, index) => [
      `${index + 1}. ${issue.title}`,
      `Severity: ${issue.severity}`,
      `Category: ${issue.category}`,
      issue.excerpt ? `Excerpt: ${issue.excerpt}` : '',
      `Problem: ${issue.explanation}`,
      `Fix: ${issue.suggestedFix}`,
    ].filter(Boolean).join('\n')).join('\n\n')

    const prompt = [
      'Fix the following proofreading findings in the current chapter content.',
      project.writingFormat === 'markdown'
        ? 'Preserve the chapter plan, characters, relationship continuity, and Markdown formatting.'
        : 'Preserve the chapter plan, characters, and relationship continuity. Output Plain Text by default.',
      'Return the full revised chapter content through the replace_chapter_content tool.',
      '',
      `Current Content:\n${content}`,
      '',
      issueText,
    ].join('\n')

    const response = await editChapterWithTool(prompt)
    return response.content
  }

  async function proofreadChapterAt(projectId: string, targetChapterIndex: number) {
    const project = validateProject(projectId)
    const targetChapter = project.chapters[targetChapterIndex]
    if (!targetChapter) throw new Error(`Chapter at position ${targetChapterIndex + 1} not found`)

    currentStage.value = 'proofreading'
    currentChapterIndex.value = targetChapterIndex
    progressMessage.value = `Auditing chapter ${targetChapter.index + 1}...`
    
    const issues = await auditChapter(projectId, targetChapterIndex, 'proofread')
    const latestProject = validateProject(projectId)
    const chapters = latestProject.chapters.map((chapter) =>
      chapter.id === targetChapter.id
        ? { ...chapter, proofreadingIssues: issues, proofreadingIssuesStale: false, status: 'proofread' as const }
        : chapter
    )
    const nextAction = getNextAction({ ...latestProject, chapters })
    await applyProjectUpdate(projectId, {
      chapters,
      generationStage: nextAction.stage === 'done' ? 'done' : nextAction.stage,
    })

    markCompleted('proofreading')
    currentStage.value = 'proofreading' // Stay in proofreading stage if doing one by one
    currentChapterIndex.value = null
    return validateProject(projectId).chapters[targetChapterIndex]
  }

  async function proofreadAllChapters(projectId: string) {
    resetRunState(projectId)
    try {
      while (!cancelled.value) {
        const project = validateProject(projectId)
        const action = getNextAction(project)
        if (action.stage !== 'proofreading') return project
        streamContent.value = ''
        await proofreadChapterAt(projectId, action.chapterIndex)
      }
      return validateProject(projectId)
    } catch (error: any) {
      addError('proofreading', error?.message || 'Proofreading failed')
      throw error
    } finally {
      finishRun()
    }
  }

  async function polishChapter(projectId: string, chapterId?: string, proofreadingIssues?: any[]) {
    resetRunState(projectId)
    const project = validateProject(projectId)
    const targetChapterIndex = chapterId
      ? resolveChapterIndexById(project, chapterId)
      : resolveChapterIndex(project, 'polishing')
    if (targetChapterIndex < 0) {
      finishRun()
      throw new Error('No chapter is currently ready for polishing')
    }

    try {
      return await polishChapterAt(projectId, targetChapterIndex, proofreadingIssues)
    } catch (error: any) {
      addError('polishing', error?.message || 'Polishing failed')
      throw error
    } finally {
      finishRun()
    }
  }

  async function polishChapterAt(projectId: string, targetChapterIndex: number, proofreadingIssues?: any[]) {
    const project = validateProject(projectId)
    const targetChapter = project.chapters[targetChapterIndex]
    if (!targetChapter) throw new Error(`Chapter at position ${targetChapterIndex + 1} not found`)

    currentStage.value = 'polishing'
    currentChapterIndex.value = targetChapterIndex
    progressMessage.value = `Polishing chapter ${targetChapter.index + 1}...`
    const generated = await (pipeline ?? new StoryPipeline()).polishChapter(
      project,
      targetChapterIndex,
      appendStreamToken,
      proofreadingIssues,
      async (intermediateChapter) => {
        const latestProject = validateProject(projectId)
        const chapters = latestProject.chapters.map((chapter) =>
          chapter.id === targetChapter.id ? intermediateChapter : chapter
        )
        await applyProjectUpdate(projectId, {
          chapters,
          generationStage: 'polishing',
        })
      }
    )
    const latestProject = validateProject(projectId)
    const chapters = latestProject.chapters.map((chapter) => chapter.id === targetChapter.id ? generated : chapter)
    const nextAction = getNextAction({ ...project, chapters })
    await applyProjectUpdate(projectId, {
      chapters,
      generationStage: nextAction.stage === 'done' ? 'done' : nextAction.stage,
      status: chapters.every(ch => ch.status === 'polished') ? 'completed' : latestProject.status,
    })
    markCompleted('polishing')
    currentStage.value = nextAction.stage === 'done' ? 'done' : nextAction.stage
    currentChapterIndex.value = null
    return generated
  }

  async function polishAllChapters(projectId: string) {
    resetRunState(projectId)
    try {
      while (!cancelled.value) {
        const project = validateProject(projectId)
        const action = getNextAction(project)
        if (action.stage !== 'polishing') return project
        streamContent.value = ''
        await polishChapterAt(projectId, action.chapterIndex)
      }
      return validateProject(projectId)
    } catch (error: any) {
      addError('polishing', error?.message || 'Polishing failed')
      throw error
    } finally {
      finishRun()
    }
  }

  async function generateAll(projectId: string) {
    resetRunState(projectId, true)
    const projectStore = useProjectStore()
    const project = validateProject(projectId)
    const initialAction = getNextAction(project)
    if (initialAction.stage !== 'done') {
      currentStage.value = initialAction.stage
      currentChapterIndex.value = 'chapterIndex' in initialAction && typeof initialAction.chapterIndex === 'number' ? initialAction.chapterIndex : null
    }
    try {
      const currentPipeline = pipeline ?? new StoryPipeline()
      pipeline = currentPipeline
      const updated = await currentPipeline.run(project, {
        onStageChange: stage => {
          currentStage.value = stage as GenerationStage
          streamContent.value = ''
          currentChapterIndex.value = null
          if (stage !== 'done') markCompleted(stage as GenerationStage)
        },
        onProgress: message => {
          progressMessage.value = message
        },
        onError: error => {
          addError(currentStage.value, error)
        },
        onChapterStart: index => {
          currentChapterIndex.value = index
          streamContent.value = ''
        },
        onChapterComplete: () => {},
        onToken: token => {
          streamContent.value += token
        },
        onIntermediateSave: async (partial) => {
          await projectStore.updateProject(projectId, partial)
        },
      })
      const saved = await projectStore.updateProject(projectId, updated)
      if (!saved) {
        throw new Error('Failed to persist generated project')
      }
      if (!cancelled.value && getNextAction(updated).stage === 'done') {
        completedStages.value = new Set(generationStageOrder)
        currentStage.value = 'done'
      }
      currentChapterIndex.value = null
      return updated
    } finally {
      finishRun()
    }
  }

  async function generateNextStage(projectId: string) {
    const project = validateProject(projectId)
    const action = getNextAction(project)

    if (action.stage === 'done') {
      return project
    }

    switch (action.stage) {
      case 'planning':
        return generateStoryPlan(projectId)
      case 'chapter-outline':
        if (typeof action.chapterIndex === 'number') {
          return completeCurrentChapterPlan(projectId, project.chapters[action.chapterIndex]?.id)
        }
        return generateChapterPlan(projectId)
      case 'writing':
        return generateChapterDraft(projectId)
      case 'proofreading':
        return proofreadChapter(projectId)
      case 'polishing':
        return polishChapter(projectId)
    }
  }

  function cancelGeneration() {
    cancelled.value = true
    pipeline?.cancel()
    isGenerating.value = false
    isFollowingMode.value = false
    currentStage.value = 'idle'
    currentChapterIndex.value = null
    progressMessage.value = ''
    streamContent.value = ''
    pipeline = null
  }

  function clearErrors() {
    errors.value = []
  }

  function beginManualTask(stage: GenerationStage, message: string, chapterIndex: number | null = null) {
    isGenerating.value = true
    cancelled.value = false
    currentStage.value = stage
    progressMessage.value = message
    currentChapterIndex.value = chapterIndex
  }

  function updateManualTask(message: string, chapterIndex: number | null = currentChapterIndex.value) {
    progressMessage.value = message
    currentChapterIndex.value = chapterIndex
  }

  function finishManualTask() {
    isGenerating.value = false
    progressMessage.value = ''
    currentChapterIndex.value = null
  }

  function waitForToolContinuation(request: Omit<ToolContinuationRequest, 'id' | 'continue' | 'stop'>) {
    return new Promise<boolean>((resolve) => {
      const id = `tool-continuation-${Date.now()}-${Math.random().toString(36).slice(2)}`
      toolContinuationRequest.value = {
        ...request,
        id,
        continue: () => {
          if (toolContinuationRequest.value?.id === id) {
            toolContinuationRequest.value = null
          }
          resolve(true)
        },
        stop: () => {
          if (toolContinuationRequest.value?.id === id) {
            toolContinuationRequest.value = null
          }
          resolve(false)
        },
      }
    })
  }

  function getAgentModelRef(role: AgentType): ProviderModelRef {
    const providerStore = useProviderStore()
    providerManager.setProviders(providerStore.providers)

    return providerStore.requireAgentModelRef(role)
  }

  function getModelContextTokens(modelRef: ProviderModelRef): number | null {
    return providerManager.getModelConfigForRef(modelRef)?.model.contextTokens ?? null
  }

  function fitMessagesForModel(messages: ChatMessage[], modelRef: ProviderModelRef, maxTokens: number): ChatMessage[] {
    return fitToContext(messages, getModelContextTokens(modelRef), maxTokens).messages
  }

  function fitToolMessagesForModel(messages: ChatMessage[], modelRef: ProviderModelRef, maxTokens: number): ChatMessage[] {
    return fitMessagesToContextSmart(messages, getModelContextTokens(modelRef), maxTokens, {
      threshold: 0.85,
      preserveRecentGroups: 4,
    }).messages
  }

  function getUsableAgentModelRef(role: AgentType, preferred?: ProviderModelRef | null): ProviderModelRef {
    const providerStore = useProviderStore()
    providerManager.setProviders(providerStore.providers)
    const modelRef = providerStore.getAvailableModelRefForRole(role, preferred)
    if (!modelRef) {
      throw new Error(`No model available for ${role}. Please configure an active provider first.`)
    }
    return modelRef
  }

  async function chatWithAssistant(
    prompt: string,
    modelOverride?: ProviderModelRef | null,
    callbacks?: { onToken?: (token: string) => void; signal?: AbortSignal }
  ): Promise<string> {
    const modelRef = getUsableAgentModelRef('editingAI', modelOverride)

    const messages: ChatMessage[] = [
      { role: 'system', content: injectCustomSystemPrompt('You are a helpful writing assistant. Provide concise, actionable advice to help the user improve their story. Be creative and supportive.') },
      { role: 'user', content: prompt },
    ]

    const fittedMessages = fitMessagesForModel(messages, modelRef, 2048)

    try {
      if (callbacks?.onToken) {
        let streamed = ''
        await providerManager.stream(
          fittedMessages,
          modelRef,
          {
            onToken: token => {
              streamed += token
              callbacks.onToken?.(token)
            },
            onComplete: text => {
              streamed = text
            },
            onError: error => { throw error },
          },
          2048,
          0.7,
          callbacks.signal
        )
        return streamed
      }

      const response = await providerManager.chat(
        fittedMessages,
        modelRef,
        2048,
        0.7
      )
      return response
    } catch (error: any) {
      throw new Error(`Assistant error: ${error?.message || 'Unknown error'}`)
    }
  }

  async function editChapterWithTool(
    prompt: string,
    options: {
      currentContent?: string
      modelRef?: ProviderModelRef | null
      onToolStatus?: (status: { name: string; status: 'running' | 'success' | 'warning' | 'error'; detail?: string; before?: string; after?: string }) => void
      onTodoList?: (state: AgentTodoListState) => void
      onToken?: (token: string) => void
      onReasoningToken?: (token: string) => void
      signal?: AbortSignal
    } = {}
  ): Promise<{ content: string; summary: string; toolName: string }> {
    const modelRef = getUsableAgentModelRef('editingAI', options.modelRef)
    const tools: ToolDefinition[] = [
      getTodoListTool(),
      {
        name: 'insert_todolist_item',
        description: 'Insert a new todo item into the current todo list without resubmitting the whole list. Use this when a complex edit discovers a new required step.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'A unique short id for the new todo item.' },
            title: { type: 'string', description: 'The todo item title.' },
            status: {
              type: 'string',
              enum: ['todo', 'in_progress', 'done', 'blocked'],
              description: 'Initial status for this todo item. Defaults to todo.',
            },
            notes: { type: 'string', description: 'Optional note for this todo item.' },
            afterId: { type: 'string', description: 'Optional existing todo id to insert this item after. If omitted or not found, the item is appended.' },
          },
          required: ['id', 'title'],
        },
      },
      {
        name: 'modify_todolist_item',
        description: 'Modify one existing todo item without resubmitting the whole todo list. Use this to mark an item done, blocked, in progress, or to adjust its note.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The id of the todo item to modify.' },
            status: {
              type: 'string',
              enum: ['todo', 'in_progress', 'done', 'blocked'],
              description: 'Optional next status for this todo item.',
            },
            title: { type: 'string', description: 'Optional replacement title.' },
            notes: { type: 'string', description: 'Optional replacement note.' },
          },
          required: ['id'],
        },
      },
      {
        name: 'get_chapter_word_count',
        description: 'Get the current chapter word/character count using the same counting logic as the editor. Use this before or after edits that target length.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_chapter_region',
        description: 'Read a specific region from the current chapter by line number, paragraph index, or section index before preparing a localized edit.',
        parameters: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              enum: ['lines', 'paragraphs', 'sections'],
              description: 'Region lookup mode.',
            },
            start: {
              type: 'number',
              description: 'One-based start index for lines/paragraphs/sections.',
            },
            end: {
              type: 'number',
              description: 'Optional one-based inclusive end index. Defaults to start.',
            },
          },
          required: ['mode', 'start'],
        },
      },
      {
        name: 'replace_chapter_section',
        description: 'Replace one exact passage in the current chapter while leaving the rest of the chapter unchanged.',
        parameters: {
          type: 'object',
          properties: {
            targetText: {
              type: 'string',
              description: 'The exact current passage to replace. It must appear verbatim in the current chapter content.',
            },
            revisedSectionContent: {
              type: 'string',
              description: 'The revised content for only that passage.',
            },
            summary: {
              type: 'string',
              description: 'A short summary of the localized change made.',
            },
          },
          required: ['targetText', 'revisedSectionContent'],
        },
      },
      {
        name: 'replace_chapter_content',
        description: 'Replace the current chapter content with a complete revised version when the requested edit affects broad structure or many passages.',
        parameters: {
          type: 'object',
          properties: {
            revisedContent: {
              type: 'string',
              description: 'The complete updated chapter content. This must include the full chapter, not a patch or excerpt.',
            },
            summary: {
              type: 'string',
              description: 'A short summary of the changes made.',
            },
          },
          required: ['revisedContent'],
        },
      },
    ]

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: injectCustomSystemPrompt([
          'You are Vibe AI inside a chapter editor.',
          'You must use a tool for every successful edit.',
          'For multi-step edits, call update_todolist first and update it as you inspect, edit, and complete the request.',
          'Use insert_todolist_item when you discover a new necessary step after the todo list already exists.',
          'Use modify_todolist_item to update a single todo item when only one item changes.',
          'Use get_chapter_word_count when the request mentions length, word count, expansion, trimming, or target size.',
          'Prefer replace_chapter_section for localized changes to a paragraph, sentence, dialogue exchange, or short passage.',
          'Use replace_chapter_content only when the request affects broad structure, many passages, or the whole chapter.',
          'For replace_chapter_section, targetText must be copied exactly from the current chapter content.',
          'If you are unsure about the exact targetText, call get_chapter_region first by line, paragraph, or section index.',
          'If a section replacement fails because targetText does not match, use get_chapter_region to inspect the relevant area and retry with exact text.',
          'Do not respond with plain prose when an edit is requested.',
        ].join('\n')),
      },
      { role: 'user', content: prompt },
    ]

    try {
      const currentContent = options.currentContent ?? ''
      const hasCurrentContent = currentContent.trim().length > 0
      const currentMessages = [...messages]
      const toolContext: Record<string, any> = {
        _onTodoListUpdated: options.onTodoList,
      }
      const maxRounds = 6
      let pendingFinalResult: { content: string; summary: string; toolName: string } | null = null

      const getOpenTodos = () => {
        const items = Array.isArray(toolContext._todoList) ? toolContext._todoList : []
        return items.filter((item: any) => item?.status !== 'done' && item?.status !== 'blocked')
      }

      const publishTodoList = async () => {
        if (typeof options.onTodoList !== 'function') return
        await options.onTodoList({
          agent: 'Vibe AI',
          updatedAt: new Date().toISOString(),
          items: Array.isArray(toolContext._todoList) ? toolContext._todoList : [],
        })
      }

      if (!hasCurrentContent) {
        currentMessages.push({
          role: 'user',
          content: [
            'Important: the current chapter content is empty.',
            'get_chapter_region will return an empty region with a warning.',
            'replace_chapter_section can still create content when revisedSectionContent is provided; it will be treated as the full chapter content with a warning.',
            'For a draft, continuation, rewrite, or any broad content change, prefer replace_chapter_content with the complete new chapter text.',
          ].join('\n'),
        })
      }

      for (let round = 0; round < maxRounds; round++) {
        if (pendingFinalResult) {
          const openTodos = getOpenTodos()
          if (!openTodos.length) return pendingFinalResult

          currentMessages.push({
            role: 'user',
            content: `The edit has been prepared, but the todolist is not complete. Call update_todolist now and mark every completed item as done before finishing. Open items: ${openTodos.map((item: any) => `${item.id}: ${item.title} (${item.status})`).join('; ')}`,
          })
        }

        let streamedContent = ''
        const outboundMessages = fitToolMessagesForModel(currentMessages, modelRef, 8192)
        const response = await new Promise<FunctionCallingResponse>((resolve, reject) => {
          providerManager.streamWithTools(
            outboundMessages,
            modelRef,
            tools,
            {
              onToken: token => {
                streamedContent += token
                options.onToken?.(token)
              },
              onReasoningToken: token => {
                options.onReasoningToken?.(token)
              },
              onToolCall: toolCall => {
                options.onToolStatus?.({ name: toolCall.name, status: 'running', detail: 'Preparing tool call.' })
              },
              onToolResult: () => {},
              onComplete: result => {
                resolve(result)
              },
              onError: error => {
                reject(error)
              },
            },
            8192,
            0.5,
            undefined,
            options.signal
          ).catch(reject)
        })

        if (streamedContent && response.content == null) {
          response.content = streamedContent
        }

        if (!response.tool_calls.length) {
          currentMessages.push({
            role: 'assistant',
            content: response.content || null,
            reasoning_content: response.reasoning_content ?? null,
          })
          currentMessages.push({
            role: 'user',
            content: 'Use a tool to complete the edit. For small changes, inspect the needed region with get_chapter_region and then call replace_chapter_section.',
          })
          continue
        }

        currentMessages.push({
          role: 'assistant',
          content: response.content || null,
          reasoning_content: response.reasoning_content ?? null,
          tool_calls: response.tool_calls.map(toolCall => ({
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.arguments),
            },
          })),
        })

        for (const toolCall of response.tool_calls) {
          options.onToolStatus?.({ name: toolCall.name, status: 'running', detail: 'Running tool.' })

          if (isTodoListTool(toolCall.name)) {
            const result = await handleTodoListToolCall(toolCall, toolContext, 'Vibe AI')
            let detail = 'Todo list updated.'
            try {
              const parsed = JSON.parse(result.content)
              if (parsed?.error) detail = parsed.error
              else if (typeof parsed?.done === 'number' && typeof parsed?.total === 'number') detail = `${parsed.done}/${parsed.total} complete.`
            } catch {
              // keep fallback detail
            }
            options.onToolStatus?.({
              name: toolCall.name,
              status: result.content.includes('"ok":false') ? 'error' : 'success',
              detail,
            })
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result.content,
            })
            continue
          }

          if (toolCall.name === 'insert_todolist_item') {
            const items = Array.isArray(toolContext._todoList) ? toolContext._todoList : []
            const id = String(toolCall.arguments?.id ?? '').trim()
            const title = String(toolCall.arguments?.title ?? '').trim()
            const status = ['todo', 'in_progress', 'done', 'blocked'].includes(toolCall.arguments?.status)
              ? toolCall.arguments.status
              : 'todo'
            const notes = typeof toolCall.arguments?.notes === 'string'
              ? toolCall.arguments.notes.trim() || undefined
              : undefined
            const afterId = String(toolCall.arguments?.afterId ?? '').trim()

            let result: any
            if (!id || !title) {
              result = { ok: false, error: 'id and title are required.' }
            } else if (items.some((item: any) => item.id === id)) {
              result = { ok: false, error: `Todo item already exists: ${id}` }
            } else if (items.length >= 12) {
              result = { ok: false, error: 'Todo list cannot contain more than 12 items.' }
            } else if (status === 'in_progress' && items.some((item: any) => item.status === 'in_progress')) {
              result = { ok: false, error: 'Only one todolist item may be in_progress at a time.' }
            } else {
              const newItem = { id, title, status, notes }
              const insertIndex = afterId ? items.findIndex((item: any) => item.id === afterId) : -1
              const nextItems = [...items]
              if (insertIndex >= 0) nextItems.splice(insertIndex + 1, 0, newItem)
              else nextItems.push(newItem)
              toolContext._todoList = nextItems
              await publishTodoList()
              result = { ok: true, item: newItem, total: nextItems.length }
            }

            options.onToolStatus?.({
              name: toolCall.name,
              status: result.ok ? 'success' : 'error',
              detail: result.ok ? `${result.item.id}: ${result.item.title}` : result.error,
            })
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            })
            continue
          }

          if (toolCall.name === 'modify_todolist_item') {
            const items = Array.isArray(toolContext._todoList) ? toolContext._todoList : []
            const targetId = String(toolCall.arguments?.id ?? '').trim()
            const index = items.findIndex((item: any) => item.id === targetId)
            if (!targetId || index === -1) {
              const result = { ok: false, error: targetId ? `Todo item not found: ${targetId}` : 'id is required.' }
              options.onToolStatus?.({ name: toolCall.name, status: 'error', detail: result.error })
              currentMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(result),
              })
              continue
            }

            const nextStatus = ['todo', 'in_progress', 'done', 'blocked'].includes(toolCall.arguments?.status)
              ? toolCall.arguments.status
              : items[index].status
            if (nextStatus === 'in_progress' && items.some((item: any, itemIndex: number) => itemIndex !== index && item.status === 'in_progress')) {
              const result = { ok: false, error: 'Only one todolist item may be in_progress at a time.' }
              options.onToolStatus?.({ name: toolCall.name, status: 'error', detail: result.error })
              currentMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(result),
              })
              continue
            }

            items[index] = {
              ...items[index],
              title: typeof toolCall.arguments?.title === 'string' && toolCall.arguments.title.trim()
                ? toolCall.arguments.title.trim()
                : items[index].title,
              status: nextStatus,
              notes: typeof toolCall.arguments?.notes === 'string'
                ? toolCall.arguments.notes.trim() || undefined
                : items[index].notes,
            }
            toolContext._todoList = items
            await publishTodoList()
            const result = { ok: true, item: items[index] }
            options.onToolStatus?.({ name: toolCall.name, status: 'success', detail: `${targetId}: ${nextStatus}` })
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            })
            continue
          }

          if (toolCall.name === 'get_chapter_word_count') {
            const countSource = pendingFinalResult?.content ?? currentContent
            const result = {
              ok: true,
              words: countWords(countSource),
              characters: countSource.length,
              nonWhitespaceCharacters: countSource.replace(/\s/g, '').length,
            }
            options.onToolStatus?.({ name: toolCall.name, status: 'success', detail: `${result.words} words.` })
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            })
            continue
          }

          if (toolCall.name === 'get_chapter_region') {
            const result = getChapterRegion(currentContent, toolCall.arguments)
            const warning = 'warning' in result && typeof result.warning === 'string' ? result.warning : ''
            options.onToolStatus?.({
              name: toolCall.name,
              status: result.ok ? (warning ? 'warning' : 'success') : 'error',
              detail: result.ok && 'label' in result ? (warning || result.label) : result.error,
            })
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            })
            if (result.ok && warning && !hasCurrentContent) {
              currentMessages.push({
                role: 'user',
                content: 'The chapter is empty, so the region lookup returned an empty region as a warning. You can continue by calling replace_chapter_content, or use replace_chapter_section with revisedSectionContent to create the initial content.',
              })
            }
            continue
          }

          if (toolCall.name === 'replace_chapter_section') {
            const targetText = typeof toolCall.arguments?.targetText === 'string'
              ? toolCall.arguments.targetText
              : ''
            const revisedSectionContent = typeof toolCall.arguments?.revisedSectionContent === 'string'
              ? toolCall.arguments.revisedSectionContent
              : ''

            if (!hasCurrentContent && revisedSectionContent.trim()) {
              options.onToolStatus?.({
                name: toolCall.name,
                status: 'warning',
                detail: 'Chapter was empty; used the section replacement as the full chapter content.',
                before: currentContent,
                after: revisedSectionContent.trim(),
              })
              pendingFinalResult = {
                content: revisedSectionContent.trim(),
                summary: typeof toolCall.arguments?.summary === 'string'
                  ? toolCall.arguments.summary.trim()
                  : 'Created chapter content from a section replacement.',
                toolName: 'replace_chapter_section',
              }
              if (!getOpenTodos().length) return pendingFinalResult
              continue
            }

            if (!targetText || !revisedSectionContent || !currentContent.includes(targetText)) {
              const result = {
                ok: false,
                error: 'The targetText did not match the current chapter exactly. Use get_chapter_region to inspect the relevant lines, paragraphs, or sections, then retry replace_chapter_section with exact targetText.',
              }
              options.onToolStatus?.({ name: toolCall.name, status: 'error', detail: result.error })
              currentMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(result),
              })
              continue
            }

            options.onToolStatus?.({
              name: toolCall.name,
              status: 'success',
              detail: 'Matched and replaced one passage.',
              before: targetText,
              after: revisedSectionContent.trim(),
            })
            pendingFinalResult = {
              content: currentContent.replace(targetText, revisedSectionContent.trim()),
              summary: typeof toolCall.arguments?.summary === 'string' ? toolCall.arguments.summary.trim() : '',
              toolName: 'replace_chapter_section',
            }
            if (!getOpenTodos().length) return pendingFinalResult
            continue
          }

          if (toolCall.name === 'replace_chapter_content') {
            const revisedContent = typeof toolCall.arguments?.revisedContent === 'string'
              ? toolCall.arguments.revisedContent.trim()
              : ''
            if (!revisedContent) {
              const result = { ok: false, error: 'revisedContent is required.' }
              options.onToolStatus?.({ name: toolCall.name, status: 'error', detail: result.error })
              currentMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(result),
              })
              continue
            }

            options.onToolStatus?.({
              name: toolCall.name,
              status: 'success',
              detail: 'Prepared a complete chapter replacement.',
              before: currentContent,
              after: revisedContent,
            })
            pendingFinalResult = {
              content: revisedContent,
              summary: typeof toolCall.arguments?.summary === 'string' ? toolCall.arguments.summary.trim() : '',
              toolName: 'replace_chapter_content',
            }
            if (!getOpenTodos().length) return pendingFinalResult
            continue
          }

          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ ok: false, error: `Unsupported tool: ${toolCall.name}` }),
          })
        }
      }

      if (pendingFinalResult && !getOpenTodos().length) return pendingFinalResult
      throw new Error('Vibe AI could not complete the tool edit after retrying.')
    } catch (error: any) {
      options.onToolStatus?.({ name: 'replace_chapter_content', status: 'error', detail: error?.message || 'Unknown error' })
      throw new Error(`Tool edit error: ${error?.message || 'Unknown error'}`)
    }
  }

  async function editChapterOutlineWithTool(
    prompt: string,
    options: {
      currentTitle?: string
      currentOutline?: ChapterOutline
      modelRef?: ProviderModelRef | null
      onToolStatus?: (status: { name: string; status: 'running' | 'success' | 'warning' | 'error'; detail?: string; before?: string; after?: string }) => void
      onTodoList?: (state: AgentTodoListState) => void
      onToken?: (token: string) => void
      onReasoningToken?: (token: string) => void
      signal?: AbortSignal
    } = {}
  ): Promise<{ title: string; outline: ChapterOutline; summary: string; toolName: string }> {
    const modelRef = getUsableAgentModelRef('editingAI', options.modelRef)
    const listFields = new Set(['keyEvents', 'characterActions', 'infoReveals'])
    const scalarFields = new Set(['title', 'objective', 'conflict', 'endingHook'])
    const currentState = {
      title: options.currentTitle || 'Untitled',
      outline: {
        objective: options.currentOutline?.objective || '',
        conflict: options.currentOutline?.conflict || '',
        keyEvents: Array.isArray(options.currentOutline?.keyEvents) ? [...options.currentOutline.keyEvents] : [],
        characterActions: Array.isArray(options.currentOutline?.characterActions) ? [...options.currentOutline.characterActions] : [],
        infoReveals: Array.isArray(options.currentOutline?.infoReveals) ? [...options.currentOutline.infoReveals] : [],
        endingHook: options.currentOutline?.endingHook || '',
      },
    }

    const outlineToText = (state = currentState) => [
      `Title: ${state.title}`,
      `Objective: ${state.outline.objective}`,
      `Conflict: ${state.outline.conflict}`,
      `Key Events:\n${state.outline.keyEvents.map(item => `- ${item}`).join('\n')}`,
      `Character Actions:\n${state.outline.characterActions.map(item => `- ${item}`).join('\n')}`,
      `Info Reveals:\n${state.outline.infoReveals.map(item => `- ${item}`).join('\n')}`,
      `Ending Hook: ${state.outline.endingHook}`,
    ].join('\n')

    const cloneResult = (summary: string, toolName: string) => ({
      title: currentState.title,
      outline: JSON.parse(JSON.stringify(currentState.outline)) as ChapterOutline,
      summary,
      toolName,
    })

    const normalizeList = (value: unknown, fallback: string[] = []) => {
      if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
      if (typeof value === 'string') {
        return value
          .split(/\r?\n|,/)
          .map(item => item.replace(/^\s*[-*]\s+/, '').trim())
          .filter(Boolean)
      }
      return fallback
    }

    const tools: ToolDefinition[] = [
      getTodoListTool(),
      {
        name: 'get_chapter_outline',
        description: 'Read the current chapter outline or one specific outline field before editing it.',
        parameters: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              enum: ['all', 'title', 'objective', 'conflict', 'keyEvents', 'characterActions', 'infoReveals', 'endingHook'],
              description: 'The outline field to read. Defaults to all.',
            },
          },
          required: [],
        },
      },
      {
        name: 'replace_chapter_outline_field',
        description: 'Replace one exact chapter outline field. Use this for localized outline edits.',
        parameters: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              enum: ['title', 'objective', 'conflict', 'keyEvents', 'characterActions', 'infoReveals', 'endingHook'],
            },
            value: {
              type: 'string',
              description: 'Replacement text for scalar fields, or newline-separated list items for list fields.',
            },
            items: {
              type: 'array',
              description: 'Replacement list items for keyEvents, characterActions, or infoReveals.',
              items: { type: 'string' },
            },
            summary: { type: 'string' },
          },
          required: ['field'],
        },
      },
      {
        name: 'rewrite_chapter_outline',
        description: 'Replace the complete chapter outline when the request affects multiple planning fields.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            objective: { type: 'string' },
            conflict: { type: 'string' },
            keyEvents: { type: 'array', items: { type: 'string' } },
            characterActions: { type: 'array', items: { type: 'string' } },
            infoReveals: { type: 'array', items: { type: 'string' } },
            endingHook: { type: 'string' },
            summary: { type: 'string' },
          },
          required: ['objective', 'conflict', 'keyEvents', 'characterActions', 'infoReveals', 'endingHook'],
        },
      },
    ]

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: injectCustomSystemPrompt([
          'You are Vibe AI inside a chapter outline editor.',
          'You must use tools for every successful outline edit.',
          'Use get_chapter_outline before editing if the exact field content matters.',
          'Prefer replace_chapter_outline_field when the user asks to adjust one field or one list.',
          'Use rewrite_chapter_outline when multiple fields need coordinated changes.',
          'Never edit chapter prose. These tools only modify title and outline fields.',
          'Do not reply with the revised outline in plain text. Complete the edit by calling an outline replacement tool.',
        ].join('\n')),
      },
      { role: 'user', content: prompt },
    ]

    try {
      const currentMessages = [...messages]
      const toolContext: Record<string, any> = {
        _onTodoListUpdated: options.onTodoList,
      }
      const getOpenTodos = () => {
        const items = Array.isArray(toolContext._todoList) ? toolContext._todoList : []
        return items.filter((item: any) => item?.status !== 'done' && item?.status !== 'blocked')
      }
      const publishTodoList = async () => {
        if (typeof options.onTodoList !== 'function') return
        await options.onTodoList({
          agent: 'Vibe AI',
          updatedAt: new Date().toISOString(),
          items: Array.isArray(toolContext._todoList) ? toolContext._todoList : [],
        })
      }

      let pendingFinalResult: { title: string; outline: ChapterOutline; summary: string; toolName: string } | null = null
      for (let round = 0; round < 6; round++) {
        if (pendingFinalResult) {
          const openTodos = getOpenTodos()
          if (!openTodos.length) return pendingFinalResult
          currentMessages.push({
            role: 'user',
            content: `The outline edit is prepared, but the todolist is not complete. Mark completed items done before finishing. Open items: ${openTodos.map((item: any) => `${item.id}: ${item.title} (${item.status})`).join('; ')}`,
          })
        }

        let streamedContent = ''
        const outboundMessages = fitToolMessagesForModel(currentMessages, modelRef, 4096)
        const response = await new Promise<FunctionCallingResponse>((resolve, reject) => {
          providerManager.streamWithTools(
            outboundMessages,
            modelRef,
            tools,
            {
              onToken: token => {
                streamedContent += token
                options.onToken?.(token)
              },
              onReasoningToken: token => options.onReasoningToken?.(token),
              onToolCall: toolCall => options.onToolStatus?.({ name: toolCall.name, status: 'running', detail: 'Preparing tool call.' }),
              onToolResult: () => {},
              onComplete: resolve,
              onError: reject,
            },
            4096,
            0.35,
            undefined,
            options.signal
          ).catch(reject)
        })

        if (streamedContent && response.content == null) response.content = streamedContent

        if (!response.tool_calls.length) {
          currentMessages.push({ role: 'assistant', content: response.content || null, reasoning_content: response.reasoning_content ?? null })
          currentMessages.push({ role: 'user', content: 'Use an outline tool to complete the request. Do not return outline text directly.' })
          continue
        }

        currentMessages.push({
          role: 'assistant',
          content: response.content || null,
          reasoning_content: response.reasoning_content ?? null,
          tool_calls: response.tool_calls.map(toolCall => ({
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.arguments),
            },
          })),
        })

        for (const toolCall of response.tool_calls) {
          options.onToolStatus?.({ name: toolCall.name, status: 'running', detail: 'Running tool.' })

          if (isTodoListTool(toolCall.name)) {
            const result = await handleTodoListToolCall(toolCall, toolContext, 'Vibe AI')
            await publishTodoList()
            options.onToolStatus?.({ name: toolCall.name, status: result.content.includes('"ok":false') ? 'error' : 'success', detail: 'Todo list updated.' })
            currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: result.content })
            continue
          }

          if (toolCall.name === 'get_chapter_outline') {
            const field = String(toolCall.arguments?.field || 'all')
            const value = field === 'all'
              ? outlineToText()
              : field === 'title'
                ? currentState.title
                : listFields.has(field)
                  ? (currentState.outline as any)[field].join('\n')
                  : scalarFields.has(field)
                    ? (currentState.outline as any)[field]
                    : ''
            const result = value || field === 'all'
              ? { ok: true, field, content: value }
              : { ok: false, error: `Unknown outline field: ${field}` }
            options.onToolStatus?.({
              name: toolCall.name,
              status: result.ok ? 'success' : 'error',
              detail: result.ok ? `Read ${field}.` : result.error,
            })
            currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) })
            continue
          }

          if (toolCall.name === 'replace_chapter_outline_field') {
            const field = String(toolCall.arguments?.field || '')
            if (!scalarFields.has(field) && !listFields.has(field)) {
              const result = { ok: false, error: `Unknown outline field: ${field}` }
              options.onToolStatus?.({ name: toolCall.name, status: 'error', detail: result.error })
              currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) })
              continue
            }

            const before = field === 'title'
              ? currentState.title
              : listFields.has(field)
                ? (currentState.outline as any)[field].join('\n')
                : (currentState.outline as any)[field]

            if (field === 'title') {
              currentState.title = String(toolCall.arguments?.value ?? '').trim() || currentState.title
            } else if (listFields.has(field)) {
              ;(currentState.outline as any)[field] = normalizeList(toolCall.arguments?.items ?? toolCall.arguments?.value, (currentState.outline as any)[field])
            } else {
              ;(currentState.outline as any)[field] = String(toolCall.arguments?.value ?? '').trim()
            }

            const after = field === 'title'
              ? currentState.title
              : listFields.has(field)
                ? (currentState.outline as any)[field].join('\n')
                : (currentState.outline as any)[field]
            const result = { ok: true, field, title: currentState.title, outline: currentState.outline }
            options.onToolStatus?.({
              name: toolCall.name,
              status: 'success',
              detail: `Updated ${field}.`,
              before,
              after,
            })
            pendingFinalResult = cloneResult(typeof toolCall.arguments?.summary === 'string' ? toolCall.arguments.summary.trim() : `Updated ${field}.`, toolCall.name)
            currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) })
            if (!getOpenTodos().length) return pendingFinalResult
            continue
          }

          if (toolCall.name === 'rewrite_chapter_outline') {
            const before = outlineToText()
            currentState.title = String(toolCall.arguments?.title ?? currentState.title).trim() || currentState.title
            currentState.outline = {
              objective: String(toolCall.arguments?.objective ?? '').trim(),
              conflict: String(toolCall.arguments?.conflict ?? '').trim(),
              keyEvents: normalizeList(toolCall.arguments?.keyEvents),
              characterActions: normalizeList(toolCall.arguments?.characterActions),
              infoReveals: normalizeList(toolCall.arguments?.infoReveals),
              endingHook: String(toolCall.arguments?.endingHook ?? '').trim(),
            }
            const after = outlineToText()
            const result = { ok: true, title: currentState.title, outline: currentState.outline }
            options.onToolStatus?.({
              name: toolCall.name,
              status: 'success',
              detail: 'Prepared complete outline revision.',
              before,
              after,
            })
            pendingFinalResult = cloneResult(typeof toolCall.arguments?.summary === 'string' ? toolCall.arguments.summary.trim() : 'Rewrote chapter outline.', toolCall.name)
            currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) })
            if (!getOpenTodos().length) return pendingFinalResult
            continue
          }

          currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ ok: false, error: `Unsupported tool: ${toolCall.name}` }) })
        }
      }

      if (pendingFinalResult && !getOpenTodos().length) return pendingFinalResult
      throw new Error('Vibe AI could not complete the outline edit after retrying.')
    } catch (error: any) {
      options.onToolStatus?.({ name: 'rewrite_chapter_outline', status: 'error', detail: error?.message || 'Unknown error' })
      throw new Error(`Outline edit error: ${error?.message || 'Unknown error'}`)
    }
  }

  async function auditChapterWithTool(prompt: string, projectId?: string): Promise<ChapterAuditIssue[]> {
    const modelRef = getAgentModelRef('editingAI')
    const project = projectId ? validateProject(projectId) : null
    const tools: ToolDefinition[] = [
      ...getRelationshipQueryTools(),
      getChapterIssueReportTool(),
    ]

    const messages: ChatMessage[] = [
      { role: 'system', content: getEditingAuditSystemPrompt() },
      { role: 'user', content: prompt },
    ]

    try {
      const response = await chatWithRelationshipTools(messages, modelRef, tools, {
        project,
        finalToolNames: ['report_chapter_issues'],
        contextTokens: getModelContextTokens(modelRef),
        maxTokens: 4096,
        temperature: 0.2,
        maxRounds: useProviderStore().toolWorkflowSettings.maxToolCallRounds,
        requestContinuation: waitForToolContinuation,
      })
      const toolCall = getToolCall(response.tool_calls, 'report_chapter_issues')
      const rawIssues = Array.isArray(toolCall?.arguments?.issues) ? toolCall.arguments.issues : []

      return mapEditingAuditIssues(rawIssues)
    } catch (error: any) {
      throw new Error(`Tool audit error: ${error?.message || 'Unknown error'}`)
    }
  }

  async function proofreadChapterWithTool(prompt: string, projectId?: string): Promise<ChapterAuditIssue[]> {
    const modelRef = getAgentModelRef('proofreader')
    const project = projectId ? validateProject(projectId) : null
    const tools = getProofreadingTools()

    const messages: ChatMessage[] = [
      { role: 'system', content: getProofreadingSystemPrompt() },
      { role: 'user', content: prompt },
    ]

    try {
      const response = await chatWithRelationshipTools(messages, modelRef, tools, {
        project,
        finalToolNames: ['report_proofreading_issues'],
        contextTokens: getModelContextTokens(modelRef),
        maxTokens: 4096,
        temperature: 0.2,
        maxRounds: useProviderStore().toolWorkflowSettings.maxToolCallRounds,
        requestContinuation: waitForToolContinuation,
      })
      const toolCall = getToolCall(response.tool_calls, 'report_proofreading_issues')
      const rawIssues = Array.isArray(toolCall?.arguments?.issues) ? toolCall.arguments.issues : []

      return mapProofreadingIssues(rawIssues)
    } catch (error: any) {
      throw new Error(`Proofreading error: ${error?.message || 'Unknown error'}`)
    }
  }

  async function proofreadChapterWithToolChunked(
    prompt: string,
    projectId?: string,
    options?: {
      onSegmentStart?: (payload: {
        segmentIndex: number
        segmentTotal: number
      }) => Promise<void> | void
      onSegmentComplete?: (payload: {
        segmentIndex: number
        segmentTotal: number
        segmentIssues: ChapterAuditIssue[]
        allIssues: ChapterAuditIssue[]
      }) => Promise<void> | void
    }
  ): Promise<ChapterAuditIssue[]> {
    const chunks = buildSegmentedProofreadingPrompts(prompt)
    const issues: ChapterAuditIssue[] = []
    for (let index = 0; index < chunks.length; index++) {
      if (cancelled.value) break
      progressMessage.value = `Proofreading segment ${index + 1}/${chunks.length}...`
      const chunkIssues = await proofreadChapterWithTool(chunks[index].prompt, projectId)
      const range = chunks[index].range
      const segmentIssues = chunkIssues.map(issue => ({
        ...issue,
        id: `${issue.id}-part-${index + 1}`,
        segmentIndex: range.index,
        segmentTotal: range.total,
        segmentCharStart: range.charStart,
        segmentCharEnd: range.charEnd,
        segmentTokenStart: range.tokenStart,
        segmentTokenEnd: range.tokenEnd,
        segmentTokenTotal: range.tokenTotal,
      }))
      issues.push(...segmentIssues)
      await options?.onSegmentComplete?.({
        segmentIndex: index,
        segmentTotal: chunks.length,
        segmentIssues,
        allIssues: [...issues],
      })
    }
    return issues
  }

  async function proofreadChapterContentWithTool(
    contextPrompt: string,
    content: string,
    projectId?: string,
    options?: {
      modelRef?: ProviderModelRef | null
      onSegmentStart?: (payload: {
        segmentIndex: number
        segmentTotal: number
      }) => Promise<void> | void
      onSegmentComplete?: (payload: {
        segmentIndex: number
        segmentTotal: number
        segmentIssues: ChapterAuditIssue[]
        allIssues: ChapterAuditIssue[]
      }) => Promise<void> | void
    }
  ): Promise<ChapterAuditIssue[]> {
    const segments = buildProofreadingSegments(content)
    const issues: ChapterAuditIssue[] = []
    const prefix = contextPrompt.trim()
    const modelRef = getUsableAgentModelRef('proofreader', options?.modelRef)
    const project = projectId ? validateProject(projectId) : null
    const tools = getProofreadingTools()

    for (let index = 0; index < segments.length; index++) {
      if (cancelled.value) break
      const segment = segments[index]
      progressMessage.value = `Proofreading segment ${index + 1}/${segments.length}...`
      await options?.onSegmentStart?.({
        segmentIndex: index,
        segmentTotal: segments.length,
      })
      const segmentPrompt = [
        prefix,
        '',
        `Current Chapter Segment ${segment.index + 1}/${segment.total}:`,
        `Estimated token range: ${segment.tokenStart}-${segment.tokenEnd} of ${segment.tokenTotal}.`,
        'Task: inspect this segment line by line and call report_proofreading_issues. Report grammar, typo, wording, punctuation, consistency, pacing, and logic issues with exact excerpts from this segment. Use an empty issues array only when this segment has no concrete issues.',
        '',
        'Segment Text:',
        segment.content,
      ].join('\n')
      const messages: ChatMessage[] = [
        { role: 'system', content: getProofreadingSystemPrompt() },
        { role: 'user', content: segmentPrompt },
      ]
      const response = await chatWithRelationshipToolsInPlace(messages, modelRef, tools, {
        project,
        finalToolNames: ['report_proofreading_issues'],
        contextTokens: getModelContextTokens(modelRef),
        maxTokens: 4096,
        temperature: 0.2,
        maxRounds: useProviderStore().toolWorkflowSettings.maxToolCallRounds,
        requestContinuation: waitForToolContinuation,
        finalToolResultContent: toolCall => JSON.stringify({
          ok: true,
          segment: `${segment.index + 1}/${segment.total}`,
          issueCount: Array.isArray(toolCall.arguments?.issues) ? toolCall.arguments.issues.length : 0,
        }),
      })
      const toolCall = getToolCall(response.tool_calls, 'report_proofreading_issues')
      const rawIssues = Array.isArray(toolCall?.arguments?.issues) ? toolCall.arguments.issues : []
      const chunkIssues = mapProofreadingIssues(rawIssues)
      const segmentIssues = chunkIssues.map(issue => ({
        ...issue,
        id: `${issue.id}-part-${index + 1}`,
        segmentIndex: segment.index,
        segmentTotal: segment.total,
        segmentCharStart: segment.charStart,
        segmentCharEnd: segment.charEnd,
        segmentTokenStart: segment.tokenStart,
        segmentTokenEnd: segment.tokenEnd,
        segmentTokenTotal: segment.tokenTotal,
      }))
      issues.push(...segmentIssues)
      await options?.onSegmentComplete?.({
        segmentIndex: index,
        segmentTotal: segments.length,
        segmentIssues,
        allIssues: [...issues],
      })
    }

    return issues
  }

  async function saveChapterProofreadingIssues(
    projectId: string,
    chapterId: string,
    issues: ChapterAuditIssue[],
    contentFallback = ''
  ) {
    const project = validateProject(projectId)
    const chapters = project.chapters.map(chapter =>
      chapter.id === chapterId
        ? {
            ...chapter,
            proofreadingIssues: issues,
            proofreadingIssuesStale: false,
            status: 'proofread' as const,
          }
        : chapter
    )
    await applyProjectUpdate(projectId, { chapters })
  }

  return {
    isGenerating,
    currentStage,
    progressMessage,
    streamContent,
    errors,
    isFollowingMode,
    currentChapterIndex,
    toolContinuationRequest,
    completedStages,
    isStageComplete,
    getNextAction,
    generateOutline,
    generateCharacters,
    generateStoryPlan,
    generateChapterPlan,
    generateAdditionalChapterPlan,
    completeCurrentChapterPlan,
    reviewAndRewriteChapterPlan,
    generateChapterDraft,
    generateAllChapterDrafts,
    proofreadChapter,
    polishChapter,
    generateAll,
    generateNextStage,
    cancelGeneration,
    clearErrors,
    beginManualTask,
    updateManualTask,
    finishManualTask,
    chatWithAssistant,
    editChapterWithTool,
    editChapterOutlineWithTool,
    auditChapterWithTool,
    proofreadChapterWithTool,
    proofreadChapterWithToolChunked,
    proofreadChapterContentWithTool,
    saveChapterProofreadingIssues,
    proofreadAllChapters,
    polishAllChapters,
    markCompleted,
    markCompletedThrough,
  }
})
