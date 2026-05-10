import type { ToolCallStatusItem } from '@/components/ui/ToolCallStatus.vue'
import type { AgentTodoItem } from '@/services/agent/todolist'

export interface StoredVibeChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  reasoning?: string
  workspaceSnapshot?: unknown
  timestamp: string
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

const STORAGE_PREFIX = 'story-generator.vibe-chat.'

function localStorageKey(projectId: string, key: string) {
  return `${STORAGE_PREFIX}${projectId}.${key}`
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
    workspaceSnapshot: message.workspaceSnapshot === undefined ? undefined : toJsonSafe(message.workspaceSnapshot),
    timestamp: typeof message.timestamp === 'string' ? message.timestamp : new Date().toISOString(),
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
