<script setup lang="ts">
import { computed, ref, nextTick, onBeforeUnmount, watch } from 'vue'
import { useGenerationStore } from '@/stores/generation'
import { useUiStore } from '@/stores/ui'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'
import { decodeProviderModelRef } from '@/services/provider/catalog'
import {
  loadVibeConversation,
  saveVibeConversation,
  listVibeConversationHistory,
  createVibeConversationHistoryEntry,
  ensureVibeConversationHistory,
  updateVibeConversationHistoryEntry,
  removeVibeConversationHistoryEntry,
  type StoredVibeChatMessage,
  type StoredVibeChatMessageBlock,
  type VibeConversationHistoryEntry,
} from '@/services/vibeChatStorage'
import ToolCallStatus, { type ToolCallStatusItem } from '@/components/ui/ToolCallStatus.vue'
import TodoListStatus from '@/components/ui/TodoListStatus.vue'
import VibeModelPicker from '@/components/workspace/VibeModelPicker.vue'
import { agentTodoListState, clearAgentTodoList, type AgentTodoItem } from '@/services/agent/todolist'
import type { ChapterOutline } from '@/types/chapter'
import { markdownToHtml } from '@/services/markdown'
import { AlertTriangle, ArrowUp, Loader2, LoaderCircle, Square, Sparkles, RotateCcw, User, Copy, Wand2, ChevronDown, Brain, History, Plus, Trash2 } from 'lucide-vue-next'

interface ChatMessageBlock {
  id: StoredVibeChatMessageBlock['id']
  type: StoredVibeChatMessageBlock['type']
  text: StoredVibeChatMessageBlock['text']
  toolId: StoredVibeChatMessageBlock['toolId']
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  reasoning?: string
  toolStatuses?: ToolCallStatusItem[]
  workspaceSnapshot?: unknown
  timestamp: Date
  generationDurationMs?: number
  workBlocks?: ChatMessageBlock[]
}

const props = withDefaults(defineProps<{
  stage: string
  context?: Record<string, any>
  mode?: 'assistant' | 'editor-agent' | 'outline-agent'
}>(), {
  mode: 'assistant',
})

const emit = defineEmits<{
  apply: [payload: string | { content: string; chapterId?: string }]
  applyOutline: [payload: { title: string; outline: ChapterOutline; chapterId?: string }]
  applyPlanningOutline: [payload: { outline: string }]
  applyPlanningCharacters: [payload: { characters: any[] }]
  rewind: [snapshot: unknown]
  loadingChange: [loading: boolean]
  close: []
}>()

const genStore = useGenerationStore()
const ui = useUiStore()
const toast = useToast()

const messages = ref<ChatMessage[]>([])
const inputText = ref('')
const isLoading = ref(false)
const chatContainer = ref<HTMLElement | null>(null)
const generationStreamContainer = ref<HTMLElement | null>(null)
const inputTextarea = ref<HTMLTextAreaElement | null>(null)
const autoApplyEdits = ref(true)
const toolStatuses = ref<ToolCallStatusItem[]>([])
const todoItems = ref<AgentTodoItem[]>([])
const expandedMessageIds = ref<Set<string>>(new Set())
const expandedReasoningMessageIds = ref<Set<string>>(new Set())
const manuallyExpandedToolMessageIds = ref<Set<string>>(new Set())
const currentReasoning = ref('')
const streamingAssistantId = ref('')
const showResetConfirm = ref(false)
const showRewindConfirm = ref(false)
const pendingRewindMessageId = ref('')
const showHistoryMenu = ref(false)
const conversationHistory = ref<VibeConversationHistoryEntry[]>([])
const activeConversationId = ref('')
const selectedModelValue = ref('')

const generationStartTime = ref<number>(0)
const generationElapsedMs = ref<number>(0)
let timerInterval: ReturnType<typeof setInterval> | null = null

function startTimer() {
  generationStartTime.value = Date.now()
  generationElapsedMs.value = 0
  if (timerInterval) clearInterval(timerInterval)
  timerInterval = setInterval(() => {
    generationElapsedMs.value = Date.now() - generationStartTime.value
  }, 100)
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval)
  timerInterval = null
}

let chatSaveTimer: ReturnType<typeof setTimeout> | null = null
let isLoadingConversation = false
let pendingChatSave: (() => Promise<boolean>) | null = null
let conversationLoadRun = 0
let conversationLoadPromise: Promise<void> = Promise.resolve()
let activeConversationScope: { projectId: string; directoryPath?: string; scopeKey: string; storageKey: string; conversationId: string } | null = null
const conversationMemoryCache = new Map<string, { messages: StoredVibeChatMessage[]; toolStatuses: ToolCallStatusItem[]; todoItems: AgentTodoItem[] }>()
let activeRequestId = 0
let currentAbortController: AbortController | null = null
const cancelledRequestIds = new Set<number>()
type ToolStatusUpdate = Omit<ToolCallStatusItem, 'id'> & { callId?: string }

function tr(value: string) {
  return translatePhrase(value)
}

const selectedModelRef = computed(() => decodeProviderModelRef(selectedModelValue.value))

const projectId = computed(() => String(props.context?.projectId ?? 'local'))
const projectDirectoryPath = computed(() => typeof props.context?.directoryPath === 'string' ? props.context.directoryPath : undefined)
const conversationScopeKey = computed(() => {
  const chapterId = typeof props.context?.chapter?.id === 'string' && props.context.chapter.id.trim()
    ? props.context.chapter.id.trim()
    : 'global'
  return `${props.stage}.${props.mode}.${chapterId}`
})
const scopeCategory = computed(() => props.stage || 'planning')
const scopeEvent = computed(() => props.mode || 'assistant')

const activeConversation = computed(() =>
  conversationHistory.value.find(item => item.id === activeConversationId.value) ?? null
)

const activeConversationLabel = computed(() => {
  const entry = activeConversation.value
  if (!entry) return tr('Current')
  if (entry.topic) return entry.topic
  return new Date(entry.updatedAt).toLocaleString()
})

const hasConversationContent = computed(() =>
  messages.value.some(message =>
    message.role !== 'assistant'
    || message.content !== greetingContent()
    || Boolean(message.reasoning?.trim())
  )
)

const shouldShowQuickActions = computed(() =>
  (props.mode === 'editor-agent' || props.mode === 'outline-agent') && !hasConversationContent.value && !isLoading.value
)

const stagePrompts: Record<string, string> = {
  planning: 'You are a story planning assistant. Help the user refine their story outline and character designs. In this stage, "story outline" means the master outline for the whole story (global narrative arc), not per-chapter outlines. Do not convert the request into chapter-by-chapter planning unless the user explicitly asks for chapter planning. Keep the master outline concise and global, and avoid per-chapter fields such as chapter objective/conflict/key events/ending hook blocks in this stage. Provide creative suggestions, identify plot holes, and help develop compelling narratives. Relationship query tools are not available in this stage, so rely on the current outline and characters only. Prefer Function Calling when relevant tools are available.',
  'chapter-outline': 'You are a chapter planning assistant. Help the user structure their chapters effectively. Suggest improvements to chapter flow, pacing, and story beats. Prefer Function Calling when relevant tools are available.',
  'chapter-outline-review': 'You are a chapter plan review assistant. This optional stage is scaffolded only; provide high-level review notes without mutating chapter data unless the user explicitly asks for an edit. Prefer Function Calling when relevant tools are available.',
  writing: 'You are a writing assistant. Help the user improve their prose, suggest better word choices, enhance descriptions, and maintain consistent voice and style.',
  proofreading: 'You are a proofreading assistant. Help the user identify and fix grammar errors, inconsistencies, plot holes, and continuity issues.',
  polishing: 'You are a polishing assistant. Help the user enhance their prose quality, improve sentence rhythm, strengthen emotional resonance, and elevate the overall writing.',
  'chapter-detail': 'You are Vibe AI inside a chapter editor. Execute the user request by editing the chapter text directly. Return the complete revised chapter content only, without explanations, labels, or code fences.',
}

const stageLabels: Record<string, string> = {
  planning: 'Story Architect',
  'chapter-outline': 'Structure Designer',
  'chapter-outline-review': 'Plan Reviewer',
  writing: 'Prose Draftsman',
  proofreading: 'Continuity Editor',
  polishing: 'Style Polisher',
  'chapter-detail': 'Chapter Agent',
}

const quickActions = [
  'Improve pacing and description without changing the plot',
  'Check and repair Markdown formatting',
  'Make character dialogue more tense',
  'Tighten redundant paragraphs while preserving key details',
]

const outlineQuickActions = [
  'Tighten this outline while preserving the chapter intent',
  'Make the conflict more concrete and actionable',
  'Improve the causal flow between plot beats',
  'Strengthen the ending hook without changing the setup',
]

const activeQuickActions = computed(() =>
  props.mode === 'outline-agent' ? outlineQuickActions : quickActions
)

const globalGenerationStageLabel = computed(() => {
  const labels: Record<string, string> = {
    planning: 'Planning Story',
    'chapter-outline': 'Planning Chapters',
    'chapter-outline-review': 'Reviewing Chapter Plan',
    writing: 'Writing Chapter',
    proofreading: 'Proofreading',
    polishing: 'Polishing',
  }
  return labels[genStore.currentStage] ?? 'Processing'
})

