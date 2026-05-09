import { defineStore } from 'pinia'
import { ref } from 'vue'
import { StoryPipeline } from '@/services/pipeline'
import { prepareRuntime, buildKnowledgeContextForProject } from '@/services/pipeline/runtime'
import { buildPreviousSummary, buildCharacterContextForTask } from '@/services/pipeline/context'
import { useProjectStore } from '@/stores/project'
import { useProviderStore } from '@/stores/provider'
import { providerManager } from '@/services/provider'
import { getRelationshipQueryTools, handleRelationshipQueryTool } from '@/services/relationship/tools'
import { setToolContinuationHandler } from '@/services/agent/toolContinuation'
import { buildProofreadingSegments, buildSegmentedProofreadingPrompts } from '@/services/proofreading/chunking'
import type { GenerationStage, StoryProject } from '@/types/project'
import type { AgentType } from '@/types/agent'
import type { ChatMessage } from '@/types/provider'
import type { ProviderModelRef } from '@/types/provider'
import type { ToolDefinition, ToolCall } from '@/services/provider'

export interface ChapterAuditIssue {
  id: string
  severity: 'low' | 'medium' | 'high'
  category: 'chapter_plan' | 'character' | 'relationship' | 'continuity' | 'factual' | 'logic' | 'style' | 'grammar' | 'typo' | 'pacing' | 'consistency'
  title: string
  excerpt: string
  explanation: string
  suggestedFix: string
  ignored?: boolean
  adjustment?: string
  polishStatus?: 'pending' | 'fixed' | 'ignored' | 'failed'
  polishResult?: string
  segmentIndex?: number
  segmentTotal?: number
  segmentCharStart?: number
  segmentCharEnd?: number
  segmentTokenStart?: number
  segmentTokenEnd?: number
  segmentTokenTotal?: number
}

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

type NextAction =
  | { stage: 'planning' }
  | { stage: 'chapter-outline' }
  | { stage: 'writing'; chapterIndex: number }
  | { stage: 'proofreading'; chapterIndex: number }
  | { stage: 'polishing'; chapterIndex: number }
  | { stage: 'done' }

