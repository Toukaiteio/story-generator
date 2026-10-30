import { useGenerationStore } from '@/stores/generation'
import { useProviderStore } from '@/stores/provider'
import { providerManager } from '@/services/provider'
import { getAgent } from '@/services/agent'
import { extractJsonObject } from '@/services/agent/validation'
import { agentTodoListState, clearAgentTodoList } from '@/services/agent/todolist'
import type { AgentType } from '@/types/agent'
import type { ChapterOutline } from '@/types/chapter'
import type { GenerationStage } from '@/types/project'
import type { ProviderModelRef } from '@/types/provider'
import type { AgentTodoItem, AgentTodoListState } from '@/services/agent/todolist'
import type { ChapterAuditIssue } from '@/services/generation/types'
import type {
  AssistantCallbacks,
  GenerationError,
  ToolContinuationRequest,
  ToolStatusUpdate,
} from '@/stores/generation/types'

export type {
  AgentTodoItem,
  AgentTodoListState,
  ChapterAuditIssue,
  AssistantCallbacks,
  GenerationError,
  ToolContinuationRequest,
  ToolStatusUpdate,
}

export interface ChapterEditOptions {
  currentContent?: string
  modelRef?: ProviderModelRef | null
  onToolStatus?: (status: ToolStatusUpdate) => void
  onTodoList?: (state: AgentTodoListState) => void
  onToken?: (token: string) => void
  onReasoningToken?: (token: string) => void
  signal?: AbortSignal
}

export interface ChapterOutlineEditOptions {
  currentTitle?: string
  currentOutline?: ChapterOutline
  modelRef?: ProviderModelRef | null
  onToolStatus?: (status: ToolStatusUpdate) => void
  onTodoList?: (state: AgentTodoListState) => void
  onToken?: (token: string) => void
  onReasoningToken?: (token: string) => void
  signal?: AbortSignal
}

export interface ChapterEditResult {
  content: string
  summary: string
  toolName: string
}

export interface ChapterOutlineEditResult {
  title: string
  outline: ChapterOutline
  summary: string
  toolName: string
}

export interface ProofreadSegmentOptions {
  modelRef?: ProviderModelRef | null
  onSegmentStart?: (payload: { segmentIndex: number; segmentTotal: number }) => Promise<void> | void
  onSegmentComplete?: (payload: {
    segmentIndex: number
    segmentTotal: number
    segmentIssues: ChapterAuditIssue[]
    allIssues: ChapterAuditIssue[]
  }) => Promise<void> | void
}

export interface DraftProjectConfigOptions {
  role?: AgentType
  agentType?: 'detailer' | 'outline'
  maxTokens?: number
  temperature?: number
}

/**
 * The single AI engine surface the UI is allowed to talk to.
 *
 * Components must not import provider/agent/pipeline modules directly. Every
 * generation capability and every piece of generation state is exposed here so
 * the engine can be replaced (or moved to another process) without touching UI.
 */
export interface StoryEngine {
  readonly isGenerating: boolean
  readonly stage: GenerationStage
  readonly progress: string
  readonly streamingText: string
  readonly errors: GenerationError[]
  readonly activeChapterIndex: number | null
  readonly pendingToolContinuation: ToolContinuationRequest | null
  readonly todoList: AgentTodoListState

  chat(prompt: string, modelRef?: ProviderModelRef | null, callbacks?: AssistantCallbacks): Promise<string>
  editChapter(prompt: string, options?: ChapterEditOptions): Promise<ChapterEditResult>
  editChapterOutline(prompt: string, options?: ChapterOutlineEditOptions): Promise<ChapterOutlineEditResult>
  auditChapter(prompt: string, projectId?: string): Promise<ChapterAuditIssue[]>
  proofreadChapter(prompt: string, projectId?: string): Promise<ChapterAuditIssue[]>
  proofreadContent(
    contextPrompt: string,
    content: string,
    projectId?: string,
    options?: ProofreadSegmentOptions,
  ): Promise<ChapterAuditIssue[]>
  polishChapter(projectId: string, chapterId?: string, issues?: ChapterAuditIssue[]): Promise<unknown>
  saveProofreadingIssues(projectId: string, chapterId: string, issues: ChapterAuditIssue[], contentFallback?: string): Promise<void>