const globalGenerationProgressText = computed(() => {
  if (!genStore.isGenerating) return ''
  if (genStore.progressMessage) return genStore.progressMessage
  return genStore.streamContent ? 'Generating...' : 'Starting...'
})

const showGlobalGenerationPanel = computed(() =>
  genStore.isGenerating || Boolean(genStore.streamContent) || agentTodoListState.value.items.length > 0
)

function greetingContent() {
  if (props.mode === 'outline-agent') {
    return 'Tell me what to adjust in this chapter outline. I will update the structured planning fields directly.'
  }
  return props.mode === 'editor-agent'
    ? 'Tell me what to change in this chapter. I will return a revised version you can apply to the editor.'
    : `Hello. I am your ${stageLabels[props.stage]}. How shall we evolve your story today?`
}

function addMessage(role: 'user' | 'assistant' | 'system', content: string, reasoning = '', workspaceSnapshot?: unknown) {
  const message = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    role,
    content,
    reasoning,
    toolStatuses: role === 'assistant' ? [] : undefined,
    workspaceSnapshot,
    timestamp: new Date(),
  }
  messages.value.push(message)
  pruneWorkspaceSnapshots()
  scheduleChatSave()
  scrollToBottom()
  return message.id
}

function updateMessage(id: string, patch: Partial<Pick<ChatMessage, 'content' | 'reasoning'>>) {
  const message = messages.value.find(item => item.id === id)
  if (!message) return
  Object.assign(message, patch)
  if (typeof patch.content === 'string') {
    ensureContentBlockFromMessage(message)
  }
  scheduleChatSave()
  scrollToBottom()
}

function appendMessageContent(id: string, token: string) {
  const message = messages.value.find(item => item.id === id)
  if (!message) return
  message.content += token
  if (message.role === 'assistant') {
    appendContentBlock(message, token)
  }
  scheduleChatSave()
  scrollToBottom()
}

function resetInputHeight() {
  nextTick(() => {
    if (!inputTextarea.value) return
    inputTextarea.value.style.height = 'auto'
  })
}

function serializeMessages(): StoredVibeChatMessage[] {
  return messages.value.map(message => ({
    id: message.id,
    role: message.role,
    content: message.content,
    reasoning: message.reasoning,
    toolStatuses: Array.isArray(message.toolStatuses)
      ? message.toolStatuses.map(item => ({ ...item }))
      : undefined,
    workBlocks: Array.isArray(message.workBlocks)
      ? message.workBlocks.map(item => ({ ...item }))
      : undefined,
    workspaceSnapshot: message.workspaceSnapshot,
    timestamp: message.timestamp instanceof Date
      ? message.timestamp.toISOString()
      : new Date(message.timestamp).toISOString(),
    generationDurationMs: message.generationDurationMs,
  }))
}

function scopeCacheKey(scope: { projectId: string; storageKey: string }) {
  return `${scope.projectId}:${scope.storageKey}`
}

function cacheCurrentConversation(scope = activeConversationScope) {
  if (!scope) return
  conversationMemoryCache.set(scopeCacheKey(scope), {
    messages: serializeMessages(),
    toolStatuses: toolStatuses.value.map(item => ({ ...item })),
    todoItems: todoItems.value.map(item => ({ ...item })),
  })
}

function deriveConversationTopicFromMessages(items: StoredVibeChatMessage[]) {
  const firstUserMessage = items.find(item => item.role === 'user' && item.content.trim())
  if (!firstUserMessage) return ''
  return firstUserMessage.content.replace(/\s+/g, ' ').slice(0, 72)
}

async function saveConversationScope(scope: { projectId: string; directoryPath?: string; scopeKey: string; storageKey: string; conversationId: string }) {
  const cached = conversationMemoryCache.get(scopeCacheKey(scope))
  const messagesToSave = cached?.messages ?? serializeMessages()
  const toolStatusesToSave = cached?.toolStatuses ?? toolStatuses.value.map(item => ({ ...item }))
  const todoItemsToSave = cached?.todoItems ?? todoItems.value.map(item => ({ ...item }))
  await saveVibeConversation(scope.projectId, scope.directoryPath, scope.storageKey, messagesToSave, {
    toolStatuses: toolStatusesToSave,
    todoItems: todoItemsToSave,
  })
  const nextTopic = deriveConversationTopicFromMessages(messagesToSave) || activeConversation.value?.topic || ''
  const updated = await updateVibeConversationHistoryEntry(
    scope.projectId,
    scope.directoryPath,
    scope.scopeKey,
    scope.conversationId,
    {
      topic: nextTopic,
      messageCount: messagesToSave.length,
      updatedAt: new Date().toISOString(),
      category: scopeCategory.value,
      event: scopeEvent.value,
    }
  )
  if (updated) {
    conversationHistory.value = conversationHistory.value
      .map(item => item.id === updated.id ? updated : item)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }
}

async function flushPendingChatSave() {
  if (isLoadingConversation) return
  if (chatSaveTimer) {
    clearTimeout(chatSaveTimer)
    chatSaveTimer = null
  }
  cacheCurrentConversation()
  const save = pendingChatSave
  pendingChatSave = null
  if (save) {
    await save()
  }
}

async function persistChatNow() {
  await flushPendingChatSave()
  if (isLoadingConversation) return
  cacheCurrentConversation()
  if (activeConversationScope) {
    await saveConversationScope(activeConversationScope)
  }
}

function scheduleChatSave() {
  if (isLoadingConversation) return
  if (chatSaveTimer) clearTimeout(chatSaveTimer)
  const scopedProjectId = projectId.value
  const scopedDirectoryPath = projectDirectoryPath.value
  const scopedScopeKey = conversationScopeKey.value
  const scopedStorageKey = activeConversationScope?.storageKey || ''
  const scopedConversationId = activeConversationScope?.conversationId || ''
  if (!scopedStorageKey || !scopedConversationId) return
  const scopedMessages = serializeMessages()
  const scopedUiState = serializeUiState()
  conversationMemoryCache.set(scopeCacheKey({ projectId: scopedProjectId, storageKey: scopedStorageKey }), {
    messages: scopedMessages,
    toolStatuses: scopedUiState.toolStatuses,
    todoItems: scopedUiState.todoItems,
  })
  pendingChatSave = () => saveConversationScope({
    projectId: scopedProjectId,
    directoryPath: scopedDirectoryPath,
    scopeKey: scopedScopeKey,
    storageKey: scopedStorageKey,
    conversationId: scopedConversationId,
  }).then(() => true)
  chatSaveTimer = setTimeout(() => {
    void flushPendingChatSave()
  }, 700)
}

function serializeUiState() {
  return {
    toolStatuses: toolStatuses.value.map(item => ({ ...item })),
    todoItems: todoItems.value.map(item => ({ ...item })),
  }
}

function hydrateToolStatuses(rawItems: any[] | undefined): ToolCallStatusItem[] {
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((item, index) => {
      const restoredStatus = item?.status === 'pending' || item?.status === 'running'
        ? 'error'
        : item?.status === 'success' || item?.status === 'warning' || item?.status === 'error'
          ? item.status
          : 'success'
      const wasInterrupted = item?.status === 'pending' || item?.status === 'running'
      return {
        id: String(item?.id || `${item?.name || 'tool'}-${index}`),
        name: String(item?.name || 'tool'),
        status: restoredStatus,
        title: typeof item?.title === 'string' ? item.title : undefined,
        description: wasInterrupted
          ? 'Tool execution was interrupted'
          : typeof item?.description === 'string' ? item.description : undefined,
        detail: wasInterrupted
          ? 'This tool was still processing when the app or conversation stopped. It cannot resume automatically.'
          : typeof item?.detail === 'string' ? item.detail : undefined,
        before: typeof item?.before === 'string' ? item.before : undefined,
        after: typeof item?.after === 'string' ? item.after : undefined,
      } as ToolCallStatusItem
    })
}

function hydrateTodoItems(rawItems: any[] | undefined): AgentTodoItem[] {
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((item, index) => ({
      id: String(item?.id || `task-${index + 1}`),
      title: String(item?.title || '').trim(),
      status: item?.status === 'in_progress'
        ? 'blocked'
        : item?.status === 'todo' || item?.status === 'done' || item?.status === 'blocked'
          ? item.status
          : 'todo',
      notes: item?.status === 'in_progress'
        ? 'This todo item was interrupted when the app or conversation stopped.'
        : typeof item?.notes === 'string' && item.notes.trim() ? item.notes.trim() : undefined,
    }))
    .filter(item => item.title)
}

