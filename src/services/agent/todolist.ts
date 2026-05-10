import { ref } from 'vue'
import type { ToolCall, ToolDefinition, ToolResult } from '@/services/provider/tools'

export type TodoStatus = 'todo' | 'in_progress' | 'done' | 'blocked'

export interface AgentTodoItem {
  id: string
  title: string
  status: TodoStatus
  notes?: string
}

export interface AgentTodoListState {
  agent: string
  updatedAt: string
  items: AgentTodoItem[]
}

export const agentTodoListState = ref<AgentTodoListState>({
  agent: '',
  updatedAt: '',
  items: [],
})

const statuses: TodoStatus[] = ['todo', 'in_progress', 'done', 'blocked']

export function getTodoListTool(): ToolDefinition {
  return {
    name: 'update_todolist',
    description: 'Create or update a concise task checklist for complex multi-step work. Use it to make the current plan explicit and to mark progress as tasks are completed.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'The complete current checklist. Keep it short and operational. At most one item may be in_progress.',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Stable short id for this task item.',
              },
              title: {
                type: 'string',
                description: 'Concrete task description.',
              },
              status: {
                type: 'string',
                enum: statuses,
                description: 'Current task state.',
              },
              notes: {
                type: 'string',
                description: 'Optional short note, blocker, or result.',
              },
            },
            required: ['id', 'title', 'status'],
          },
        },
      },
      required: ['items'],
    },
  }
}

export function isTodoListTool(name: string) {
  return name === 'update_todolist'
}

export function clearAgentTodoList() {
  agentTodoListState.value = {
    agent: '',
    updatedAt: '',
    items: [],
  }
}

function normalizeTodoItems(rawItems: any[]): AgentTodoItem[] {
  return rawItems.map((raw, index) => {
    const id = String(raw?.id ?? `task-${index + 1}`).trim()
    const title = String(raw?.title ?? '').trim()
    const status = statuses.includes(raw?.status) ? raw.status as TodoStatus : 'todo'
    const notes = typeof raw?.notes === 'string' && raw.notes.trim()
      ? raw.notes.trim()
      : undefined
    return { id, title, status, notes }
  })
}

export async function handleTodoListToolCall(
  toolCall: ToolCall,
  context: Record<string, any>,
  agentName: string
): Promise<ToolResult> {
  const rawItems = Array.isArray(toolCall.arguments?.items) ? toolCall.arguments.items : []
  const items = normalizeTodoItems(rawItems)
  const ids = new Set<string>()

  if (!items.length) {
    return {
      tool_call_id: toolCall.id,
      content: JSON.stringify({ ok: false, error: 'items must contain at least one task.' }),
    }
  }

  if (items.length > 12) {
    return {
      tool_call_id: toolCall.id,
      content: JSON.stringify({ ok: false, error: 'Keep todolist concise: maximum 12 items.' }),
    }
  }

  for (const item of items) {
    if (!item.id || !item.title) {
      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({ ok: false, error: 'Every todolist item requires a non-empty id and title.' }),
      }
    }
    if (ids.has(item.id)) {
      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({ ok: false, error: `Duplicate todolist id: ${item.id}` }),
      }
    }
    ids.add(item.id)
  }

  const inProgress = items.filter(item => item.status === 'in_progress')
  if (inProgress.length > 1) {
    return {
      tool_call_id: toolCall.id,
      content: JSON.stringify({ ok: false, error: 'Only one todolist item may be in_progress at a time.' }),
    }
  }

  const nextState = {
    agent: agentName,
    updatedAt: new Date().toISOString(),
    items,
  }

  context._todoList = items
  agentTodoListState.value = nextState

  if (typeof context._onTodoListUpdated === 'function') {
    await context._onTodoListUpdated(nextState)
  }

  return {
    tool_call_id: toolCall.id,
    content: JSON.stringify({
      ok: true,
      message: 'Todolist updated.',
      total: items.length,
      done: items.filter(item => item.status === 'done').length,
      inProgress: inProgress[0]?.id ?? null,
    }),
  }
}