  cancel(): void
  setProgress(message: string): void
  beginTask(stage: GenerationStage, message: string, chapterIndex?: number | null): void
  updateTask(message: string, chapterIndex?: number | null): void
  finishTask(): void
  setTodoList(state: AgentTodoListState): void
  clearTodoList(): void
  continueToolCalls(): void
  stopToolCalls(): void

  /**
   * Runs the structured "detailer"/"outline" agent to draft or enrich project
   * configuration. Returns the parsed payload, never a raw model response.
   */
  draftProjectConfig(
    payload: Record<string, unknown>,
    options?: DraftProjectConfigOptions,
  ): Promise<Record<string, any>>
}

function resolveAgentModelRef(role: AgentType): ProviderModelRef | null {
  const providerStore = useProviderStore()
  providerManager.setProviders(providerStore.providers)
  return providerStore.getAgentModelBinding(role)
    ?? providerStore.getDefaultModelRefForRole(role)
    ?? null
}

export function useStoryEngine(): StoryEngine {
  const generation = useGenerationStore()
  const providerStore = useProviderStore()

  async function draftProjectConfig(
    payload: Record<string, unknown>,
    options: DraftProjectConfigOptions = {},
  ): Promise<Record<string, any>> {
    const { role = 'detailer', agentType = 'detailer', maxTokens = 4096, temperature = 0.35 } = options
    const modelRef = resolveAgentModelRef(role)
    if (!modelRef) {
      throw new Error('No available model for the requested agent. Please configure an active provider first.')
    }

    const model = providerStore.getModelByRef(modelRef)
    const agent = getAgent(agentType)
    agent.setModel(modelRef, maxTokens, temperature, model?.model.contextTokens ?? null)

    const result = await agent.execute(payload)
    if (result.data && typeof result.data === 'object') {
      return result.data
    }
    return JSON.parse(extractJsonObject(result.content))
  }

  return {
    get isGenerating() { return generation.isGenerating },
    get stage() { return generation.currentStage },
    get progress() { return generation.progressMessage },
    get streamingText() { return generation.streamContent },
    get errors() { return generation.errors },
    get activeChapterIndex() { return generation.currentChapterIndex },
    get pendingToolContinuation() { return generation.toolContinuationRequest },
    get todoList() { return agentTodoListState.value },

    chat(prompt, modelRef, callbacks) {
      return generation.chatWithAssistant(prompt, modelRef, callbacks)
    },
    editChapter(prompt, options) {
      return generation.editChapterWithTool(prompt, options)
    },
    editChapterOutline(prompt, options) {
      return generation.editChapterOutlineWithTool(prompt, options)
    },
    auditChapter(prompt, projectId) {
      return generation.auditChapterWithTool(prompt, projectId)
    },
    proofreadChapter(prompt, projectId) {
      return generation.proofreadChapterWithTool(prompt, projectId)
    },
    proofreadContent(contextPrompt, content, projectId, options) {
      return generation.proofreadChapterContentWithTool(contextPrompt, content, projectId, options)
    },
    polishChapter(projectId, chapterId, issues) {
      return generation.polishChapter(projectId, chapterId, issues)
    },
    saveProofreadingIssues(projectId, chapterId, issues, contentFallback) {
      return generation.saveChapterProofreadingIssues(projectId, chapterId, issues, contentFallback)
    },

    cancel() { generation.cancelGeneration() },
    setProgress(message) { generation.progressMessage = message },
    beginTask(stage, message, chapterIndex) { generation.beginManualTask(stage, message, chapterIndex) },
    updateTask(message, chapterIndex) { generation.updateManualTask(message, chapterIndex) },
    finishTask() { generation.finishManualTask() },
    setTodoList(state) { agentTodoListState.value = state },
    clearTodoList() { clearAgentTodoList() },
    continueToolCalls() { generation.toolContinuationRequest?.continue() },
    stopToolCalls() { generation.toolContinuationRequest?.stop() },

    draftProjectConfig,
  }
}