function hydrateMessages(rawMessages: StoredVibeChatMessage[] | undefined) {
  return (Array.isArray(rawMessages) ? rawMessages : [])
    .filter(message => message && (message.role === 'user' || message.role === 'assistant' || message.role === 'system'))
    .map(message => ({
      id: String(message.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
      role: message.role,
      content: String(message.content ?? ''),
      reasoning: typeof message.reasoning === 'string' ? message.reasoning : '',
      toolStatuses: Array.isArray((message as any).toolStatuses)
        ? hydrateToolStatuses((message as any).toolStatuses)
        : undefined,
      workBlocks: Array.isArray((message as any).workBlocks)
        ? (message as any).workBlocks
          .map((block: any) => ({
            id: String(block?.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
            type: block?.type === 'reasoning' || block?.type === 'tool' || block?.type === 'content'
              ? block.type
              : 'reasoning',
            text: String(block?.text ?? ''),
            toolId: String(block?.toolId ?? ''),
          }))
        : undefined,
      workspaceSnapshot: message.workspaceSnapshot,
      timestamp: message.timestamp ? new Date(message.timestamp) : new Date(),
      generationDurationMs: typeof (message as any).generationDurationMs === 'number' ? (message as any).generationDurationMs : undefined,
    }))
}

function ensureAssistantWorkBlocks(message: ChatMessage) {
  if (message.role !== 'assistant') return []
  if (!Array.isArray(message.workBlocks)) message.workBlocks = []
  return message.workBlocks
}

function appendReasoningBlock(message: ChatMessage, token: string) {
  if (!token) return
  const blocks = ensureAssistantWorkBlocks(message)
  if (blocks.length > 0 && blocks[blocks.length - 1].type === 'reasoning') {
    blocks[blocks.length - 1].text += token
    return
  }
  blocks.push({ id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: 'reasoning', text: token, toolId: '' })
}

function appendContentBlock(message: ChatMessage, token: string) {
  if (!token) return
  const blocks = ensureAssistantWorkBlocks(message)
  if (blocks.length > 0 && blocks[blocks.length - 1].type === 'content') {
    blocks[blocks.length - 1].text += token
    return
  }
  blocks.push({ id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: 'content', text: token, toolId: '' })
}

function ensureContentBlockFromMessage(message: ChatMessage) {
  if (message.role !== 'assistant') return
  const content = message.content || ''
  if (!content.trim()) return
  const blocks = ensureAssistantWorkBlocks(message)
  const contentFromBlocks = blocks
    .filter(block => block.type === 'content')
    .map(block => block.text)
    .join('')
  if (contentFromBlocks === content) return
  if (!contentFromBlocks) {
    blocks.push({ id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: 'content', text: content, toolId: '' })
    return
  }
  if (content.startsWith(contentFromBlocks)) {
    const delta = content.slice(contentFromBlocks.length)
    if (delta) appendContentBlock(message, delta)
    return
  }
  blocks.push({ id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: 'content', text: content, toolId: '' })
}

function workBlocksBeforeContent(message: ChatMessage) {
  const blocks = Array.isArray(message.workBlocks) ? message.workBlocks : []
  const firstContentIndex = blocks.findIndex(block => block.type === 'content')
  const end = firstContentIndex >= 0 ? firstContentIndex : blocks.length
  return blocks.slice(0, end).filter(block => block.type !== 'content')
}

function workBlocksAfterContent(message: ChatMessage) {
  const blocks = Array.isArray(message.workBlocks) ? message.workBlocks : []
  const firstContentIndex = blocks.findIndex(block => block.type === 'content')
  if (firstContentIndex < 0) return []
  return blocks.slice(firstContentIndex + 1).filter(block => block.type !== 'content')
}

function attachLegacyToolStatusesToLatestAssistant(legacy: ToolCallStatusItem[]) {
  if (!legacy.length) return
  const hasAnyPerMessageToolStatuses = messages.value.some(message =>
    message.role === 'assistant' &&
    Array.isArray(message.toolStatuses) &&
    message.toolStatuses.length > 0
  )
  if (hasAnyPerMessageToolStatuses) return
  for (let index = messages.value.length - 1; index >= 0; index--) {
    const message = messages.value[index]
    if (message.role !== 'assistant') continue
    if (!Array.isArray(message.toolStatuses) || !message.toolStatuses.length) {
      message.toolStatuses = legacy.map(item => ({ ...item }))
    }
    return
  }
}

function cloneJsonSafe<T>(value: T): T | null {
  if (value === undefined || value === null) return null
  try {
    return typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value))
  } catch {
    try {
      return JSON.parse(JSON.stringify(value))
    } catch {
      return null
    }
  }
}

function captureWorkspaceSnapshot() {
  return cloneJsonSafe(props.context?.workspaceSnapshot)
}

function pruneWorkspaceSnapshots() {
  const limit = Math.max(0, Math.min(20, Math.trunc(ui.vibeRewindPoints)))
  const snapshotMessages = messages.value.filter(message => message.workspaceSnapshot)
  if (snapshotMessages.length <= limit) return
  for (const message of snapshotMessages.slice(0, snapshotMessages.length - limit)) {
    message.workspaceSnapshot = undefined
  }
}

function createGreetingMessage(): ChatMessage {
  return {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    role: 'assistant',
    content: greetingContent(),
    reasoning: '',
    timestamp: new Date(),
  }
}

function removeInitialGreeting() {
  if (messages.value.length !== 1) return
  const [message] = messages.value
  if (
    message.role === 'assistant'
    && message.content === greetingContent()
    && !message.reasoning?.trim()
    && !message.workspaceSnapshot
  ) {
    messages.value = []
  }
}

async function streamTextToMessage(id: string, text: string) {
  const message = messages.value.find(item => item.id === id)
  if (!message || message.content.trim()) return
  const chunkSize = Math.max(4, Math.ceil(text.length / 160))
  for (let index = 0; index < text.length; index += chunkSize) {
    appendMessageContent(id, text.slice(index, index + chunkSize))
    await new Promise(resolve => setTimeout(resolve, 8))
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTo({
        top: chatContainer.value.scrollHeight,
        behavior: 'smooth'
      })
    }
  })
}

function buildChapterContentContext(content: string | undefined, mode: string): string {
  const text = content || ''
  if (!text.trim()) return 'Current Content: Drafting...'
  const maxInline = mode === 'editor-agent' ? 1200 : 2000
  if (text.length <= maxInline) return `Current Content:\n${text}`

  const head = text.slice(0, Math.floor(maxInline * 0.6)).trim()
  const tail = text.slice(-Math.floor(maxInline * 0.4)).trim()
  const omitted = Math.max(0, text.length - head.length - tail.length)
  return [
    `Current Content Summary: ${text.length} characters. Full content is available through editor tools; do not assume omitted middle text.`,
    'Current Content Excerpt Start:',
    head,
    `[... ${omitted} characters omitted ...]`,
    'Current Content Excerpt End:',
    tail,
  ].join('\n')
}

function formatListContext(label: string, value: unknown) {
  if (!Array.isArray(value) || !value.length) return ''
  return `${label}:\n${value.map(item => `- ${String(item)}`).join('\n')}`
}

function buildProjectConfigContext(config: any): string {
  if (!config || typeof config !== 'object') return ''
  return [
    'Story Configuration:',
    config.name ? `Project Name: ${config.name}` : '',
    config.theme ? `Theme: ${config.theme}` : '',
    config.genre ? `Genre: ${config.genre}` : '',
    config.targetReader ? `Target Reader: ${config.targetReader}` : '',
    config.language ? `Primary Language: ${config.language}` : '',
    config.writingFormat ? `Writing Format: ${config.writingFormat}` : '',
    config.writingStyleName || config.writingStyleId ? `Writing Style: ${config.writingStyleName || config.writingStyleId}` : '',
    config.chapterCount ? `Configured Chapters: ${config.chapterCount}` : '',
    config.maxChapters ? `Max Chapters: ${config.maxChapters}` : '',
    config.length ? `Story Length: ${config.length}` : '',
    formatListContext('Required Elements', config.requiredElements),
    formatListContext('Forbidden Elements', config.forbiddenElements),
    config.customRequirements ? `Custom Requirements:\n${config.customRequirements}` : '',
    config.summary ? `Current Summary:\n${config.summary}` : '',
  ].filter(Boolean).join('\n')
}

function buildContextPrompt(): string {
  const ctx = props.context || {}
  const parts: string[] = []
  const projectConfig = buildProjectConfigContext(ctx.projectConfig)
  if (projectConfig) parts.push(projectConfig)
  if (ctx.outline) parts.push(`Outline:\n${ctx.outline}`)
  if (ctx.writingStyle) {
    parts.push(`Writing Style Guide (higher priority than Content Format):\n${ctx.writingStyle}`)
  }
  if (ctx.characters) parts.push(`Characters:\n${ctx.characters}`)
  if (ctx.chapter) {
    if (props.mode === 'outline-agent') {
      parts.push([
        'The application has already selected the current chapter outline. Edit only this chapter outline; do not choose or request another chapter.',
        `Chapter: ${ctx.chapter.title}`,
        ctx.chapter.index !== undefined ? `Current Chapter Number: ${ctx.chapter.index + 1}` : '',
        ctx.chapter.outline ? `Current Chapter Outline:\n${JSON.stringify(ctx.chapter.outline, null, 2)}` : '',
      ].filter(Boolean).join('\n'))
    } else {
      parts.push([
        'The application has already selected the current chapter. Edit only this chapter; do not choose or request another chapter.',
        `Chapter: ${ctx.chapter.title}`,
        ctx.chapter.index !== undefined ? `Current Chapter Number: ${ctx.chapter.index + 1}` : '',
        ctx.chapter.outline ? `Chapter Outline:\n${JSON.stringify(ctx.chapter.outline, null, 2)}` : '',
        `Content Format: ${ctx.writingFormat || 'auto'}`,
        buildChapterContentContext(ctx.chapter.content, props.mode),
      ].filter(Boolean).join('\n'))
    }
  }
  if (ctx.character) parts.push(`Character: ${ctx.character.name} (${ctx.character.role})`)
  return parts.join('\n\n')
}

