<script setup lang="ts">
import { computed, ref, nextTick, onBeforeUnmount, watch } from 'vue'
import { useGenerationStore } from '@/stores/generation'
import { useUiStore } from '@/stores/ui'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'
import { decodeProviderModelRef } from '@/services/provider/catalog'
import { loadVibeConversation, saveVibeConversation, type StoredVibeChatMessage } from '@/services/vibeChatStorage'
import ToolCallStatus, { type ToolCallStatusItem } from '@/components/ui/ToolCallStatus.vue'
import TodoListStatus from '@/components/ui/TodoListStatus.vue'
import VibeModelPicker from '@/components/workspace/VibeModelPicker.vue'
import { agentTodoListState, type AgentTodoItem } from '@/services/agent/todolist'
import type { ChapterOutline } from '@/types/chapter'
import { AlertTriangle, ArrowUp, Loader2, LoaderCircle, Square, Sparkles, RotateCcw, User, Check, Copy, Wand2, ChevronDown, Brain } from 'lucide-vue-next'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  reasoning?: string
  workspaceSnapshot?: unknown
  timestamp: Date
}

const props = withDefaults(defineProps<{
  stage: string
  context?: Record<string, any>
  mode?: 'assistant' | 'editor-agent' | 'outline-agent'
}>(), {
  mode: 'assistant',
})

const emit = defineEmits<{
  apply: [content: string]
  applyOutline: [payload: { title: string; outline: ChapterOutline }]
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
const reasoningExpanded = ref(false)
const currentReasoning = ref('')
const streamingAssistantId = ref('')
const showResetConfirm = ref(false)
const selectedModelValue = ref('')
let chatSaveTimer: ReturnType<typeof setTimeout> | null = null
let isLoadingConversation = false
let pendingChatSave: (() => Promise<boolean>) | null = null
let conversationLoadRun = 0
let conversationLoadPromise: Promise<void> = Promise.resolve()
let activeConversationScope: { projectId: string; directoryPath?: string; key: string } | null = null
const conversationMemoryCache = new Map<string, { messages: StoredVibeChatMessage[]; toolStatuses: ToolCallStatusItem[]; todoItems: AgentTodoItem[] }>()
let activeRequestId = 0
let currentAbortController: AbortController | null = null
const cancelledRequestIds = new Set<number>()

function tr(value: string) {
  return translatePhrase(value)
}

const selectedModelRef = computed(() => decodeProviderModelRef(selectedModelValue.value))

const projectId = computed(() => String(props.context?.projectId ?? 'local'))
const projectDirectoryPath = computed(() => typeof props.context?.directoryPath === 'string' ? props.context.directoryPath : undefined)
const conversationKey = computed(() => {
  const chapterId = typeof props.context?.chapter?.id === 'string' && props.context.chapter.id.trim()
    ? props.context.chapter.id.trim()
    : 'global'
  return `${props.stage}.${props.mode}.${chapterId}`
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
  planning: 'You are a story planning assistant. Help the user refine their story outline and character designs. Provide creative suggestions, identify plot holes, and help develop compelling narratives. Relationship query tools are not available in this stage, so rely on the current outline and characters only.',
  'chapter-outline': 'You are a chapter planning assistant. Help the user structure their chapters effectively. Suggest improvements to chapter flow, pacing, and story beats.',
  'chapter-outline-review': 'You are a chapter plan review assistant. This optional stage is scaffolded only; provide high-level review notes without mutating chapter data unless the user explicitly asks for an edit.',
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
  scheduleChatSave()
  scrollToBottom()
}

function appendMessageContent(id: string, token: string) {
  const message = messages.value.find(item => item.id === id)
  if (!message) return
  message.content += token
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
    workspaceSnapshot: message.workspaceSnapshot,
    timestamp: message.timestamp instanceof Date
      ? message.timestamp.toISOString()
      : new Date(message.timestamp).toISOString(),
  }))
}

function scopeCacheKey(scope: { projectId: string; key: string }) {
  return `${scope.projectId}:${scope.key}`
}

function cacheCurrentConversation(scope = activeConversationScope) {
  if (!scope) return
  conversationMemoryCache.set(scopeCacheKey(scope), {
    messages: serializeMessages(),
    toolStatuses: toolStatuses.value.map(item => ({ ...item })),
    todoItems: todoItems.value.map(item => ({ ...item })),
  })
}

