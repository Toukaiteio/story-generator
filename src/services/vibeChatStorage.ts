import type { ToolCallStatusItem } from '@/components/ui/ToolCallStatus.vue'
import type { AgentTodoItem } from '@/services/agent/todolist'

export interface StoredVibeChatMessageBlock {
  id: string
  type: 'reasoning' | 'tool' | 'content'
  text: string
  toolId: string
}

export interface StoredVibeChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  reasoning?: string
  toolStatuses?: ToolCallStatusItem[]
  workBlocks?: StoredVibeChatMessageBlock[]
  workspaceSnapshot?: unknown
  timestamp: string
  generationDurationMs?: number
}

export interface StoredVibeConversation {
  version: 1
  projectId: string
  key: string
  messages: StoredVibeChatMessage[]
  toolStatuses?: ToolCallStatusItem[]
  todoItems?: AgentTodoItem[]
  updatedAt: string
}

export interface VibeConversationHistoryEntry {
  id: string
  scopeKey: string
  storageKey: string
  category: string
  event: string
  topic: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

interface StoredVibeConversationHistoryIndex {
  version: 1
  projectId: string
  scopeKey: string
  entries: VibeConversationHistoryEntry[]
  updatedAt: string
}

const STORAGE_PREFIX = 'story-generator.vibe-chat.'
const HISTORY_SUFFIX = '__history__.index'
const SESSION_PREFIX = '__session__'

function localStorageKey(projectId: string, key: string) {
  return `${STORAGE_PREFIX}${projectId}.${key}`
}

function historyIndexKey(scopeKey: string) {
  return `${scopeKey}.${HISTORY_SUFFIX}`
}

function sessionStorageKey(scopeKey: string, conversationId: string) {
  return `${scopeKey}.${SESSION_PREFIX}.${conversationId}`
}

function toJsonSafe<T>(value: T): T {
  const seen = new WeakSet<object>()
  return JSON.parse(JSON.stringify(value, (_key, nestedValue) => {
    if (typeof nestedValue === 'bigint') return nestedValue.toString()
    if (typeof nestedValue === 'function' || typeof nestedValue === 'symbol') return undefined
    if (nestedValue && typeof nestedValue === 'object') {
      if (seen.has(nestedValue)) return undefined
      seen.add(nestedValue)
    }
    return nestedValue
  })) as T
}

function normalizeMessage(message: StoredVibeChatMessage): StoredVibeChatMessage {
  return {
    id: String(message.id || ''),
    role: message.role === 'user' || message.role === 'assistant' || message.role === 'system'
      ? message.role
      : 'system',
    content: String(message.content ?? ''),
    reasoning: typeof message.reasoning === 'string' ? message.reasoning : undefined,
    toolStatuses: Array.isArray(message.toolStatuses)
      ? message.toolStatuses.map(normalizeToolStatus)
      : undefined,
    workBlocks: Array.isArray(message.workBlocks)
      ? message.workBlocks
        .map(item => ({
          id: String(item?.id || ''),
          type: item?.type === 'reasoning' || item?.type === 'tool' || item?.type === 'content' ? item.type : 'reasoning',
          text: String(item?.text ?? ''),
          toolId: String(item?.toolId ?? ''),
        }))
        .filter(item => item.id)
      : undefined,
    workspaceSnapshot: message.workspaceSnapshot === undefined ? undefined : toJsonSafe(message.workspaceSnapshot),
    timestamp: typeof message.timestamp === 'string' ? message.timestamp : new Date().toISOString(),
    generationDurationMs: typeof message.generationDurationMs === 'number' ? message.generationDurationMs : undefined,
  }
}

function normalizeToolStatus(item: ToolCallStatusItem): ToolCallStatusItem {
  return {
    id: String(item.id || ''),
    name: String(item.name || ''),
    status: item.status === 'pending' || item.status === 'running' || item.status === 'success' || item.status === 'warning' || item.status === 'error'
      ? item.status
      : 'success',
    title: typeof item.title === 'string' ? item.title : undefined,
    description: typeof item.description === 'string' ? item.description : undefined,
    detail: typeof item.detail === 'string' ? item.detail : undefined,
    before: typeof item.before === 'string' ? item.before : undefined,
    after: typeof item.after === 'string' ? item.after : undefined,
  }
}

function normalizeTodoItem(item: AgentTodoItem): AgentTodoItem {
  return {
    id: String(item.id || ''),
    title: String(item.title || ''),
    status: item.status === 'todo' || item.status === 'in_progress' || item.status === 'done' || item.status === 'blocked'
      ? item.status
      : 'todo',
    notes: typeof item.notes === 'string' ? item.notes : undefined,
  }
}

function createConversationId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeHistoryEntry(raw: any, scopeKey: string): VibeConversationHistoryEntry {
  const id = String(raw?.id || createConversationId())
  const createdAt = typeof raw?.createdAt === 'string' ? raw.createdAt : new Date().toISOString()
  const updatedAt = typeof raw?.updatedAt === 'string' ? raw.updatedAt : createdAt
  return {
    id,
    scopeKey,
    storageKey: typeof raw?.storageKey === 'string' && raw.storageKey.trim()
      ? raw.storageKey.trim()
      : sessionStorageKey(scopeKey, id),
    category: String(raw?.category || ''),
    event: String(raw?.event || ''),
    topic: String(raw?.topic || '').trim(),
    createdAt,
    updatedAt,
    messageCount: Number.isFinite(Number(raw?.messageCount)) ? Math.max(0, Number(raw.messageCount)) : 0,
  }
}

function normalizeHistoryIndex(raw: any, projectId: string, scopeKey: string): StoredVibeConversationHistoryIndex {
  const entries: VibeConversationHistoryEntry[] = Array.isArray(raw?.entries)
    ? raw.entries.map((item: any) => normalizeHistoryEntry(item, scopeKey))
    : []
  return {
    version: 1,
    projectId,
    scopeKey,
    entries: entries.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  }
}

export async function loadVibeConversation(projectId: string, directoryPath: string | undefined, key: string) {
  if (!projectId || !key) return null

  if (window.electronAPI?.vibeChat?.load) {
    return window.electronAPI.vibeChat.load(projectId, directoryPath, key)
  }

  try {
    const raw = localStorage.getItem(localStorageKey(projectId, key))
    return raw ? JSON.parse(raw) as StoredVibeConversation : null
  } catch {
    return null
  }
}

export async function saveVibeConversation(
  projectId: string,
  directoryPath: string | undefined,
  key: string,
  messages: StoredVibeChatMessage[],
  state: { toolStatuses?: ToolCallStatusItem[]; todoItems?: AgentTodoItem[] } = {}
) {
  if (!projectId || !key) return false

  const payload: StoredVibeConversation = {
    version: 1,
    projectId,
    key,
    messages: messages.map(normalizeMessage),
    toolStatuses: (state.toolStatuses ?? []).map(normalizeToolStatus),
    todoItems: (state.todoItems ?? []).map(normalizeTodoItem),
    updatedAt: new Date().toISOString(),
  }
  const safePayload = toJsonSafe(payload)

  if (window.electronAPI?.vibeChat?.save) {
    try {
      return await window.electronAPI.vibeChat.save(projectId, directoryPath, key, safePayload)
    } catch (error) {
      console.error('Failed to save Vibe conversation:', error)
      return false
    }
  }

  try {
    localStorage.setItem(localStorageKey(projectId, key), JSON.stringify(safePayload))
    return true
  } catch {
    return false
  }
}

async function saveHistoryIndex(
  projectId: string,
  directoryPath: string | undefined,
  scopeKey: string,
  index: StoredVibeConversationHistoryIndex
) {
  const payload: StoredVibeConversationHistoryIndex = {
    ...index,
    projectId,
    scopeKey,
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: [...index.entries].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
  }
  await saveVibeConversation(projectId, directoryPath, historyIndexKey(scopeKey), [
    {
      id: 'history-index',
      role: 'system',
      content: JSON.stringify(payload),
      timestamp: payload.updatedAt,
    },
  ], {})
  return payload
}

async function readHistoryIndexPayload(projectId: string, directoryPath: string | undefined, scopeKey: string) {
  const stored = await loadVibeConversation(projectId, directoryPath, historyIndexKey(scopeKey))
  if (!stored?.messages?.length) return null
  const [indexMessage] = stored.messages
  if (!indexMessage || indexMessage.role !== 'system') return null
  try {
    return JSON.parse(indexMessage.content)
  } catch {
    return null
  }
}

export async function listVibeConversationHistory(projectId: string, directoryPath: string | undefined, scopeKey: string) {
  if (!projectId || !scopeKey) return []
  const payload = await readHistoryIndexPayload(projectId, directoryPath, scopeKey)
  return normalizeHistoryIndex(payload, projectId, scopeKey).entries
}

export async function createVibeConversationHistoryEntry(
  projectId: string,
  directoryPath: string | undefined,
  scopeKey: string,
  metadata: {
    category: string
    event: string
    topic?: string
  }
) {
  const entries = await listVibeConversationHistory(projectId, directoryPath, scopeKey)
  const now = new Date().toISOString()
  const entry: VibeConversationHistoryEntry = {
    id: createConversationId(),
    scopeKey,
    storageKey: '',
    category: metadata.category,
    event: metadata.event,
    topic: (metadata.topic || '').trim(),
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  }
  entry.storageKey = sessionStorageKey(scopeKey, entry.id)
  const nextEntries = [entry, ...entries]
  await saveHistoryIndex(projectId, directoryPath, scopeKey, {
    version: 1,
    projectId,
    scopeKey,
    entries: nextEntries,
    updatedAt: now,
  })
  return entry
}

export async function ensureVibeConversationHistory(
  projectId: string,
  directoryPath: string | undefined,
  scopeKey: string,
  metadata: {
    category: string
    event: string
    topic?: string
  }
) {
  const existing = await listVibeConversationHistory(projectId, directoryPath, scopeKey)
  if (existing.length) return existing

  const legacy = await loadVibeConversation(projectId, directoryPath, scopeKey)
  const created = await createVibeConversationHistoryEntry(projectId, directoryPath, scopeKey, metadata)
  if (legacy) {
    await saveVibeConversation(projectId, directoryPath, created.storageKey, legacy.messages ?? [], {
      toolStatuses: legacy.toolStatuses ?? [],
      todoItems: legacy.todoItems ?? [],
    })
    await updateVibeConversationHistoryEntry(projectId, directoryPath, scopeKey, created.id, {
      messageCount: Array.isArray(legacy.messages) ? legacy.messages.length : 0,
      updatedAt: legacy.updatedAt || new Date().toISOString(),
      topic: metadata.topic || inferTopicFromMessages(legacy.messages),
    })
  }
  return listVibeConversationHistory(projectId, directoryPath, scopeKey)
}

function inferTopicFromMessages(messages: StoredVibeChatMessage[] | undefined) {
  if (!Array.isArray(messages)) return ''
  const firstUserMessage = messages.find(item => item.role === 'user' && item.content.trim())
  if (!firstUserMessage) return ''
  return firstUserMessage.content.replace(/\s+/g, ' ').slice(0, 72)
}

export async function updateVibeConversationHistoryEntry(
  projectId: string,
  directoryPath: string | undefined,
  scopeKey: string,
  conversationId: string,
  patch: Partial<Pick<VibeConversationHistoryEntry, 'topic' | 'updatedAt' | 'messageCount' | 'category' | 'event'>>
) {
  const indexPayload = await readHistoryIndexPayload(projectId, directoryPath, scopeKey)
  const index = normalizeHistoryIndex(indexPayload, projectId, scopeKey)
  const entry = index.entries.find(item => item.id === conversationId)
  if (!entry) return null

  if (typeof patch.topic === 'string') entry.topic = patch.topic.trim()
  if (typeof patch.category === 'string') entry.category = patch.category
  if (typeof patch.event === 'string') entry.event = patch.event
  if (Number.isFinite(Number(patch.messageCount))) entry.messageCount = Math.max(0, Number(patch.messageCount))
  entry.updatedAt = typeof patch.updatedAt === 'string' ? patch.updatedAt : new Date().toISOString()

  const persisted = await saveHistoryIndex(projectId, directoryPath, scopeKey, index)
  return persisted.entries.find(item => item.id === conversationId) ?? null
}

export async function removeVibeConversationHistoryEntry(
  projectId: string,
  directoryPath: string | undefined,
  scopeKey: string,
  conversationId: string
) {
  const indexPayload = await readHistoryIndexPayload(projectId, directoryPath, scopeKey)
  const index = normalizeHistoryIndex(indexPayload, projectId, scopeKey)
  const target = index.entries.find(item => item.id === conversationId)
  if (!target) return false

  index.entries = index.entries.filter(item => item.id !== conversationId)
  await saveHistoryIndex(projectId, directoryPath, scopeKey, index)
  if (window.electronAPI?.vibeChat?.save) {
    await saveVibeConversation(projectId, directoryPath, target.storageKey, [], {})
  } else {
    try {
      localStorage.removeItem(localStorageKey(projectId, target.storageKey))
    } catch {
      // ignore
    }
  }
  return true
}
