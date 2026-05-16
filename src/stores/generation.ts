import { defineStore } from 'pinia'
import { ref } from 'vue'
import { StoryPipeline } from '@/services/pipeline'
import { prepareRuntime, buildKnowledgeContextForProject } from '@/services/pipeline/runtime'
import { buildPreviousSummary, buildCharacterContextForTask } from '@/services/pipeline/context'
import { useProjectStore } from '@/stores/project'
import { useProviderStore } from '@/stores/provider'
import { providerManager } from '@/services/provider'
import { setToolContinuationHandler } from '@/services/agent/toolContinuation'
import { clearAgentTodoList } from '@/services/agent/todolist'
import { getNextGenerationAction, resolveChapterIndexById, resolveNextChapterIndex } from '@/services/generation/flow'
import type { GenerationStage, StoryProject } from '@/types/project'
import type { ChapterAuditIssue } from '@/services/generation/types'
import type { ChapterOutline } from '@/types/chapter'
import type { ProviderModelRef } from '@/types/provider'
import type { AgentType } from '@/types/agent'
import { chatWithAssistant as chatWithAssistantWorkflow } from '@/stores/generation/chatAssistant'
import { editChapterWithTool as editChapterWithToolWorkflow } from '@/stores/generation/chapterContentEdit'
import { editChapterOutlineWithTool as editChapterOutlineWithToolWorkflow } from '@/stores/generation/chapterOutlineEdit'
import {
  auditChapterWithToolWorkflow,
  proofreadChapterWithToolWorkflow,
  proofreadChapterWithToolChunkedWorkflow,
  proofreadChapterContentWithToolWorkflow,
} from '@/stores/generation/proofreadingToolsWorkflow'
import type { ToolContinuationRequest, GenerationError, AssistantCallbacks, ToolStatusUpdate } from '@/stores/generation/types'
import { getModelContextTokens, getUsableAgentModelRef } from '@/stores/generation/helpers'
import type { AgentTodoListState } from '@/services/agent/todolist'

export type { ChapterAuditIssue } from '@/services/generation/types'