async function saveConversationScope(scope: { projectId: string; directoryPath?: string; key: string }) {
  const cached = conversationMemoryCache.get(scopeCacheKey(scope))
  const messagesToSave = cached?.messages ?? serializeMessages()
  const toolStatusesToSave = cached?.toolStatuses ?? toolStatuses.value.map(item => ({ ...item }))
  const todoItemsToSave = cached?.todoItems ?? todoItems.value.map(item => ({ ...item }))
  await saveVibeConversation(scope.projectId, scope.directoryPath, scope.key, messagesToSave, {
    toolStatuses: toolStatusesToSave,
    todoItems: todoItemsToSave,
  })
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
  const scopedKey = conversationKey.value
  const scopedMessages = serializeMessages()
  const scopedUiState = serializeUiState()
  conversationMemoryCache.set(scopeCacheKey({ projectId: scopedProjectId, key: scopedKey }), {
    messages: scopedMessages,
    toolStatuses: scopedUiState.toolStatuses,
    todoItems: scopedUiState.todoItems,
  })
  pendingChatSave = () => saveVibeConversation(scopedProjectId, scopedDirectoryPath, scopedKey, scopedMessages, scopedUiState)
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
      workspaceSnapshot: message.workspaceSnapshot,
      timestamp: message.timestamp ? new Date(message.timestamp) : new Date(),
    }))
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
    return contextPrompt
      ? `${systemPrompt}\n\nContext:\n${contextPrompt}\n\nUser: ${userMessage}`
      : `${systemPrompt}\n\nUser: ${userMessage}`
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
    '- Do not reply with the revised chapter in plain text. Complete the edit by calling the appropriate replacement tool only.',
    contextPrompt ? `Context:\n${contextPrompt}` : '',
    `User Request:\n${userMessage}`,
  ].filter(Boolean).join('\n\n')
}

function extractApplicableContent(value: string) {
  const trimmed = value.trim()
  const fenced = /^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed)
  return fenced ? fenced[1].trim() : trimmed
}

