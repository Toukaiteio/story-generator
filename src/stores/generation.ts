import { defineStore } from 'pinia'
import { ref } from 'vue'
import { StoryPipeline } from '@/services/pipeline'
import { useProjectStore } from '@/stores/project'
import { useProviderStore } from '@/stores/provider'
import { providerManager } from '@/services/provider'
import type { GenerationStage, StoryProject } from '@/types/project'
import type { ChatMessage } from '@/types/provider'

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

  async function generateChapterDraft(projectId: string, chapterIndex: number) {
    resetRunState(projectId)
    const project = validateProject(projectId)
    try {
      currentStage.value = 'writing'
      progressMessage.value = `Writing chapter ${chapterIndex + 1}...`
      const generated = await (pipeline ?? new StoryPipeline()).generateChapterDraft(project, chapterIndex, appendStreamToken)
      const chapters = project.chapters.map((chapter, index) => index === chapterIndex ? generated : chapter)
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

  async function proofreadChapter(projectId: string, chapterIndex: number) {
    resetRunState(projectId)
    const project = validateProject(projectId)
    try {
      currentStage.value = 'proofreading'
      progressMessage.value = `Proofreading chapter ${chapterIndex + 1}...`
      const generated = await (pipeline ?? new StoryPipeline()).proofreadChapter(project, chapterIndex, appendStreamToken)
      const chapters = project.chapters.map((chapter, index) => index === chapterIndex ? generated : chapter)
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

  async function polishChapter(projectId: string, chapterIndex: number) {
    resetRunState(projectId)
    const project = validateProject(projectId)
    try {
      currentStage.value = 'polishing'
      progressMessage.value = `Polishing chapter ${chapterIndex + 1}...`
      const generated = await (pipeline ?? new StoryPipeline()).polishChapter(project, chapterIndex, appendStreamToken)
      const chapters = project.chapters.map((chapter, index) => index === chapterIndex ? generated : chapter)
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
        return generateChapterDraft(projectId, action.chapterIndex)
      case 'proofreading':
        return proofreadChapter(projectId, action.chapterIndex)
      case 'polishing':
        return polishChapter(projectId, action.chapterIndex)
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

  async function chatWithAssistant(prompt: string): Promise<string> {
    const providerStore = useProviderStore()
    providerManager.setProviders(providerStore.providers)

    // Get a model for the assistant - use the outline model as default
    const modelRef = providerStore.getAgentModelBinding('outline') ?? providerStore.getDefaultModelRefForRole('outline')
    if (!modelRef) {
      throw new Error('No model available for assistant. Please configure a provider first.')
    }

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
  }
})
