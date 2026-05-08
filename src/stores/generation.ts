import { defineStore } from 'pinia'
import { ref } from 'vue'
import { StoryPipeline } from '@/services/pipeline'
import { useProjectStore } from '@/stores/project'
import { useProviderStore } from '@/stores/provider'
import { providerManager } from '@/services/provider'
import type { GenerationStage, StoryProject } from '@/types/project'
import type { ChatMessage } from '@/types/provider'
import type { ProviderModelRef } from '@/types/provider'
import type { ToolDefinition, ToolCall } from '@/services/provider'

export interface ChapterAuditIssue {
  id: string
  severity: 'low' | 'medium' | 'high'
  category: 'chapter_plan' | 'character' | 'relationship' | 'continuity' | 'factual' | 'logic' | 'style'
  title: string
  excerpt: string
  explanation: string
  suggestedFix: string
}

interface GenerationError {
  id: string
  stage: string
  message: string
  timestamp: string
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

  let errorCounter = 0
  let pipeline: StoryPipeline | null = null

  const completedStages = ref<Set<string>>(new Set())

  function isStageComplete(stage: string): boolean {
    return completedStages.value.has(stage)
  }

  function resetRunState(projectId: string) {
    isGenerating.value = true
    cancelled.value = false
    errors.value = []
    currentProjectId.value = projectId
    progressMessage.value = ''
    streamContent.value = ''
    currentStage.value = 'idle'
    pipeline = new StoryPipeline()
  }

  function appendStreamToken(token: string) {
    streamContent.value += token
  }