async function sendMessage() {
  if (isLoadingConversation) {
    await conversationLoadPromise
  }
  if (!inputText.value.trim() || isLoading.value) return

  const userMessage = inputText.value.trim()
  const requestId = ++activeRequestId
  const abortController = new AbortController()
  currentAbortController = abortController
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
  reasoningExpanded.value = false

  try {
    const systemPrompt = stagePrompts[props.stage] || stagePrompts.planning
    const contextPrompt = buildContextPrompt()
    const fullPrompt = buildPrompt(systemPrompt, contextPrompt, userMessage)

    if (props.mode === 'editor-agent') {
      const currentContent = typeof props.context?.chapter?.content === 'string'
        ? props.context.chapter.content
        : ''
      const assistantMessageId = addMessage('assistant', '')
      streamingAssistantId.value = assistantMessageId
      const response = await genStore.editChapterWithTool(fullPrompt, {
        currentContent,
        modelRef: selectedModelRef.value,
        onToolStatus: updateToolStatus,
        onTodoList: state => {
          if (cancelledRequestIds.has(requestId)) return
          todoItems.value = state.items
          scheduleChatSave()
        },
        onToken: () => {},
        onReasoningToken: token => {
          if (cancelledRequestIds.has(requestId)) return
          currentReasoning.value += token
          updateMessage(assistantMessageId, { reasoning: currentReasoning.value })
        },
        signal: abortController.signal,
      })
      if (cancelledRequestIds.has(requestId)) return
      emit('apply', response.content)
      toast.success('Applied to editor')
      updateMessage(assistantMessageId, {
        content: response.summary?.trim()
          ? `Applied edit: ${response.summary.trim()}`
          : response.toolName === 'replace_chapter_section'
            ? 'Applied localized edit to the editor.'
            : 'Applied chapter replacement to the editor.',
        reasoning: currentReasoning.value,
      })
    } else if (props.mode === 'outline-agent') {
      const currentTitle = typeof props.context?.chapter?.title === 'string'
        ? props.context.chapter.title
        : 'Untitled'
      const currentOutline = props.context?.chapter?.outline as ChapterOutline | undefined
      const assistantMessageId = addMessage('assistant', '')
      streamingAssistantId.value = assistantMessageId
      const response = await genStore.editChapterOutlineWithTool(fullPrompt, {
        currentTitle,
        currentOutline,
        modelRef: selectedModelRef.value,
        onToolStatus: updateToolStatus,
        onTodoList: state => {
          if (cancelledRequestIds.has(requestId)) return
          todoItems.value = state.items
          scheduleChatSave()
        },
        onToken: () => {},
        onReasoningToken: token => {
          if (cancelledRequestIds.has(requestId)) return
          currentReasoning.value += token
          updateMessage(assistantMessageId, { reasoning: currentReasoning.value })
        },
        signal: abortController.signal,
      })
      if (cancelledRequestIds.has(requestId)) return
      emit('applyOutline', { title: response.title, outline: response.outline })
      toast.success('Applied to outline')
      updateMessage(assistantMessageId, {
        content: response.summary?.trim()
          ? `Applied outline edit: ${response.summary.trim()}`
          : response.toolName === 'replace_chapter_outline_field'
            ? 'Applied outline field update.'
            : 'Applied chapter outline rewrite.',
        reasoning: currentReasoning.value,
      })
    } else {
      const assistantMessageId = addMessage('assistant', '')
      streamingAssistantId.value = assistantMessageId
      const response = await genStore.chatWithAssistant(fullPrompt, selectedModelRef.value, {
        onToken: token => {
          if (!cancelledRequestIds.has(requestId)) appendMessageContent(assistantMessageId, token)
        },
        onReasoningToken: token => {
          if (cancelledRequestIds.has(requestId)) return
          currentReasoning.value += token
          updateMessage(assistantMessageId, { reasoning: currentReasoning.value })
        },
        onToolStatus: updateToolStatus,
        onTodoList: state => {
          if (cancelledRequestIds.has(requestId)) return
          todoItems.value = state.items
          scheduleChatSave()
        },
        onPlanningResult: result => {
          if (cancelledRequestIds.has(requestId)) return
          if (typeof result.outline === 'string') {
            emit('applyPlanningOutline', { outline: result.outline })
          }
          if (Array.isArray(result.characters)) {
            emit('applyPlanningCharacters', { characters: result.characters })
          }
        },
        signal: abortController.signal,
      })
      if (cancelledRequestIds.has(requestId)) return
      updateMessage(assistantMessageId, { content: response, reasoning: currentReasoning.value })
    }
  } catch (error: any) {
    if (cancelledRequestIds.has(requestId) || abortController.signal.aborted || error?.name === 'AbortError') return
    toast.error(error?.message || 'Connection lost')
    addMessage('system', error?.message ? `Vibe AI error: ${error.message}` : 'System error: Unable to reach Vibe Engine.')
  } finally {
    if (activeRequestId === requestId) {
      isLoading.value = false
      emit('loadingChange', false)
      streamingAssistantId.value = ''
      if (currentAbortController === abortController) currentAbortController = null
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
  toolStatuses.value = toolStatuses.value.map(item =>
    item.status === 'pending' || item.status === 'running'
      ? {
          ...item,
          status: 'error',
          description: 'Tool execution was interrupted',
          detail: 'The current Vibe AI response was interrupted by the user.',
        }
      : item
  )
  todoItems.value = todoItems.value.map(item =>
    item.status === 'in_progress'
      ? { ...item, status: 'blocked', notes: 'Interrupted by user.' }
      : item
  )
  addMessage('system', 'Vibe AI response interrupted.')
  scheduleChatSave()
}

function updateToolStatus(status: Omit<ToolCallStatusItem, 'id'>) {
  const existing = toolStatuses.value.find(item => item.name === status.name)
  if (existing) {
    Object.assign(existing, status)
    scheduleChatSave()
    return
  }

  toolStatuses.value.push({
    id: `${status.name}-${Date.now()}`,
    ...status,
  })
  scheduleChatSave()
  scrollToBottom()
}

function applyContent(content: string) {
  emit('apply', extractApplicableContent(content))
  toast.success('Applied to editor')
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
  toast.success('Copied to clipboard')
}

function clearChat() {
  showResetConfirm.value = false
  if (chatSaveTimer) {
    clearTimeout(chatSaveTimer)
    chatSaveTimer = null
  }
  pendingChatSave = null
  messages.value = [createGreetingMessage()]
  expandedMessageIds.value = new Set()
  reasoningExpanded.value = false
  toolStatuses.value = []
  todoItems.value = []
  currentReasoning.value = ''
  void persistChatNow()
}

function requestClearChat() {
  if (hasConversationContent.value) {
    showResetConfirm.value = true
    return
  }
  clearChat()
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
    key: conversationKey.value,
  }
  const runId = ++conversationLoadRun
  if (chatSaveTimer) {
    clearTimeout(chatSaveTimer)
    chatSaveTimer = null
  }

  isLoadingConversation = true
  try {
    const stored = await loadVibeConversation(targetScope.projectId, targetScope.directoryPath, targetScope.key)
    const cached = conversationMemoryCache.get(scopeCacheKey(targetScope))
    if (runId !== conversationLoadRun) return
    activeConversationScope = targetScope
    const restored = hydrateMessages(cached?.messages ?? stored?.messages)
    messages.value = restored
    expandedMessageIds.value = new Set()
    reasoningExpanded.value = false
    toolStatuses.value = hydrateToolStatuses(cached?.toolStatuses ?? stored?.toolStatuses)
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

watch([projectId, conversationKey], () => {
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

function rewindToMessageSnapshot(message: ChatMessage) {
  if (!message.workspaceSnapshot) return
  const snapshot = cloneJsonSafe(message.workspaceSnapshot)
  if (!snapshot) return
  emit('rewind', snapshot)
  toast.success('Workspace rewound')
}

const lastAssistantMessageId = computed(() => {
  for (let index = messages.value.length - 1; index >= 0; index--) {
    if (messages.value[index].role === 'assistant') return messages.value[index].id
  }
  return ''
})

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
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-surface-1 font-sans">
    <!-- Clean Header -->
    <div class="relative shrink-0 px-3 py-2 flex items-center justify-between border-b border-surface-4">
      <div class="flex items-center gap-2 min-w-0">
        <div class="flex items-center justify-center w-6 h-6 rounded-md bg-accent/10 border border-accent/20 shrink-0">
          <Sparkles :size="13" class="text-accent" />
        </div>
        <div class="min-w-0">
          <h3 class="text-xs font-semibold text-text-primary tracking-tight truncate">{{ tr('Vibe AI') }}</h3>
          <p class="text-[9px] uppercase tracking-widest text-text-muted font-bold truncate">{{ tr(stageLabels[stage] || 'Assistant') }}</p>
        </div>
      </div>
      <div class="flex items-center gap-1">
        <button
          class="p-1.5 text-text-muted hover:text-accent hover:bg-accent/5 rounded transition-all"
          :title="tr('Reset Conversation')"
          @click="requestClearChat"
        >
          <RotateCcw :size="13" />
        </button>
      </div>
      <div
        v-if="showResetConfirm"
        class="absolute right-3 top-9 z-50 w-72 rounded-lg border border-surface-4 bg-surface-1 p-3 shadow-xl"
      >
        <p class="text-xs font-semibold text-text-primary">{{ tr('Reset conversation?') }}</p>
        <p class="mt-1 text-[11px] leading-relaxed text-text-secondary">
          {{ tr('This will delete the saved chat history for the current scope.') }}
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
            {{ tr('Reset') }}
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
      class="min-h-0 flex-1 overflow-y-auto px-4 py-5 space-y-6 custom-scrollbar"
    >
      <div v-if="shouldShowQuickActions" class="grid grid-cols-1 gap-2 -mt-2">
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
        v-for="msg in messages"
        :key="msg.id"
        class="group flex flex-col gap-3"
      >
        <!-- Message Role Label -->
        <div class="flex items-center gap-2 select-none">
          <div v-if="msg.role === 'user'" class="flex items-center gap-2">
            <User :size="12" class="text-text-muted" />
            <span class="text-[10px] font-black uppercase tracking-widest text-text-muted">{{ tr('You') }}</span>
          </div>
          <div v-else-if="msg.role === 'assistant'" class="flex items-center gap-2">
            <Sparkles :size="12" class="text-accent" />
            <span class="text-[10px] font-black uppercase tracking-widest text-accent">{{ tr('Vibe Engine') }}</span>
            <span
              v-if="isLoading && msg.id === streamingAssistantId"
              class="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent"
            >
              <LoaderCircle :size="10" class="animate-spin" />
              {{ tr('Generating') }}
            </span>
          </div>
          <div v-else class="flex items-center gap-2">
            <AlertTriangle
              :size="12"
              :class="systemMessageTone(msg) === 'danger' ? 'text-danger' : systemMessageTone(msg) === 'warning' ? 'text-warning' : 'text-text-muted'"
            />
            <span
              class="text-[10px] font-black uppercase tracking-widest"
              :class="systemMessageTone(msg) === 'danger' ? 'text-danger' : systemMessageTone(msg) === 'warning' ? 'text-warning' : 'text-text-muted'"
            >{{ tr('System') }}</span>
          </div>
          <span class="text-[10px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
            {{ msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
          </span>
        </div>

        <!-- Content Body (No Bubble for Assistant, Subtle for User) -->
        <div
          :class="[
            'leading-relaxed max-w-full transition-all',
            msg.role === 'user' 
              ? 'bg-surface-2/70 p-3 rounded-lg border border-surface-4 italic text-[12px] text-text-secondary'
              : msg.role === 'system'
                ? [
                    'rounded-lg border p-3 text-[12px]',
                    systemMessageTone(msg) === 'danger'
                      ? 'border-danger/30 bg-danger-subtle/40 text-danger'
                      : systemMessageTone(msg) === 'warning'
                        ? 'border-warning/30 bg-warning/10 text-warning'
                        : 'border-surface-4 bg-surface-2/70 text-text-secondary',
                  ]
              : 'text-[15px] text-text-primary px-1'
          ]"
        >
          <div
            v-if="msg.role === 'assistant' && msg.reasoning"
            class="mb-3 rounded-lg border border-surface-4 bg-surface-2/70"
          >
            <button
              class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[11px] font-semibold text-text-secondary hover:text-text-primary"
              @click="reasoningExpanded = !reasoningExpanded"
            >
              <span class="flex items-center gap-1.5">
                <Brain :size="12" class="text-accent" />
                {{ tr('Reasoning') }}
              </span>
              <ChevronDown :size="12" class="transition-transform" :class="reasoningExpanded ? 'rotate-180' : ''" />
            </button>
            <div
              v-if="reasoningExpanded"
              class="border-t border-surface-4 px-3 py-2 text-[11px] leading-relaxed text-text-muted whitespace-pre-wrap"
            >{{ msg.reasoning }}</div>
          </div>

          <div
            class="whitespace-pre-wrap"
            :class="msg.role === 'user' && isUserMessageCollapsible(msg) && !isMessageExpanded(msg.id) ? 'max-h-[9.6em] overflow-hidden' : ''"
          >
            {{ msg.role === 'system' ? tr(msg.content) : msg.content }}
          </div>

          <TodoListStatus
            v-if="msg.id === lastAssistantMessageId && todoItems.length"
            class="mt-3"
            :items="todoItems"
            title="Vibe Todo"
            agent="Vibe AI"
          />

          <button
            v-if="isUserMessageCollapsible(msg)"
            class="mt-2 text-[11px] font-medium text-accent hover:text-accent/80"
            @click="toggleMessageExpanded(msg.id)"
          >
            {{ tr(isMessageExpanded(msg.id) ? 'Collapse' : 'Expand') }}
          </button>
          <button
            v-if="msg.role === 'user' && msg.workspaceSnapshot"
            class="ml-3 mt-2 text-[11px] font-medium text-warning hover:text-warning/80"
            :title="tr('Restore the workspace to the state before this request.')"
            @click="rewindToMessageSnapshot(msg)"
          >
            {{ tr('Rewind workspace') }}
          </button>

          <!-- Actions for Assistant Messages -->
          <div v-if="msg.role === 'assistant' && props.mode === 'assistant'" class="mt-6 flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0">
            <button 
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-accent text-white shadow-lg shadow-accent/20 hover:scale-105 active:scale-95 transition-all"
              @click="applyContent(msg.content)"
            >
              <Check :size="12" />
              {{ tr('Apply to Editor') }}
            </button>
            <button 
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-surface-3 text-text-secondary hover:bg-surface-4 transition-all"
              @click="copyToClipboard(msg.content)"
            >
              <Copy :size="12" />
              {{ tr('Copy') }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="toolStatuses.length" class="space-y-2">
        <ToolCallStatus
          v-for="tool in toolStatuses"
          :key="tool.id"
          :item="tool"
        />
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
</style>