function buildPrompt(systemPrompt: string, contextPrompt: string, userMessage: string) {
  const ctx = props.context || {}
  if (props.mode === 'assistant') {
    return [
      systemPrompt,
      'Function Calling priority:',
      '- Prefer Function Calling whenever relevant tools are available.',
      '- Do not output tool-eligible structured edits as plain text.',
      '- Keep assistant prose minimal when a tool can carry the result.',
      '- When responding or summarizing modifications, use Markdown bullet points for clarity.',
      contextPrompt ? `Context:\n${contextPrompt}` : '',
      `User: ${userMessage}`,
    ].filter(Boolean).join('\n\n')
  }

  if (props.mode === 'outline-agent') {
    return [
      systemPrompt,
      'Rules:',
      '- Apply the user request to the current chapter outline fields only.',
      '- Preserve the chapter intent, story continuity, characters, and known facts unless the user explicitly asks for a change.',
      '- Prefer a localized outline field update when the request targets one field.',
      '- Use a complete outline rewrite only when multiple fields need coordinated changes.',
      '- Do not edit or generate chapter prose.',
      '- Function Calling first: when an outline tool can perform the requested work, call that tool before explanatory text.',
      '- Do not reply with the revised outline in plain text. Complete the edit by calling the appropriate outline tool only.',
      contextPrompt ? `Context:\n${contextPrompt}` : '',
      `User Request:\n${userMessage}`,
    ].filter(Boolean).join('\n\n')
  }

  return [
    systemPrompt,
    'Rules:',
    '- Apply the user request to the current chapter content.',
    '- Preserve the original language, names, continuity, and chapter intent unless the user explicitly asks otherwise.',
    '- Writing Style Guide has higher priority than Content Format. If they conflict, follow the Writing Style Guide.',
    '- Prefer a localized section edit when the user asks to change a small passage, sentence, paragraph, or dialogue exchange.',
    '- Use a full chapter replacement only when the request requires broad structural changes.',
    ctx.writingFormat === 'markdown'
      ? '- Preserve Markdown structure. Normalize headings, lists, emphasis, blockquotes, and spacing only when the request requires it.'
      : '- Output Plain Text by default. Do not use Markdown syntax, headings, lists, code fences, chapter title lines, or chapter number lines unless the Writing Style Guide explicitly requires them.',
    '- Function Calling first: when an editing tool can perform the requested work, call that tool before explanatory text.',
    '- Do not reply with the revised chapter in plain text. Complete the edit by calling the appropriate replacement tool only.',
    contextPrompt ? `Context:\n${contextPrompt}` : '',
    `User Request:\n${userMessage}`,
  ].filter(Boolean).join('\n\n')
}

function settleDanglingToolStatuses(
  nextStatus: Extract<ToolCallStatusItem['status'], 'warning' | 'error'>,
  detail: string
) {
  let changed = false
  toolStatuses.value = toolStatuses.value.map(item => {
    if (item.status !== 'pending' && item.status !== 'running') return item
    changed = true
    return {
      ...item,
      status: nextStatus,
      description: nextStatus === 'error' ? 'Tool execution failed' : 'Tool execution incomplete',
      detail,
    }
  })
  if (changed) {
    scheduleChatSave()
  }

  for (const message of messages.value) {
    if (!Array.isArray(message.toolStatuses) || !message.toolStatuses.length) continue
    message.toolStatuses = message.toolStatuses.map(item => {
      if (item.status !== 'pending' && item.status !== 'running') return item
      return {
        ...item,
        status: nextStatus,
        description: nextStatus === 'error' ? 'Tool execution failed' : 'Tool execution incomplete',
        detail,
      }
    })
  }
}