export const useGenerationStore = defineStore('generation', () => {
  const isGenerating = ref(false)
  const currentStage = ref<GenerationStage>('idle')
  const progressMessage = ref('')
  const streamContent = ref('')
  const errors = ref<GenerationError[]>([])
  const cancelled = ref(false)
  const currentChapterIndex = ref<number | null>(null)
  const toolContinuationRequest = ref<ToolContinuationRequest | null>(null)

  let errorCounter = 0
  let pipeline: StoryPipeline | null = null
  let activeAbortController: AbortController | null = null

  const getNextAction = getNextGenerationAction
  const resolveChapterIndex = resolveNextChapterIndex

  setToolContinuationHandler(waitForToolContinuation)

  function resetRunState() {
    isGenerating.value = true
    cancelled.value = false
    errors.value = []
    progressMessage.value = ''
    streamContent.value = ''
    clearAgentTodoList()
    currentStage.value = 'idle'
    currentChapterIndex.value = null
    pipeline = new StoryPipeline()
    activeAbortController = new AbortController()
  }

  function appendStreamToken(token: string) {
    streamContent.value += token
  }

  function finishRun() {
    isGenerating.value = false
    progressMessage.value = ''
    currentChapterIndex.value = null
    pipeline = null
    activeAbortController = null
  }

  function activeSignal() {
    return activeAbortController?.signal
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
    currentStage.value = stage
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

  function getAgentModelRef(role: AgentType): ProviderModelRef {
    const providerStore = useProviderStore()
    providerManager.setProviders(providerStore.providers)
    return providerStore.requireAgentModelRef(role)
  }

  function waitForToolContinuation(request: Omit<ToolContinuationRequest, 'id' | 'continue' | 'stop'>) {
    return new Promise<boolean>((resolve) => {
      const id = `tool-continuation-${Date.now()}-${Math.random().toString(36).slice(2)}`
      toolContinuationRequest.value = {
        ...request,
        id,
        continue: () => {
          if (toolContinuationRequest.value?.id === id) toolContinuationRequest.value = null
          resolve(true)
        },
        stop: () => {
          if (toolContinuationRequest.value?.id === id) toolContinuationRequest.value = null
          resolve(false)
        },
      }
    })
  }

  async function auditChapter(projectId: string, chapterIndex: number, mode: 'proofread' | 'edit' = 'proofread'): Promise<ChapterAuditIssue[]> {
    const project = validateProject(projectId)
    const chapter = project.chapters[chapterIndex]
    if (!chapter) throw new Error(`Chapter ${chapterIndex + 1} not found`)
    const { proofreaderAgent } = prepareRuntime()
    const content = chapter.content
    const { buildProofreadingSegments } = await import('@/services/proofreading/chunking')
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

  async function proofreadChapter(projectId: string, chapterId?: string) {
    resetRunState()
    const project = validateProject(projectId)
    const targetChapterIndex = chapterId ? resolveChapterIndexById(project, chapterId) : resolveChapterIndex(project, 'proofreading')
    if (targetChapterIndex < 0) {
      finishRun()
      throw new Error('No chapter is currently ready for proofreading')
    }
    try {
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
      await applyProjectUpdate(projectId, { chapters, generationStage: nextAction.stage === 'done' ? 'done' : nextAction.stage })
      markCompleted('proofreading')
      currentStage.value = 'proofreading'
      currentChapterIndex.value = null
      return validateProject(projectId).chapters[targetChapterIndex]
    } catch (error: any) {
      addError('proofreading', error?.message || 'Proofreading failed')
      throw error
    } finally {
      finishRun()
    }
  }

  async function polishChapter(projectId: string, chapterId?: string, proofreadingIssues?: any[]) {
    resetRunState()
    const project = validateProject(projectId)
    const targetChapterIndex = chapterId ? resolveChapterIndexById(project, chapterId) : resolveChapterIndex(project, 'polishing')
    if (targetChapterIndex < 0) {
      finishRun()
      throw new Error('No chapter is currently ready for polishing')
    }
    try {
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
          await applyProjectUpdate(projectId, { chapters, generationStage: 'polishing' })
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
    } catch (error: any) {
      addError('polishing', error?.message || 'Polishing failed')
      throw error
    } finally {
      finishRun()
    }
  }

  function cancelGeneration() {
    cancelled.value = true
    activeAbortController?.abort()
    pipeline?.cancel()
    isGenerating.value = false
    currentStage.value = 'idle'
    currentChapterIndex.value = null
    progressMessage.value = ''
    streamContent.value = ''
    pipeline = null
    activeAbortController = null
  }

  function clearErrors() {
    errors.value = []
  }

  function beginManualTask(stage: GenerationStage, message: string, chapterIndex: number | null = null) {
    isGenerating.value = true
    cancelled.value = false
    activeAbortController = new AbortController()
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
    activeAbortController = null
  }

  async function chatWithAssistant(prompt: string, modelOverride?: ProviderModelRef | null, callbacks?: AssistantCallbacks): Promise<string> {
    return chatWithAssistantWorkflow(prompt, modelOverride, callbacks)
  }

  async function editChapterWithTool(
    prompt: string,
    options: {
      currentContent?: string
      modelRef?: ProviderModelRef | null
      onToolStatus?: (status: ToolStatusUpdate) => void
      onTodoList?: (state: AgentTodoListState) => void
      onToken?: (token: string) => void
      onReasoningToken?: (token: string) => void
      signal?: AbortSignal
    } = {}
  ): Promise<{ content: string; summary: string; toolName: string }> {
    return editChapterWithToolWorkflow(prompt, options)
  }

  async function editChapterOutlineWithTool(
    prompt: string,
    options: {
      currentTitle?: string
      currentOutline?: ChapterOutline
      modelRef?: ProviderModelRef | null
      onToolStatus?: (status: ToolStatusUpdate) => void
      onTodoList?: (state: AgentTodoListState) => void
      onToken?: (token: string) => void
      onReasoningToken?: (token: string) => void
      signal?: AbortSignal
    } = {}
  ): Promise<{ title: string; outline: ChapterOutline; summary: string; toolName: string }> {
    return editChapterOutlineWithToolWorkflow(prompt, options)
  }

  async function auditChapterWithTool(prompt: string, projectId?: string): Promise<ChapterAuditIssue[]> {
    try {
      const modelRef = getAgentModelRef('editingAI')
      const project = projectId ? validateProject(projectId) : null
      return await auditChapterWithToolWorkflow(prompt, modelRef, project, getModelContextTokens, activeSignal(), waitForToolContinuation)
    } catch (error: any) {
      throw new Error(`Tool audit error: ${error?.message || 'Unknown error'}`)
    }
  }

  async function proofreadChapterWithTool(prompt: string, projectId?: string): Promise<ChapterAuditIssue[]> {
    try {
      const modelRef = getAgentModelRef('proofreader')
      const project = projectId ? validateProject(projectId) : null
      return await proofreadChapterWithToolWorkflow(prompt, modelRef, project, getModelContextTokens, activeSignal(), waitForToolContinuation)
    } catch (error: any) {
      throw new Error(`Proofreading error: ${error?.message || 'Unknown error'}`)
    }
  }

  async function proofreadChapterWithToolChunked(
    prompt: string,
    projectId?: string,
    options?: {
      onSegmentStart?: (payload: { segmentIndex: number; segmentTotal: number }) => Promise<void> | void
      onSegmentComplete?: (payload: { segmentIndex: number; segmentTotal: number; segmentIssues: ChapterAuditIssue[]; allIssues: ChapterAuditIssue[] }) => Promise<void> | void
    }
  ): Promise<ChapterAuditIssue[]> {
    return proofreadChapterWithToolChunkedWorkflow(
      prompt,
      async (segmentPrompt) => proofreadChapterWithTool(segmentPrompt, projectId),
      () => cancelled.value,
      (msg) => { progressMessage.value = msg },
      { onSegmentComplete: options?.onSegmentComplete }
    )
  }

  async function proofreadChapterContentWithTool(
    contextPrompt: string,
    content: string,
    projectId?: string,
    options?: {
      modelRef?: ProviderModelRef | null
      onSegmentStart?: (payload: { segmentIndex: number; segmentTotal: number }) => Promise<void> | void
      onSegmentComplete?: (payload: { segmentIndex: number; segmentTotal: number; segmentIssues: ChapterAuditIssue[]; allIssues: ChapterAuditIssue[] }) => Promise<void> | void
    }
  ): Promise<ChapterAuditIssue[]> {
    const modelRef = getUsableAgentModelRef('proofreader', options?.modelRef)
    const project = projectId ? validateProject(projectId) : null
    return proofreadChapterContentWithToolWorkflow(
      contextPrompt,
      content,
      modelRef,
      project,
      getModelContextTokens,
      activeSignal(),
      waitForToolContinuation,
      () => cancelled.value,
      (msg) => { progressMessage.value = msg },
      options
    )
  }

  async function saveChapterProofreadingIssues(
    projectId: string,
    chapterId: string,
    issues: ChapterAuditIssue[],
    _contentFallback = ''
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
    currentChapterIndex,
    toolContinuationRequest,
    getNextAction,
    proofreadChapter,
    polishChapter,
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
    markCompleted,
  }
})