  function finishRun() {
    isGenerating.value = false
    progressMessage.value = ''
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

  function getNextAction(project: StoryProject): NextAction {
    if (!project.outline.trim() || !project.characters.length) return { stage: 'planning' }
    if (!project.chapters.length || project.chapters.some(ch => !ch.outline.objective || !ch.outline.endingHook)) {
      return { stage: 'chapter-outline' }
    }

    const writingIndex = project.chapters.findIndex(ch => !ch.content.trim())
    if (writingIndex !== -1) return { stage: 'writing', chapterIndex: writingIndex }

    const proofreadingIndex = project.chapters.findIndex(ch => ch.content.trim() && !ch.proofreadContent.trim())
    if (proofreadingIndex !== -1) return { stage: 'proofreading', chapterIndex: proofreadingIndex }

    const polishingIndex = project.chapters.findIndex(ch => (ch.proofreadContent.trim() || ch.content.trim()) && !ch.polishedContent.trim())
    if (polishingIndex !== -1) return { stage: 'polishing', chapterIndex: polishingIndex }

    return { stage: 'done' }
  }

  function resolveChapterIndex(project: StoryProject, stage: Exclude<NextAction['stage'], 'planning' | 'chapter-outline' | 'done'>) {
    const action = getNextAction(project)
    return action.stage === stage ? action.chapterIndex : -1
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

  async function generateChapterDraft(projectId: string) {
    resetRunState(projectId)
    const project = validateProject(projectId)
    const targetChapterIndex = resolveChapterIndex(project, 'writing')
    if (targetChapterIndex < 0) {
      throw new Error('No chapter is currently ready for writing')
    }

    try {
      currentStage.value = 'writing'
      progressMessage.value = `Writing chapter ${targetChapterIndex + 1}...`
      const generated = await (pipeline ?? new StoryPipeline()).generateChapterDraft(project, targetChapterIndex, appendStreamToken)
      const chapters = project.chapters.map((chapter, index) => index === targetChapterIndex ? generated : chapter)
      const nextAction = getNextAction({ ...project, chapters })
      await applyProjectUpdate(projectId, {
        chapters,
        generationStage: nextAction.stage === 'done' ? 'done' : nextAction.stage,
      })
      markCompleted('writing')
      currentStage.value = nextAction.stage
      return generated
    } catch (error: any) {
      addError('writing', error?.message || 'Writing failed')
      throw error
    } finally {
      finishRun()
    }
  }

  async function proofreadChapter(projectId: string) {
    resetRunState(projectId)
    const project = validateProject(projectId)
    const targetChapterIndex = resolveChapterIndex(project, 'proofreading')
    if (targetChapterIndex < 0) {
      throw new Error('No chapter is currently ready for proofreading')
    }

    try {
      currentStage.value = 'proofreading'
      progressMessage.value = `Proofreading chapter ${targetChapterIndex + 1}...`
      const generated = await (pipeline ?? new StoryPipeline()).proofreadChapter(project, targetChapterIndex, appendStreamToken)
      const chapters = project.chapters.map((chapter, index) => index === targetChapterIndex ? generated : chapter)
      const nextAction = getNextAction({ ...project, chapters })
      await applyProjectUpdate(projectId, {
        chapters,
        generationStage: nextAction.stage === 'done' ? 'done' : nextAction.stage,
      })
      markCompleted('proofreading')
      currentStage.value = nextAction.stage
      return generated
    } catch (error: any) {
      addError('proofreading', error?.message || 'Proofreading failed')
      throw error
    } finally {
      finishRun()
    }
  }

  async function polishChapter(projectId: string) {
    resetRunState(projectId)
    const project = validateProject(projectId)
    const targetChapterIndex = resolveChapterIndex(project, 'polishing')
    if (targetChapterIndex < 0) {
      throw new Error('No chapter is currently ready for polishing')
    }

    try {
      currentStage.value = 'polishing'
      progressMessage.value = `Polishing chapter ${targetChapterIndex + 1}...`
      const generated = await (pipeline ?? new StoryPipeline()).polishChapter(project, targetChapterIndex, appendStreamToken)
      const chapters = project.chapters.map((chapter, index) => index === targetChapterIndex ? generated : chapter)
      const nextAction = getNextAction({ ...project, chapters })
      await applyProjectUpdate(projectId, {
        chapters,
        generationStage: nextAction.stage === 'done' ? 'done' : nextAction.stage,
        status: chapters.every(ch => ch.status === 'polished') ? 'completed' : project.status,
      })
      markCompleted('polishing')
      currentStage.value = nextAction.stage === 'done' ? 'done' : nextAction.stage
      return generated
    } catch (error: any) {
      addError('polishing', error?.message || 'Polishing failed')
      throw error
    } finally {
      finishRun()
    }
  }

  async function generateAll(projectId: string) {
    resetRunState(projectId)
    const projectStore = useProjectStore()
    const project = validateProject(projectId)
    try {
      const currentPipeline = pipeline ?? new StoryPipeline()
      pipeline = currentPipeline
      const updated = await currentPipeline.run(project, {
        onStageChange: stage => {
          currentStage.value = stage as GenerationStage
          streamContent.value = ''
          if (stage !== 'done') markCompleted(stage as GenerationStage)
        },
        onProgress: message => {
          progressMessage.value = message
        },
        onError: error => {
          addError(currentStage.value, error)
        },
        onChapterStart: () => {
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
      completedStages.value = new Set(stageOrder)
      currentStage.value = 'done'
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
    currentStage.value = 'idle'
    progressMessage.value = ''
    streamContent.value = ''
    pipeline = null
  }

  function clearErrors() {
    errors.value = []
  }

  function getAssistantModelRef(): ProviderModelRef {
    const providerStore = useProviderStore()
    providerManager.setProviders(providerStore.providers)

    // Get a model for the assistant - use the outline model as default
    const modelRef = providerStore.getAgentModelBinding('outline') ?? providerStore.getDefaultModelRefForRole('outline')
    if (!modelRef) {
      throw new Error('No model available for assistant. Please configure a provider first.')
    }
    return modelRef
  }

  function getToolCall(toolCalls: ToolCall[], name: string) {
    return toolCalls.find(toolCall => toolCall.name === name) ?? null
  }

  async function chatWithAssistant(prompt: string): Promise<string> {
    const modelRef = getAssistantModelRef()

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
    const modelRef = getAssistantModelRef()
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

  async function auditChapterWithTool(prompt: string): Promise<ChapterAuditIssue[]> {
    const modelRef = getAssistantModelRef()
    const tools: ToolDefinition[] = [{
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
    }]

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [
          'You are Editing AI. Audit the current chapter against the supplied chapter plan, characters, relationship state, and story context.',
          'Focus on concrete contradictions, unsupported facts, chronology errors, relationship inconsistencies, missing plan beats, logic problems, and factual implausibility inside the story world.',
          'Use report_chapter_issues. Do not return free-form prose.',
          'Do not invent problems. If the chapter is coherent, report an empty issues array.',
        ].join('\n'),
      },
      { role: 'user', content: prompt },
    ]

    try {
      const response = await providerManager.chatWithTools(messages, modelRef, tools, 4096, 0.2)
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

  return {
    isGenerating,
    currentStage,
    progressMessage,
    streamContent,
    errors,
    completedStages,
    isStageComplete,
    getNextAction,
    generateOutline,
    generateCharacters,
    generateStoryPlan,
    generateChapterPlan,
    generateChapterDraft,
    proofreadChapter,
    polishChapter,
    generateAll,
    generateNextStage,
    cancelGeneration,
    clearErrors,
    chatWithAssistant,
    editChapterWithTool,
    auditChapterWithTool,
  }
})