function sanitizeReasoningText(input: string) {
  return input
    .replace(/｜/g, '|')
    .replace(/<\|DSML\|tool_calls>[\s\S]*?<\/\|DSML\|tool_calls>/gi, '')
    .replace(/<\|DSML\|tool_>/gi, '')
    .replace(/<\|DSML\|[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function settleDanglingTodoItems(reason: string) {
  let changed = false
  todoItems.value = todoItems.value.map(item => {
    if (item.status !== 'in_progress') return item
    changed = true
    return {
      ...item,
      status: 'blocked',
      notes: reason,
    }
  })
  if (changed) {
    scheduleChatSave()
  }
}

function sanitizeReasoningTextSafe(input: string) {
  return input
    .replace(/｜/g, '|')
    .replace(/<\|DSML\|tool_calls>[\s\S]*?<\/\|DSML\|tool_calls>/gi, '')
    .replace(/<\|DSML\|tool_>/gi, '')
    .replace(/<\|DSML\|[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function getToolAnchorMessage() {
  if (streamingAssistantId.value) {
    const streaming = messages.value.find(item => item.id === streamingAssistantId.value && item.role === 'assistant')
    if (streaming) return streaming
  }
  for (let index = messages.value.length - 1; index >= 0; index--) {
    if (messages.value[index].role === 'assistant') return messages.value[index]
  }
  return null
}


async function sendMessage() {
  if (isLoadingConversation) {
    await conversationLoadPromise
  }
  if (!inputText.value.trim() || isLoading.value) return

  const userMessage = inputText.value.trim()
  const requestChapterId = typeof props.context?.chapter?.id === 'string' && props.context.chapter.id.trim()
    ? props.context.chapter.id.trim()
    : undefined
  const requestScopeKey = conversationScopeKey.value
  const requestProjectId = projectId.value
  const requestId = ++activeRequestId
  const abortController = new AbortController()
  currentAbortController = abortController
  const isRequestStale = () =>
    cancelledRequestIds.has(requestId)
    || abortController.signal.aborted
    || requestScopeKey !== conversationScopeKey.value
    || requestProjectId !== projectId.value
  const workspaceSnapshot = captureWorkspaceSnapshot()
  inputText.value = ''
  resetInputHeight()
  removeInitialGreeting()
  addMessage('user', userMessage, '', workspaceSnapshot ?? undefined)
  isLoading.value = true
  emit('loadingChange', true)
  toolStatuses.value = []
  todoItems.value = []
  currentReasoning.value = ''
  expandedReasoningMessageIds.value = new Set()
  manuallyExpandedToolMessageIds.value = new Set()
  
  startTimer()

  let activeAssistantMessageId = ''

  try {
    activeAssistantMessageId = addMessage('assistant', '')
    streamingAssistantId.value = activeAssistantMessageId
    
    const getActiveMessage = () => messages.value.find(item => item.id === activeAssistantMessageId)

    const onToolStatus = (status: ToolStatusUpdate) => {
      if (isRequestStale()) return
      updateToolStatus(status)
      const msg = getActiveMessage()
      if (msg) {
        const blocks = ensureAssistantWorkBlocks(msg)
        const toolItem = msg.toolStatuses?.find(t => t.name === status.name && (t.status === 'running' || t.status === 'pending' || t.status === status.status))
        const toolId = toolItem?.id || status.callId || ''
        if (toolId && !blocks.some(b => b.type === 'tool' && b.toolId === toolId)) {
          blocks.push({ id: `t-${toolId}-${Date.now()}`, type: 'tool', text: '', toolId })
        }
      }
    }

    const systemPrompt = stagePrompts[props.stage] || stagePrompts.planning
    const contextPrompt = buildContextPrompt()
    const fullPrompt = buildPrompt(systemPrompt, contextPrompt, userMessage)

    if (props.mode === 'editor-agent') {
      const currentContent = typeof props.context?.chapter?.content === 'string'
        ? props.context.chapter.content
        : ''
      const response = await genStore.editChapterWithTool(fullPrompt, {
        currentContent,
        modelRef: selectedModelRef.value,
        onToolStatus,
        onTodoList: state => {
          if (isRequestStale()) return
          todoItems.value = state.items
          agentTodoListState.value = state
          scheduleChatSave()
        },
        onToken: () => {},
        onReasoningToken: token => {
          if (isRequestStale()) return
          currentReasoning.value += token
          const safeReasoning = sanitizeReasoningTextSafe(currentReasoning.value)
          updateMessage(activeAssistantMessageId, { reasoning: safeReasoning })
          const msg = getActiveMessage()
          if (msg) {
            appendReasoningBlock(msg, token)
          }
        },
        signal: abortController.signal,
      })
      if (isRequestStale()) return
      emit('apply', { content: response.content, chapterId: requestChapterId })
      toast.success('Applied to editor')
      updateMessage(activeAssistantMessageId, {
        content: response.summary?.trim()
          ? response.summary.trim()
          : response.toolName === 'replace_chapter_section'
            ? 'Applied localized edit to the editor.'
            : 'Applied chapter replacement to the editor.',
        reasoning: sanitizeReasoningTextSafe(currentReasoning.value),
      })
    } else if (props.mode === 'outline-agent') {
      const currentTitle = typeof props.context?.chapter?.title === 'string' && props.context.chapter.title.trim()
        ? props.context.chapter.title.trim()
        : 'Untitled'
      const currentOutline = props.context?.chapter?.outline as ChapterOutline | undefined
      const response = await genStore.editChapterOutlineWithTool(fullPrompt, {
        currentTitle,
        currentOutline,
        modelRef: selectedModelRef.value,
        onToolStatus,
        onTodoList: state => {
          if (isRequestStale()) return
          todoItems.value = state.items
          agentTodoListState.value = state
          scheduleChatSave()
        },
        onToken: () => {},
        onReasoningToken: token => {
          if (isRequestStale()) return
          currentReasoning.value += token
          const safeReasoning = sanitizeReasoningTextSafe(currentReasoning.value)
          updateMessage(activeAssistantMessageId, { reasoning: safeReasoning })
          const msg = getActiveMessage()
          if (msg) {
            appendReasoningBlock(msg, token)
          }
        },
        signal: abortController.signal,
      })
      if (isRequestStale()) return
      emit('applyOutline', { title: response.title, outline: response.outline, chapterId: requestChapterId })
      toast.success('Applied to outline')
      updateMessage(activeAssistantMessageId, {
        content: response.summary?.trim()
          ? `Applied outline edit: ${response.summary.trim()}`
          : response.toolName === 'replace_chapter_outline_field'
            ? 'Applied outline field update.'
            : 'Applied chapter outline rewrite.',
        reasoning: sanitizeReasoningTextSafe(currentReasoning.value),
      })
    } else {
      const response = await genStore.chatWithAssistant(fullPrompt, selectedModelRef.value, {
        onToken: token => {
          if (isRequestStale()) return
          appendMessageContent(activeAssistantMessageId, token)
        },
        onReasoningToken: token => {
          if (isRequestStale()) return
          currentReasoning.value += token
          const safeReasoning = sanitizeReasoningTextSafe(currentReasoning.value)
          updateMessage(activeAssistantMessageId, { reasoning: safeReasoning })
          const msg = getActiveMessage()
          if (msg) {
            appendReasoningBlock(msg, token)
          }
        },
        onToolStatus,
        onTodoList: state => {
          if (isRequestStale()) return
          todoItems.value = state.items
          agentTodoListState.value = state
          scheduleChatSave()
        },
        onPlanningResult: result => {
          if (isRequestStale()) return
          if (typeof result.outline === 'string') {
            emit('applyPlanningOutline', { outline: result.outline })
          }
          if (Array.isArray(result.characters)) {
            emit('applyPlanningCharacters', { characters: result.characters })
          }
        },
        signal: abortController.signal,
      })
      if (isRequestStale()) return
      updateMessage(activeAssistantMessageId, { content: response, reasoning: sanitizeReasoningTextSafe(currentReasoning.value) })
    }
  } catch (error: any) {
    if (isRequestStale() || error?.name === 'AbortError') return
    settleDanglingToolStatuses('error', 'The request failed before the tool returned a final result.')
    settleDanglingTodoItems('This todo item was interrupted because the request failed.')
    toast.error(error?.message || 'Connection lost')
    addMessage('system', error?.message ? `Vibe AI error: ${error.message}` : 'System error: Unable to reach Vibe Engine.')
  } finally {
    if (activeRequestId === requestId) {
      const sameScope = requestScopeKey === conversationScopeKey.value && requestProjectId === projectId.value
      if (sameScope && !cancelledRequestIds.has(requestId) && !abortController.signal.aborted) {
        settleDanglingToolStatuses('warning', 'This tool call did not return a final result in the current run. You can resend the request to continue.')
        settleDanglingTodoItems('This todo item was interrupted when this run ended with unfinished checklist items.')
      }
      clearAgentTodoList()
      isLoading.value = false
      emit('loadingChange', false)
      streamingAssistantId.value = ''
      if (currentAbortController === abortController) currentAbortController = null
      
      stopTimer()
      if (sameScope && messages.value.length > 0) {
        const lastMsg = messages.value[messages.value.length - 1]
        if (lastMsg.role === 'assistant') {
          lastMsg.generationDurationMs = generationElapsedMs.value
          scheduleChatSave()
        }
      }
    }
    cancelledRequestIds.delete(requestId)
  }
}

function cancelCurrentResponse() {
  if (!isLoading.value) return
  cancelledRequestIds.add(activeRequestId)
  currentAbortController?.abort()
  currentAbortController = null
  const activeMessage = messages.value.find(item => item.id === streamingAssistantId.value)
  if (activeMessage && !activeMessage.content.trim() && !activeMessage.reasoning?.trim()) {
    activeMessage.content = 'Response interrupted before any visible content was generated.'
  }
  isLoading.value = false
  emit('loadingChange', false)
  streamingAssistantId.value = ''
  currentReasoning.value = ''
  settleDanglingToolStatuses('error', 'The current Vibe AI response was interrupted by the user.')
  todoItems.value = todoItems.value.map(item =>
    item.status === 'in_progress'
      ? { ...item, status: 'blocked', notes: 'Interrupted by user.' }
      : item
  )
  clearAgentTodoList()
  addMessage('system', 'Vibe AI response interrupted.')
  scheduleChatSave()
}

function updateToolStatus(status: ToolStatusUpdate) {
  const { callId, ...statusPayload } = status
  const normalizedCallId = callId?.trim() || ''
  const statusName = statusPayload.name
  const findRunningByName = (items: ToolCallStatusItem[]) =>
    items.find(item => item.name === statusName && (item.status === 'pending' || item.status === 'running'))

  const upsertStatus = (items: ToolCallStatusItem[]) => {
    const existingById = normalizedCallId ? items.find(item => item.id === normalizedCallId) : null
    const existingRunningByName = findRunningByName(items)
    const target = existingById || existingRunningByName
    if (target) {
      if (normalizedCallId) target.id = normalizedCallId
      Object.assign(target, statusPayload)
      return target.id
    }
    const id = normalizedCallId || `${statusName}-${Date.now()}`
    items.push({
      id,
      ...statusPayload,
    })
    return id
  }

  upsertStatus(toolStatuses.value)

  const anchor = getToolAnchorMessage()
  if (anchor) {
    if (!Array.isArray(anchor.toolStatuses)) {
      anchor.toolStatuses = []
    }
    upsertStatus(anchor.toolStatuses)
  }

  scheduleChatSave()
  scrollToBottom()
}


function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
  toast.success('Copied to clipboard')
}

function defaultHistoryTopic() {
  const chapterTitle = typeof props.context?.chapter?.title === 'string' ? props.context.chapter.title.trim() : ''
  if (chapterTitle) return chapterTitle
  const projectName = typeof props.context?.projectConfig?.name === 'string' ? props.context.projectConfig.name.trim() : ''
  if (projectName) return projectName
  return `${stageLabels[props.stage] || 'Assistant'} Session`
}

async function createAndSwitchConversation() {
  const entry = await createVibeConversationHistoryEntry(
    projectId.value,
    projectDirectoryPath.value,
    conversationScopeKey.value,
    {
      category: scopeCategory.value,
      event: scopeEvent.value,
      topic: defaultHistoryTopic(),
    }
  )
  const nextHistory = await listVibeConversationHistory(
    projectId.value,
    projectDirectoryPath.value,
    conversationScopeKey.value
  )
  conversationHistory.value = nextHistory
  activeConversationId.value = entry.id
  await loadConversationForCurrentScope()
}

async function clearChat() {
  showResetConfirm.value = false
  showRewindConfirm.value = false
  pendingRewindMessageId.value = ''
  showHistoryMenu.value = false
  await persistChatNow()
  await createAndSwitchConversation()
}

function requestClearChat() {
  if (hasConversationContent.value) {
    showResetConfirm.value = true
    return
  }
  void clearChat()
}

async function switchConversation(conversationId: string) {
  if (!conversationId || conversationId === activeConversationId.value) {
    showHistoryMenu.value = false
    return
  }
  activeConversationId.value = conversationId
  showHistoryMenu.value = false
  await loadConversationForCurrentScope()
}

async function deleteConversation(conversationId: string) {
  if (!conversationId) return
  await flushPendingChatSave()
  const target = conversationHistory.value.find(item => item.id === conversationId)
  if (!target) return

  const removed = await removeVibeConversationHistoryEntry(
    projectId.value,
    projectDirectoryPath.value,
    conversationScopeKey.value,
    conversationId
  )
  if (!removed) {
    toast.warning('Failed to delete conversation history entry')
    return
  }

  if (target.storageKey) {
    conversationMemoryCache.delete(scopeCacheKey({ projectId: projectId.value, storageKey: target.storageKey }))
  }

  let nextHistory = await listVibeConversationHistory(
    projectId.value,
    projectDirectoryPath.value,
    conversationScopeKey.value
  )

  if (!nextHistory.length) {
    await createVibeConversationHistoryEntry(
      projectId.value,
      projectDirectoryPath.value,
      conversationScopeKey.value,
      {
        category: scopeCategory.value,
        event: scopeEvent.value,
        topic: defaultHistoryTopic(),
      }
    )
    nextHistory = await listVibeConversationHistory(
      projectId.value,
      projectDirectoryPath.value,
      conversationScopeKey.value
    )
  }

  conversationHistory.value = nextHistory

  if (activeConversationId.value === conversationId) {
    activeConversationId.value = nextHistory[0]?.id || ''
    await loadConversationForCurrentScope()
  }
}

async function loadConversationForCurrentScope() {
  await flushPendingChatSave()
  if (activeConversationScope) {
    cacheCurrentConversation(activeConversationScope)
    await saveConversationScope(activeConversationScope)
  }

  const targetScope = {
    projectId: projectId.value,
    directoryPath: projectDirectoryPath.value,
    scopeKey: conversationScopeKey.value,
  }
  const runId = ++conversationLoadRun
  if (chatSaveTimer) {
    clearTimeout(chatSaveTimer)
    chatSaveTimer = null
  }

  isLoadingConversation = true
  try {
    const history = await ensureVibeConversationHistory(
      targetScope.projectId,
      targetScope.directoryPath,
      targetScope.scopeKey,
      {
        category: scopeCategory.value,
        event: scopeEvent.value,
        topic: defaultHistoryTopic(),
      }
    )
    if (runId !== conversationLoadRun) return
    conversationHistory.value = history
    let targetConversation = history.find(item => item.id === activeConversationId.value) ?? history[0] ?? null
    if (!targetConversation) {
      targetConversation = await createVibeConversationHistoryEntry(
        targetScope.projectId,
        targetScope.directoryPath,
        targetScope.scopeKey,
        {
          category: scopeCategory.value,
          event: scopeEvent.value,
          topic: defaultHistoryTopic(),
        }
      )
      conversationHistory.value = await listVibeConversationHistory(
        targetScope.projectId,
        targetScope.directoryPath,
        targetScope.scopeKey
      )
    }
    activeConversationId.value = targetConversation.id
    activeConversationScope = {
      ...targetScope,
      conversationId: targetConversation.id,
      storageKey: targetConversation.storageKey,
    }
    const stored = await loadVibeConversation(targetScope.projectId, targetScope.directoryPath, targetConversation.storageKey)
    const cached = conversationMemoryCache.get(scopeCacheKey(activeConversationScope))
    const restored = hydrateMessages(cached?.messages ?? stored?.messages)
    messages.value = restored
    expandedMessageIds.value = new Set()
    expandedReasoningMessageIds.value = new Set()
    manuallyExpandedToolMessageIds.value = new Set()
    toolStatuses.value = hydrateToolStatuses(cached?.toolStatuses ?? stored?.toolStatuses)
    attachLegacyToolStatusesToLatestAssistant(toolStatuses.value)
    todoItems.value = hydrateTodoItems(cached?.todoItems ?? stored?.todoItems)
    currentReasoning.value = ''
    if (
      toolStatuses.value.some(item => item.description === 'Tool execution was interrupted')
      || todoItems.value.some(item => item.notes === 'This todo item was interrupted when the app or conversation stopped.')
    ) {
      scheduleChatSave()
    }

    if (!messages.value.length) {
      messages.value = [createGreetingMessage()]
    }
    await saveConversationScope(activeConversationScope)
  } finally {
    if (runId === conversationLoadRun) {
      isLoadingConversation = false
      scrollToBottom()
    }
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

watch([projectId, conversationScopeKey], () => {
  if (isLoading.value && currentAbortController) {
    cancelledRequestIds.add(activeRequestId)
    currentAbortController.abort()
    currentAbortController = null
    streamingAssistantId.value = ''
  }
  conversationLoadPromise = loadConversationForCurrentScope()
}, { immediate: true })

watch(() => ui.vibeRewindPoints, () => {
  pruneWorkspaceSnapshots()
  scheduleChatSave()
})

onBeforeUnmount(() => {
  void persistChatNow()
})

watch(() => ui.vibeModelRef, value => {
  selectedModelValue.value = value
}, { immediate: true })

watch(selectedModelValue, value => {
  if (value !== ui.vibeModelRef) ui.setVibeModelRef(value)
})

watch(() => genStore.streamContent, async () => {
  await nextTick()
  if (generationStreamContainer.value) {
    generationStreamContainer.value.scrollTop = generationStreamContainer.value.scrollHeight
  }
})

function runQuickAction(action: string) {
  inputText.value = action
  void sendMessage()
}

async function submitRequest(request: string) {
  await conversationLoadPromise
  inputText.value = request
  await sendMessage()
}

function isUserMessageCollapsible(message: ChatMessage) {
  if (message.role !== 'user') return false
  return message.content.split(/\r?\n/).length > 6 || message.content.length > 320
}

function isMessageExpanded(messageId: string) {
  return expandedMessageIds.value.has(messageId)
}

function toggleMessageExpanded(messageId: string) {
  const next = new Set(expandedMessageIds.value)
  if (next.has(messageId)) next.delete(messageId)
  else next.add(messageId)
  expandedMessageIds.value = next
}

function isReasoningExpanded(messageId: string) {
  return expandedReasoningMessageIds.value.has(messageId)
}

function toggleReasoningExpanded(messageId: string) {
  const next = new Set(expandedReasoningMessageIds.value)
  if (next.has(messageId)) next.delete(messageId)
  else next.add(messageId)
  expandedReasoningMessageIds.value = next
}

function isToolsExpanded(msg: ChatMessage) {
  if (msg.id === streamingAssistantId.value) return true
  return manuallyExpandedToolMessageIds.value.has(msg.id)
}

function toggleToolsExpanded(msgId: string) {
  const next = new Set(manuallyExpandedToolMessageIds.value)
  if (next.has(msgId)) next.delete(msgId)
  else next.add(msgId)
  manuallyExpandedToolMessageIds.value = next
}

function rewindToMessageSnapshot(message: ChatMessage) {
  if (isLoading.value) {
    toast.warning('Please wait for the current response to finish before rewinding.')
    return
  }
  if (!message.workspaceSnapshot || message.role !== 'user') return
  pendingRewindMessageId.value = message.id
  showRewindConfirm.value = true
}

function pendingRewindMessage() {
  if (!pendingRewindMessageId.value) return null
  return messages.value.find(item => item.id === pendingRewindMessageId.value) ?? null
}

const pendingRewindPreview = computed(() => {
  const target = pendingRewindMessage()
  if (!target) return ''
  return target.content.replace(/\s+/g, ' ').slice(0, 160)
})

async function confirmRewindWorkspace() {
  const target = pendingRewindMessage()
  showRewindConfirm.value = false
  pendingRewindMessageId.value = ''
  if (!target || !target.workspaceSnapshot || target.role !== 'user') return
  const targetIndex = messages.value.findIndex(item => item.id === target.id)
  if (targetIndex < 0) return

  const snapshot = cloneJsonSafe(target.workspaceSnapshot)
  if (!snapshot) return

  const restorePrompt = target.content
  messages.value = messages.value.slice(0, targetIndex)
  inputText.value = restorePrompt
  expandedMessageIds.value = new Set()
  expandedReasoningMessageIds.value = new Set()
  currentReasoning.value = ''
  toolStatuses.value = []
  todoItems.value = []
  clearAgentTodoList()
  scheduleChatSave()
  resetInputHeight()
  await nextTick()
  inputTextarea.value?.focus()

  emit('rewind', snapshot)
  toast.success('Workspace and conversation rewound')
}

function systemMessageTone(message: ChatMessage) {
  const content = message.content.toLowerCase()
  if (content.includes('unable to reach') || content.includes('error')) return 'danger'
  if (content.includes('interrupted') || content.includes('cancel')) return 'warning'
  return 'default'
}

defineExpose({
  submitRequest,
  cancelCurrentResponse,
})
</script>

<template>
  <div class="relative flex h-full min-h-0 flex-col overflow-hidden bg-surface-1 font-sans">
    <!-- Clean Header -->
    <div class="relative shrink-0 px-3 py-2 flex items-center justify-between border-b border-surface-4">
      <div class="flex items-center gap-2 min-w-0">
        <div class="flex items-center justify-center w-6 h-6 rounded-md bg-accent/10 border border-accent/20 shrink-0">
          <Sparkles :size="13" class="text-accent" />
        </div>
        <div class="min-w-0">
          <h3 class="text-xs font-semibold text-text-primary tracking-tight truncate">{{ tr('Vibe AI') }}</h3>
          <p class="text-[9px] uppercase tracking-widest text-text-muted font-bold truncate">
            {{ tr(stageLabels[stage] || 'Assistant') }} · {{ activeConversationLabel }}
          </p>
        </div>
      </div>
      <div class="flex items-center gap-1">
        <button
          class="p-1.5 text-text-muted hover:text-accent hover:bg-accent/5 rounded transition-all"
          :title="tr('Conversation History')"
          @click="showHistoryMenu = !showHistoryMenu"
        >
          <History :size="13" />
        </button>
        <button
          class="p-1.5 text-text-muted hover:text-accent hover:bg-accent/5 rounded transition-all"
          :title="tr('New Conversation')"
          @click="requestClearChat"
        >
          <RotateCcw :size="13" />
        </button>
      </div>
      <div
        v-if="showHistoryMenu"
        class="absolute right-3 top-9 z-50 w-80 rounded-lg border border-surface-4 bg-surface-1 p-3 shadow-xl"
      >
        <div class="mb-2 flex items-center justify-between">
          <p class="text-xs font-semibold text-text-primary">{{ tr('Conversation History') }}</p>
          <button
            class="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent hover:bg-accent/20"
            @click="clearChat"
          >
            <Plus :size="11" />
            {{ tr('New') }}
            </button>
        </div>
        <div v-if="conversationHistory.length" class="max-h-64 space-y-1 overflow-y-auto pr-1 custom-scrollbar">
          <div
            v-for="entry in conversationHistory"
            :key="entry.id"
            class="group relative"
          >
            <button
              class="w-full rounded-md border px-2.5 py-2 pr-9 text-left transition-colors"
              :class="entry.id === activeConversationId ? 'border-accent/40 bg-accent/10' : 'border-surface-4 bg-surface-2/60 hover:border-surface-3'"
              @click="switchConversation(entry.id)"
            >
              <p class="truncate text-[11px] font-medium text-text-primary">
                {{ entry.topic || tr('Untitled conversation') }}
              </p>
              <p class="mt-1 truncate text-[10px] text-text-muted">
              {{ entry.category }} / {{ entry.event }} · {{ new Date(entry.updatedAt).toLocaleString() }}
              </p>
            </button>
            <button
              class="absolute right-1.5 top-1.5 rounded p-1 text-text-muted transition-colors hover:bg-danger/15 hover:text-danger"
              :title="tr('Delete Conversation')"
              @click.stop="deleteConversation(entry.id)"
            >
              <Trash2 :size="12" />
            </button>
          </div>
        </div>
        <p v-else class="text-[11px] text-text-muted">{{ tr('No saved history in this scope yet.') }}</p>
      </div>
      <div
        v-if="showResetConfirm"
        class="absolute right-3 top-9 z-50 w-72 rounded-lg border border-surface-4 bg-surface-1 p-3 shadow-xl"
      >
        <p class="text-xs font-semibold text-text-primary">{{ tr('Create a new conversation?') }}</p>
        <p class="mt-1 text-[11px] leading-relaxed text-text-secondary">
          {{ tr('The current conversation will be kept in history, and a new conversation will start for this same category/event/topic scope.') }}
        </p>
        <div class="mt-3 flex justify-end gap-2">
          <button
            class="rounded-md px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-2 hover:text-text-primary"
            @click="showResetConfirm = false"
          >
            {{ tr('Cancel') }}
          </button>
          <button
            class="rounded-md bg-danger px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-danger/90"
            @click="clearChat"
          >
            {{ tr('Start New') }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="showRewindConfirm"
      class="absolute inset-0 z-[70] flex items-center justify-center bg-black/45 px-4"
    >
      <div class="w-full max-w-sm rounded-lg border border-surface-4 bg-surface-1 p-4 shadow-2xl">
        <p class="text-sm font-semibold text-text-primary">{{ tr('Rewind workspace and conversation?') }}</p>
        <p class="mt-2 text-xs leading-relaxed text-text-secondary">
          {{ tr('This will restore the workspace snapshot, remove this user message and all following messages, then put that user message back into the input box.') }}
        </p>
        <p v-if="pendingRewindPreview" class="mt-3 rounded-md border border-surface-4 bg-surface-2 px-2.5 py-2 text-[11px] text-text-muted">
          {{ pendingRewindPreview }}
        </p>
        <div class="mt-4 flex justify-end gap-2">
          <button
            class="rounded-md px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-2 hover:text-text-primary"
            @click="showRewindConfirm = false; pendingRewindMessageId = ''"
          >
            {{ tr('Cancel') }}
          </button>
          <button
            class="rounded-md bg-warning px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-warning/90"
            @click="confirmRewindWorkspace"
          >
            {{ tr('Rewind') }}
          </button>
          </div>
      </div>
    </div>

    <VibeModelPicker
      v-model="selectedModelValue"
      role="editingAI"
    />

    <div
      v-if="showGlobalGenerationPanel"
      class="shrink-0 border-b border-surface-4 bg-surface-1 px-3 py-3 space-y-3"
    >
      <div
        v-if="genStore.isGenerating || genStore.streamContent"
        class="overflow-hidden rounded-lg border border-surface-4 bg-surface-2/80"
      >
        <div class="flex items-center justify-between gap-2 border-b border-surface-4 px-3 py-2">
          <div class="flex min-w-0 items-center gap-2">
            <Loader2 v-if="genStore.isGenerating" :size="12" class="shrink-0 animate-spin text-accent" />
            <Sparkles v-else :size="12" class="shrink-0 text-accent" />
            <span class="truncate text-xs font-semibold text-text-primary">{{ tr(globalGenerationStageLabel) }}</span>
          </div>
          <span v-if="globalGenerationProgressText" class="truncate text-[10px] text-text-muted">
            {{ tr(globalGenerationProgressText) }}
          </span>
        </div>
        <div
          v-if="genStore.streamContent"
          ref="generationStreamContainer"
          class="max-h-[160px] overflow-y-auto px-3 py-2 text-xs leading-relaxed text-text-secondary whitespace-pre-wrap custom-scrollbar"
        >
          {{ genStore.streamContent }}
        </div>
      </div>
      <TodoListStatus
        v-if="agentTodoListState.items.length"
        :items="agentTodoListState.items"
        :agent="agentTodoListState.agent"
        title="Agent Todo"
        compact
      />
    </div>

    <!-- Minimalist Chat Container -->
    <div
      ref="chatContainer"
      class="min-h-0 flex-1 overflow-y-auto px-4 py-5 custom-scrollbar"
    >
      <div v-if="shouldShowQuickActions" class="grid grid-cols-1 gap-2 mb-4 -mt-2">
        <button
          v-for="action in activeQuickActions"
          :key="action"
          class="text-left rounded-lg border border-surface-4 bg-surface-2/60 px-3 py-2 text-xs text-text-secondary hover:border-accent/40 hover:text-text-primary transition-colors"
          :disabled="isLoading"
          @click="runQuickAction(action)"
        >
          <Wand2 :size="12" class="inline mr-1.5 text-accent" />
          {{ tr(action) }}
        </button>
      </div>

      <div
        v-for="(msg, index) in messages"
        :key="msg.id"
        class="group flex flex-col"
        :class="index > 0 ? (messages[index - 1].role === msg.role ? 'gap-1 mt-1' : 'gap-3 mt-4') : 'gap-3'"
      >
        <!-- Message Role Label (Minimalist Cursor Style) -->
        <div v-if="index === 0 || messages[index - 1].role !== msg.role" class="flex items-center justify-between select-none">
          <div class="flex items-center gap-2">
            <div v-if="msg.role === 'user'" class="flex items-center justify-center w-5 h-5 rounded-full bg-surface-3 text-text-primary">
              <User :size="11" />
            </div>
            <div v-else-if="msg.role === 'assistant'" class="flex items-center justify-center w-5 h-5 rounded-md bg-accent/10 text-accent">
              <Sparkles :size="11" />
            </div>
            <div v-else class="flex items-center justify-center w-5 h-5 rounded-sm bg-surface-3">
              <AlertTriangle :size="11" :class="systemMessageTone(msg) === 'danger' ? 'text-danger' : systemMessageTone(msg) === 'warning' ? 'text-warning' : 'text-text-muted'" />
            </div>
            
            <span class="text-[11px] font-semibold text-text-primary">
              {{ msg.role === 'user' ? tr('You') : msg.role === 'assistant' ? tr('Vibe Engine') : tr('System') }}
            </span>
          </div>
          
          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <span class="text-[10px] text-text-muted">
              {{ msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
            </span>
            <button
              v-if="msg.role === 'assistant' || msg.role === 'user'"
              class="flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors"
              :title="tr('Copy')"
              @click="copyToClipboard(msg.content)"
            >
              <Copy :size="11" />
            </button>
          </div>
        </div>

        <!-- Content Body (Minimalist Cursor Style) -->
        <div
          :class="[
            'leading-relaxed max-w-full transition-all text-[13px] relative',
            msg.role === 'user' 
              ? 'text-text-primary pl-7'
              : msg.role === 'system'
                ? [
                    'rounded text-[11px] px-2 py-1',
                    systemMessageTone(msg) === 'danger'
                      ? 'bg-danger/10 text-danger'
                      : systemMessageTone(msg) === 'warning'
                        ? 'bg-warning/10 text-warning'
                        : 'bg-surface-2 text-text-secondary',
                  ]
              : 'text-text-primary pl-7'
          ]"
        >
          <!-- Contiguous Copy Button & Timestamp (Only visible on hover when header is hidden) -->
          <div 
            v-if="index > 0 && messages[index - 1].role === msg.role"
            class="absolute -left-2 -top-1 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center gap-1"
          >
            <button
              v-if="msg.role === 'assistant' || msg.role === 'user'"
              class="flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors"
              :title="tr('Copy')"
              @click="copyToClipboard(msg.content)"
            >
              <Copy :size="10" />
            </button>
          </div>

          <!-- Initial Pulsing Loader (Cursor Style) -->
          <div
            v-if="msg.role === 'assistant' && !msg.content && !msg.reasoning && !msg.toolStatuses?.length && isLoading && msg.id === streamingAssistantId"
            class="flex items-center h-6 mb-1"
          >
            <div class="flex items-center gap-1.5 opacity-60">
              <div class="h-1.5 w-1.5 rounded-full bg-text-muted animate-bounce" style="animation-delay: 0ms"></div>
              <div class="h-1.5 w-1.5 rounded-full bg-text-muted animate-bounce" style="animation-delay: 150ms"></div>
              <div class="h-1.5 w-1.5 rounded-full bg-text-muted animate-bounce" style="animation-delay: 300ms"></div>
            </div>
          </div>

          <!-- Work Process Block (Before Content) -->
          <div
            v-if="msg.role === 'assistant' && (workBlocksBeforeContent(msg).length || ((msg.reasoning || msg.toolStatuses?.length) && !(msg.workBlocks && msg.workBlocks.length)))"
            class="mb-2"
          >
            <!-- Group Header -->
            <button
              class="flex items-center gap-1.5 text-[11px] font-medium text-text-muted hover:text-text-primary transition-colors"
              @click="toggleToolsExpanded(msg.id)"
            >
              <LoaderCircle v-if="isLoading && msg.id === streamingAssistantId" :size="11" class="animate-spin text-accent" />
              <Brain v-else :size="11" class="text-text-muted" />
              
              <span>
                {{ (isLoading && msg.id === streamingAssistantId) ? tr('Working...') : tr('Work Process') }}
              </span>

              <span class="opacity-70">
                <span v-if="msg.toolStatuses?.length">· {{ msg.toolStatuses.length }} {{ msg.toolStatuses.length === 1 ? tr('tool') : tr('tools') }}</span>
                <span v-if="msg.generationDurationMs">· {{ (msg.generationDurationMs / 1000).toFixed(1) }}s</span>
                <span v-else-if="isLoading && msg.id === streamingAssistantId">· {{ (generationElapsedMs / 1000).toFixed(1) }}s</span>
              </span>

              <ChevronDown v-if="isToolsExpanded(msg)" :size="11" class="ml-1" />
              <ChevronRight v-else :size="11" class="ml-1" />
            </button>

            <!-- Group Body -->
            <div v-if="isToolsExpanded(msg)" class="mt-1.5 space-y-2 pl-3 border-l-2 border-surface-4">
              <template v-if="msg.workBlocks && msg.workBlocks.length">
                <div v-for="block in workBlocksBeforeContent(msg)" :key="block.id">
                  <div v-if="block.type === 'reasoning' && block.text.trim()" class="text-[11px] leading-relaxed text-text-muted whitespace-pre-wrap">
                    {{ sanitizeReasoningTextSafe(block.text) }}
                  </div>
                  <div v-else-if="block.type === 'tool'" class="mt-1">
                    <ToolCallStatus
                      v-if="msg.toolStatuses?.find(t => t.id === block.toolId)"
                      :item="msg.toolStatuses.find(t => t.id === block.toolId)!"
                    />
                  </div>
                </div>
              </template>
              <template v-else>
                <!-- Fallback for old history without blocks -->
                <div v-if="msg.reasoning" class="text-[11px] leading-relaxed text-text-muted whitespace-pre-wrap">
                  {{ msg.reasoning }}
                </div>
                <div v-if="msg.toolStatuses?.length" class="space-y-1 mt-1">
                  <ToolCallStatus
                    v-for="tool in msg.toolStatuses"
                    :key="tool.id"
                    :item="tool"
                  />
                </div>
              </template>
            </div>
          </div>

          <div
            v-if="msg.content"
            :class="[
              msg.role === 'assistant' ? 'markdown-body text-[13px] leading-relaxed break-words' : 'whitespace-pre-wrap',
              msg.role === 'user' && isUserMessageCollapsible(msg) && !isMessageExpanded(msg.id) ? 'max-h-[9.6em] overflow-hidden relative' : ''
            ]"
          >
            <template v-if="msg.role === 'assistant'">
              <div v-html="markdownToHtml(msg.content)"></div>
            </template>
            <template v-else>
              {{ msg.role === 'system' ? tr(msg.content) : msg.content }}
            </template>
            <div v-if="msg.role === 'user' && isUserMessageCollapsible(msg) && !isMessageExpanded(msg.id)" class="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-surface-1 to-transparent pointer-events-none"></div>
          </div>

          <!-- Work Process Block (After Content) -->
          <div
            v-if="msg.role === 'assistant' && workBlocksAfterContent(msg).length"
            class="mt-2 mb-1"
          >
            <button
              class="flex items-center gap-1.5 text-[11px] font-medium text-text-muted hover:text-text-primary transition-colors"
              @click="toggleToolsExpanded(msg.id)"
            >
              <LoaderCircle v-if="isLoading && msg.id === streamingAssistantId" :size="11" class="animate-spin text-accent" />
              <Brain v-else :size="11" class="text-text-muted" />
              <span>{{ tr('Work Process') }}</span>
              <ChevronDown v-if="isToolsExpanded(msg)" :size="11" class="ml-1" />
              <ChevronRight v-else :size="11" class="ml-1" />
            </button>

            <div v-if="isToolsExpanded(msg)" class="mt-1.5 space-y-2 pl-3 border-l-2 border-surface-4">
              <div v-for="block in workBlocksAfterContent(msg)" :key="block.id">
                <div v-if="block.type === 'reasoning' && block.text.trim()" class="text-[11px] leading-relaxed text-text-muted whitespace-pre-wrap">
                  {{ sanitizeReasoningTextSafe(block.text) }}
                </div>
                <div v-else-if="block.type === 'tool'" class="mt-1">
                  <ToolCallStatus
                    v-if="msg.toolStatuses?.find(t => t.id === block.toolId)"
                    :item="msg.toolStatuses.find(t => t.id === block.toolId)!"
                  />
                </div>
              </div>
            </div>
          </div>

          <div v-if="msg.role === 'user'" class="flex items-center gap-3 mt-1">
            <button
              v-if="isUserMessageCollapsible(msg)"
              class="text-[11px] font-medium text-accent hover:text-accent/80"
              @click="toggleMessageExpanded(msg.id)"
            >
              {{ tr(isMessageExpanded(msg.id) ? 'Collapse' : 'Expand') }}
            </button>
            <button
              v-if="msg.workspaceSnapshot"
              class="text-[11px] font-medium text-warning hover:text-warning/80"
              :title="tr('Restore the workspace to the state before this request.')"
              @click="rewindToMessageSnapshot(msg)"
            >
              {{ tr('Rewind workspace') }}
            </button>
          </div>

          </div>
        </div>

    </div>

    <div class="shrink-0 border-t border-surface-4 bg-surface-1/95 p-3">
      <div class="rounded-2xl border border-surface-4 bg-surface-2/80 px-3 py-2 shadow-sm transition-colors focus-within:border-accent/40 focus-within:bg-surface-2">
        <div class="flex items-start gap-2">
          <textarea
            ref="inputTextarea"
            v-model="inputText"
            rows="1"
            :placeholder="tr('Describe a vibe, ask for advice...')"
            class="min-h-[48px] max-h-[132px] flex-1 resize-none bg-transparent px-0 py-1 text-sm leading-relaxed text-text-primary placeholder:text-text-muted/70 focus:ring-0 custom-scrollbar"
            @keydown="handleKeydown"
            @input="(e) => {
              const el = e.target as HTMLElement;
              el.style.height = 'auto';
              el.style.height = el.scrollHeight + 'px';
            }"
          ></textarea>
        </div>
        <div class="mt-2 flex items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-1.5 text-[10px] text-text-muted">
            <span
              v-if="mode === 'editor-agent' || mode === 'outline-agent'"
              class="rounded-md bg-surface-3 px-2 py-1 font-medium text-text-secondary"
            >
              {{ tr('Tool edit mode') }}
            </span>
            <span
              v-else
              class="rounded-md bg-surface-3 px-2 py-1 font-medium text-text-secondary"
            >
              {{ tr('Vibe Engine') }}
            </span>
            <span class="hidden truncate sm:inline">{{ tr('Shift + Enter for new line') }}</span>
          </div>
          <button
            :disabled="!inputText.trim() && !isLoading"
            class="grid h-8 w-8 shrink-0 place-items-center rounded-full p-0 text-white shadow-sm transition-all hover:shadow-md active:scale-95 disabled:bg-surface-4 disabled:text-text-muted disabled:shadow-none"
            :class="isLoading ? 'bg-warning shadow-warning/20 hover:shadow-warning/25' : 'bg-accent shadow-accent/20 hover:shadow-accent/25'"
            :title="tr(isLoading ? 'Interrupt response' : 'Send')"
            @click="isLoading ? cancelCurrentResponse() : sendMessage()"
          >
            <Square v-if="isLoading" :size="13" />
            <ArrowUp v-else :size="16" stroke-width="2.4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.05);
  border-radius: 10px;
}
.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.05);
}

textarea {
  outline: none !important;
}

/* Animations inspired by Claude */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}

.group {
  animation: fadeIn 0.4s ease-out forwards;
}

/* Minimalist Markdown Styles */
:deep(.markdown-body p) {
  margin-bottom: 0.75em;
}
:deep(.markdown-body p:last-child) {
  margin-bottom: 0;
}
:deep(.markdown-body ul) {
  list-style-type: disc;
  padding-left: 1.5em;
  margin-bottom: 0.75em;
}
:deep(.markdown-body ol) {
  list-style-type: decimal;
  padding-left: 1.5em;
  margin-bottom: 0.75em;
}
:deep(.markdown-body li) {
  margin-bottom: 0.25em;
}
:deep(.markdown-body strong) {
  font-weight: 600;
  color: var(--text-primary);
}
:deep(.markdown-body code) {
  background: var(--surface-3);
  padding: 0.1em 0.3em;
  border-radius: 0.25em;
  font-family: monospace;
  font-size: 0.9em;
}
:deep(.markdown-body pre) {
  background: var(--surface-2);
  padding: 0.75em;
  border-radius: 0.375em;
  overflow-x: auto;
  margin-bottom: 0.75em;
}
:deep(.markdown-body h1), :deep(.markdown-body h2), :deep(.markdown-body h3), :deep(.markdown-body h4) {
  font-weight: 600;
  margin-top: 1em;
  margin-bottom: 0.5em;
  color: var(--text-primary);
}
</style>