const stageOrder: GenerationStage[] = [
  'planning',
  'chapter-outline',
  'writing',
  'proofreading',
  'polishing',
]

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
    for (const item of stageOrder) {
      markCompleted(item)
      if (item === stage) break
    }
  }

  function findNextChapterPosition(
    chapters: StoryProject['chapters'],
    predicate: (chapter: StoryProject['chapters'][number]) => boolean | string
  ) {
    let nextIndex = -1
    for (let index = 0; index < chapters.length; index++) {
      if (!predicate(chapters[index])) continue
      if (nextIndex === -1 || chapters[index].index < chapters[nextIndex].index) {
        nextIndex = index
      }
    }
    return nextIndex
  }

  function getNextAction(project: StoryProject): NextAction {
    if (!project.outline.trim() || !project.characters.length) return { stage: 'planning' }
    if (!project.chapters.length || project.chapters.some(ch => !ch.outline.objective || !ch.outline.endingHook)) {
      return { stage: 'chapter-outline' }
    }

    const writingIndex = findNextChapterPosition(project.chapters, ch => !ch.content.trim())
    if (writingIndex !== -1) return { stage: 'writing', chapterIndex: writingIndex }

    const proofreadingIndex = findNextChapterPosition(project.chapters, ch => ch.content.trim() && !ch.proofreadContent.trim())
    if (proofreadingIndex !== -1) return { stage: 'proofreading', chapterIndex: proofreadingIndex }

    const polishingIndex = findNextChapterPosition(project.chapters, ch => (ch.proofreadContent.trim() || ch.content.trim()) && !ch.polishedContent.trim())
    if (polishingIndex !== -1) return { stage: 'polishing', chapterIndex: polishingIndex }

    return { stage: 'done' }
  }

  function resolveChapterIndex(project: StoryProject, stage: Exclude<NextAction['stage'], 'planning' | 'chapter-outline' | 'done'>) {
    const action = getNextAction(project)
    return action.stage === stage ? action.chapterIndex : -1
  }

  function resolveChapterIndexById(project: StoryProject, chapterId: string) {
    return project.chapters.findIndex(chapter => chapter.id === chapterId)
  }

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

  async function generateCharacters(projectId: string) {
    resetRunState(projectId)
    const project = validateProject(projectId)
    try {
      currentStage.value = 'planning'
      progressMessage.value = 'Generating characters...'
      const generated = await (pipeline ?? new StoryPipeline()).generateCharacters(project)
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
        updates => applyProjectUpdate(projectId, updates)
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
      const generated = await (pipeline ?? new StoryPipeline()).generateChapterPlan(project)
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
    const content = chapter.proofreadContent || chapter.content
    
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
      return project.chapters[chapterIndex]?.proofreadContent || project.chapters[chapterIndex]?.content || ''
    }

    const project = validateProject(projectId)
    const chapter = project.chapters[chapterIndex]
    const content = chapter.proofreadContent || chapter.content

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
    
    // 1. Audit
    const issues = await auditChapter(projectId, targetChapterIndex, 'proofread')
    
    if (issues.length > 0) {
      progressMessage.value = `Fixing ${issues.length} issues in chapter ${targetChapter.index + 1}...`
      // 2. Fix
      const correctedContent = await fixChapterIssues(projectId, targetChapterIndex, issues)
      
      const latestProject = validateProject(projectId)
      const chapters = latestProject.chapters.map((chapter) => 
        chapter.id === targetChapter.id 
          ? { ...chapter, proofreadContent: correctedContent, status: 'proofread' as const } 
          : chapter
      )
      const nextAction = getNextAction({ ...project, chapters })
      await applyProjectUpdate(projectId, {
        chapters,
        generationStage: nextAction.stage === 'done' ? 'done' : nextAction.stage,
      })
    } else {
      // Mark as proofread even if no issues found
      const latestProject = validateProject(projectId)
      const chapters = latestProject.chapters.map((chapter) => 
        chapter.id === targetChapter.id 
          ? { ...chapter, proofreadContent: chapter.content, status: 'proofread' as const } 
          : chapter
      )
      await applyProjectUpdate(projectId, { chapters })
    }

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
    const generated = await (pipeline ?? new StoryPipeline()).polishChapter(project, targetChapterIndex, appendStreamToken, proofreadingIssues)
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
      currentChapterIndex.value = 'chapterIndex' in initialAction ? initialAction.chapterIndex : null
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
        completedStages.value = new Set(stageOrder)
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

  function getToolCall(toolCalls: ToolCall[], name: string) {
    return toolCalls.find(toolCall => toolCall.name === name) ?? null
  }

  async function chatWithRelationshipTools(
    messages: ChatMessage[],
    modelRef: ProviderModelRef,
    tools: ToolDefinition[],
    options: {
      project?: StoryProject | null
      finalToolNames: string[]
      maxTokens?: number
      temperature?: number
      maxRounds?: number
    }
  ) {
    return chatWithRelationshipToolsInPlace([...messages], modelRef, tools, options)
  }

  async function chatWithRelationshipToolsInPlace(
    currentMessages: ChatMessage[],
    modelRef: ProviderModelRef,
    tools: ToolDefinition[],
    options: {
      project?: StoryProject | null
      finalToolNames: string[]
      maxTokens?: number
      temperature?: number
      maxRounds?: number
      finalToolResultContent?: (toolCall: ToolCall) => string
    }
  ) {
    const allToolCalls: ToolCall[] = []
    const providerStore = useProviderStore()
    const maxRounds = options.maxRounds ?? providerStore.toolWorkflowSettings.maxToolCallRounds
    const finalToolNames = new Set(options.finalToolNames)

    let round = 0
    while (true) {
      if (round === maxRounds - 1) {
        currentMessages.push({
          role: 'user',
          content: `You have reached the final tool round. Do not call lookup tools again. Call one of these final reporting tools now: ${options.finalToolNames.join(', ')}. If no issues are found, call the final reporting tool with {"issues": []}. Do not answer in text.`,
        })
      }

      const response = await providerManager.chatWithTools(
        currentMessages,
        modelRef,
        tools,
        options.maxTokens ?? 4096,
        options.temperature ?? 0.2
      )

      allToolCalls.push(...response.tool_calls)
      if (!response.tool_calls.length) {
        currentMessages.push({
          role: 'assistant',
          content: response.content || null,
          reasoning_content: response.reasoning_content ?? null,
        })
        currentMessages.push({
          role: 'user',
          content: `Your previous response was invalid because it did not call a required final tool. Do not answer in text. Call one of these tools now: ${options.finalToolNames.join(', ')}. If there are no issues or no results, call the tool with an empty result array.`,
        })
        round += 1
        if (round >= maxRounds) {
          const shouldContinue = await waitForToolContinuation({
            workflow: options.finalToolNames.join(' / '),
            rounds: maxRounds,
            finalToolNames: options.finalToolNames,
          })

          if (!shouldContinue) {
            throw new Error(`Assistant tool workflow stopped after ${maxRounds} rounds before calling ${options.finalToolNames.join(' or ')}.`)
          }

          round = 0
        }
        continue
      }

      const finalToolCall = response.tool_calls.find(toolCall => finalToolNames.has(toolCall.name))
      if (finalToolCall) {
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
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: options.finalToolResultContent?.(toolCall) ?? JSON.stringify({ ok: true, tool: toolCall.name }),
          })
        }
        return { ...response, tool_calls: allToolCalls }
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
        const relationshipResult = options.project
          ? await handleRelationshipQueryTool(toolCall, options.project)
          : null
        currentMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: relationshipResult?.content ?? JSON.stringify({ error: `Unsupported tool: ${toolCall.name}` }),
        })
      }

      round += 1
      if (round >= maxRounds) {
        const shouldContinue = await waitForToolContinuation({
          workflow: options.finalToolNames.join(' / '),
          rounds: maxRounds,
          finalToolNames: options.finalToolNames,
        })

        if (!shouldContinue) {
          throw new Error(`Assistant tool workflow stopped after ${maxRounds} rounds before calling ${options.finalToolNames.join(' or ')}.`)
        }

        round = 0
        currentMessages.push({
          role: 'user',
          content: `Continue the tool workflow. Tool round counter has been reset. Prefer reporting with ${options.finalToolNames.join(' or ')} as soon as you have enough information; only use more lookup tools if necessary.`,
        })
      }
    }
  }

  async function chatWithAssistant(prompt: string): Promise<string> {
    const modelRef = getAgentModelRef('editingAI')

    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a helpful writing assistant. Provide concise, actionable advice to help the user improve their story. Be creative and supportive.' },
      { role: 'user', content: prompt },
    ]

    try {
      const response = await providerManager.chat(
        messages,
        modelRef,
        2048,
        0.7
      )
      return response
    } catch (error: any) {
      throw new Error(`Assistant error: ${error?.message || 'Unknown error'}`)
    }
  }

  async function editChapterWithTool(prompt: string): Promise<{ content: string; summary: string }> {
    const modelRef = getAgentModelRef('editingAI')
    const tools: ToolDefinition[] = [{
      name: 'replace_chapter_content',
      description: 'Replace the current chapter content with a complete revised version.',
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
    }]

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [
          'You are Vibe AI inside a chapter editor.',
          'You must use the replace_chapter_content tool for every successful edit.',
          'Return the full updated chapter content in revisedContent.',
          'Do not respond with plain prose when an edit is requested.',
        ].join('\n'),
      },
      { role: 'user', content: prompt },
    ]

    try {
      const response = await providerManager.chatWithTools(messages, modelRef, tools, 8192, 0.5)
      const toolCall = getToolCall(response.tool_calls, 'replace_chapter_content')
      const revisedContent = typeof toolCall?.arguments?.revisedContent === 'string'
        ? toolCall.arguments.revisedContent.trim()
        : ''

      if (!revisedContent) {
        throw new Error('Vibe AI did not call replace_chapter_content with revised content.')
      }

      return {
        content: revisedContent,
        summary: typeof toolCall?.arguments?.summary === 'string' ? toolCall.arguments.summary.trim() : '',
      }
    } catch (error: any) {
      throw new Error(`Tool edit error: ${error?.message || 'Unknown error'}`)
    }
  }

  async function auditChapterWithTool(prompt: string, projectId?: string): Promise<ChapterAuditIssue[]> {
    const modelRef = getAgentModelRef('editingAI')
    const project = projectId ? validateProject(projectId) : null
    const tools: ToolDefinition[] = [
      ...getRelationshipQueryTools(),
      {
        name: 'report_chapter_issues',
        description: 'Report concrete issues found in the chapter after checking it against plan, characters, relationships, continuity, and factual logic.',
        parameters: {
          type: 'object',
          properties: {
            issues: {
              type: 'array',
              description: 'Concrete issues found in the current chapter. Return an empty array if no issues are found.',
              items: {
                type: 'object',
                properties: {
                  severity: {
                    type: 'string',
                    enum: ['low', 'medium', 'high'],
                    description: 'How serious the issue is.',
                  },
                  category: {
                    type: 'string',
                    enum: ['chapter_plan', 'character', 'relationship', 'continuity', 'factual', 'logic', 'style'],
                    description: 'The issue category.',
                  },
                  title: {
                    type: 'string',
                    description: 'A short issue title.',
                  },
                  excerpt: {
                    type: 'string',
                    description: 'The shortest exact excerpt from the chapter that demonstrates the issue. Leave empty only if no exact excerpt exists.',
                  },
                  explanation: {
                    type: 'string',
                    description: 'Why this is inconsistent, implausible, or unsupported.',
                  },
                  suggestedFix: {
                    type: 'string',
                    description: 'A concrete fix instruction that Vibe AI can apply.',
                  },
                },
                required: ['severity', 'category', 'title', 'explanation', 'suggestedFix'],
              },
            },
          },
          required: ['issues'],
        },
      },
    ]

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [
          'You are Editing AI. Audit the current chapter against the supplied chapter plan, characters, relationship state, and story context.',
          'The prompt intentionally includes only compact character and relationship context.',
          'Use get_character_profile and relationship query tools for specific facts before reporting relationship or character consistency issues.',
          'Focus on concrete contradictions, unsupported facts, chronology errors, relationship inconsistencies, missing plan beats, logic problems, and factual implausibility inside the story world.',
          'Use report_chapter_issues. Do not return free-form prose.',
          'Do not invent problems. If the chapter is coherent, report an empty issues array.',
        ].join('\n'),
      },
      { role: 'user', content: prompt },
    ]

    try {
      const response = await chatWithRelationshipTools(messages, modelRef, tools, {
        project,
        finalToolNames: ['report_chapter_issues'],
        maxTokens: 4096,
        temperature: 0.2,
      })
      const toolCall = getToolCall(response.tool_calls, 'report_chapter_issues')
      const rawIssues = Array.isArray(toolCall?.arguments?.issues) ? toolCall.arguments.issues : []

      return rawIssues.map((issue, index) => ({
        id: `issue-${Date.now()}-${index}`,
        severity: issue?.severity === 'high' || issue?.severity === 'medium' || issue?.severity === 'low' ? issue.severity : 'medium',
        category: ['chapter_plan', 'character', 'relationship', 'continuity', 'factual', 'logic', 'style'].includes(issue?.category) ? issue.category : 'logic',
        title: String(issue?.title ?? `Issue ${index + 1}`).trim(),
        excerpt: String(issue?.excerpt ?? '').trim(),
        explanation: String(issue?.explanation ?? '').trim(),
        suggestedFix: String(issue?.suggestedFix ?? '').trim(),
      })).filter(issue => issue.title && issue.explanation && issue.suggestedFix)
    } catch (error: any) {
      throw new Error(`Tool audit error: ${error?.message || 'Unknown error'}`)
    }
  }

  function getProofreadingTools(): ToolDefinition[] {
    return [
      ...getRelationshipQueryTools(),
      {
        name: 'report_proofreading_issues',
        description: 'Report concrete grammar, typo, style, and consistency issues found in the chapter.',
        parameters: {
          type: 'object',
          properties: {
            issues: {
              type: 'array',
              description: 'List of specific issues found. Return an empty array if no issues are found.',
              items: {
                type: 'object',
                properties: {
                  severity: {
                    type: 'string',
                    enum: ['low', 'medium', 'high'],
                    description: 'How serious the issue is.',
                  },
                  category: {
                    type: 'string',
                    enum: ['grammar', 'typo', 'style', 'consistency', 'pacing', 'logic'],
                    description: 'The issue category.',
                  },
                  title: {
                    type: 'string',
                    description: 'A short issue title.',
                  },
                  excerpt: {
                    type: 'string',
                    description: 'The exact excerpt from the text that contains the issue.',
                  },
                  explanation: {
                    type: 'string',
                    description: 'Why this is an issue.',
                  },
                  suggestedFix: {
                    type: 'string',
                    description: 'Specific instruction on how to fix this issue.',
                  },
                },
                required: ['severity', 'category', 'title', 'excerpt', 'explanation', 'suggestedFix'],
              },
            },
          },
          required: ['issues'],
        },
      },
    ]
  }

  function getProofreadingSystemPrompt() {
    return [
      'You are a Proofreading Expert. Your job is to audit a chapter for grammar, typos, consistency, pacing, and logical flow errors through tools.',
      'You are not a rewriting agent. Do not return corrected prose, markdown reports, JSON text, bullet lists, or explanations in assistant text.',
      'Your final response for each submitted segment must be a tool call to report_proofreading_issues.',
      'Focus on:',
      '- Grammatical errors, typos, and punctuation issues.',
      '- Consistency in character names, descriptions, and behaviors.',
      '- Timeline and logical consistency within the chapter.',
      '- Narrative pacing and prose style.',
      'The prompt intentionally includes only compact character and relationship context.',
      'Use get_character_profile and relationship query tools for specific facts before reporting character or relationship consistency issues.',
      'Use report_proofreading_issues to report concrete findings. Assistant text is invalid.',
      'Do not invent problems. If the current segment is sound, call report_proofreading_issues with {"issues": []}.',
    ].join('\n')
  }

  function mapProofreadingIssues(rawIssues: any[]): ChapterAuditIssue[] {
    return rawIssues.map((issue, index) => ({
      id: `issue-${Date.now()}-${index}`,
      severity: issue?.severity === 'high' || issue?.severity === 'medium' || issue?.severity === 'low' ? issue.severity : 'medium',
      category: (['grammar', 'typo', 'style', 'consistency', 'pacing', 'logic'].includes(issue?.category) ? issue.category : 'grammar') as any,
      title: String(issue?.title ?? `Issue ${index + 1}`).trim(),
      excerpt: String(issue?.excerpt ?? '').trim(),
      explanation: String(issue?.explanation ?? '').trim(),
      suggestedFix: String(issue?.suggestedFix ?? '').trim(),
    })).filter(issue => issue.title && issue.explanation && issue.suggestedFix)
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
        maxTokens: 4096,
        temperature: 0.2,
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
    const prefix = contextPrompt.trimEnd()
    const modelRef = getAgentModelRef('proofreader')
    const project = projectId ? validateProject(projectId) : null
    const tools = getProofreadingTools()
    const messages: ChatMessage[] = [
      { role: 'system', content: getProofreadingSystemPrompt() },
      {
        role: 'user',
        content: [
          prefix,
          '',
          'Keep this as the shared proofreading context for the whole chapter. The following messages will submit chapter segments one by one in the same session.',
          'For each segment, inspect only that segment, use lookup tools when needed, then call report_proofreading_issues.',
        ].join('\n'),
      },
    ]

    for (let index = 0; index < segments.length; index++) {
      if (cancelled.value) break
      const segment = segments[index]
      progressMessage.value = `Proofreading segment ${index + 1}/${segments.length}...`
      await options?.onSegmentStart?.({
        segmentIndex: index,
        segmentTotal: segments.length,
      })
      const segmentPrompt = [
        `Current Chapter Segment ${segment.index + 1}/${segment.total}:`,
        `Estimated token range: ${segment.tokenStart}-${segment.tokenEnd} of ${segment.tokenTotal}.`,
        'Proofread only this segment. Report exact excerpts from this segment. Do not assume unseen chapter text is present in this request.',
        '',
        segment.content,
      ].join('\n')
      messages.push({ role: 'user', content: segmentPrompt })
      const response = await chatWithRelationshipToolsInPlace(messages, modelRef, tools, {
        project,
        finalToolNames: ['report_proofreading_issues'],
        maxTokens: 4096,
        temperature: 0.2,
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
      messages.splice(2, messages.length - 2)
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
            proofreadContent: chapter.proofreadContent || contentFallback || chapter.content,
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
