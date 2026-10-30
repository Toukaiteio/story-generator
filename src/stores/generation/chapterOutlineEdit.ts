import { injectCustomSystemPrompt } from '@/services/systemPrompt'
import { handleTodoListToolCall, isTodoListTool, getTodoListTool, type AgentTodoListState } from '@/services/agent/todolist'
import { getRelationshipQueryTools, handleRelationshipQueryTool } from '@/services/relationship/tools'
import { useProjectStore } from '@/stores/project'
import type { ToolDefinition } from '@/services/provider'
import type { ToolCall, ToolResult } from '@/services/provider/tools'
import type { ChapterOutline } from '@/types/chapter'
import type { ProviderModelRef, ChatMessage } from '@/types/provider'
import type { ToolStatusUpdate } from './types'
import { getUsableAgentModelRef } from './helpers'
import { runPiAgent } from '@/services/agent/piRuntime'

function readTextArgument(args: Record<string, any> | undefined, names: string[]): { value: string; key: string | null } {
  if (!args || typeof args !== 'object') return { value: '', key: null }
  for (const name of names) {
    if (typeof args[name] !== 'string') continue
    const value = args[name].trim()
    if (value) return { value, key: name }
  }
  return { value: '', key: null }
}

function readListArgument(args: Record<string, any> | undefined, names: string[], fallback: string[] = []): { value: string[]; key: string | null } {
  if (!args || typeof args !== 'object') return { value: fallback, key: null }
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(args, name)) continue
    const normalized = normalizeOutlineList(args[name], [])
    if (normalized.length) return { value: normalized, key: name }
  }
  return { value: fallback, key: null }
}

function normalizeOutlineList(value: unknown, fallback: string[] = []) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') {
    return value.split(/\r?\n|[,，;；]/).map(item => item.replace(/^\s*[-*]\s+/, '').trim()).filter(Boolean)
  }
  return fallback
}

function normalizeOutlineField(value: unknown): string {
  const raw = String(value || '').trim()
  const normalized = raw.toLowerCase().replace(/[\s_-]+/g, '')
  const aliases: Record<string, string> = {
    chaptertitle: 'title',
    goal: 'objective',
    chapterobjective: 'objective',
    centralconflict: 'conflict',
    plotbeats: 'keyEvents',
    beats: 'keyEvents',
    events: 'keyEvents',
    keyevents: 'keyEvents',
    actions: 'characterActions',
    characteractions: 'characterActions',
    reveals: 'infoReveals',
    informationreveals: 'infoReveals',
    inforeveals: 'infoReveals',
    hook: 'endingHook',
    ending: 'endingHook',
    endinghook: 'endingHook',
  }
  return aliases[normalized] ?? raw
}

export async function editChapterOutlineWithTool(
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
  const modelRef = getUsableAgentModelRef('editingAI', options.modelRef)
  const listFields = new Set(['keyEvents', 'characterActions', 'infoReveals'])
  const scalarFields = new Set(['title', 'objective', 'conflict', 'endingHook'])
  const currentState = {
    title: options.currentTitle || 'Untitled',
    outline: {
      objective: options.currentOutline?.objective || '',
      conflict: options.currentOutline?.conflict || '',
      keyEvents: Array.isArray(options.currentOutline?.keyEvents) ? [...options.currentOutline.keyEvents] : [],
      characterActions: Array.isArray(options.currentOutline?.characterActions) ? [...options.currentOutline.characterActions] : [],
      infoReveals: Array.isArray(options.currentOutline?.infoReveals) ? [...options.currentOutline.infoReveals] : [],
      endingHook: options.currentOutline?.endingHook || '',
    },
  }
  const outlineToText = (state = currentState) => [
    `Title: ${state.title}`,
    `Objective: ${state.outline.objective}`,
    `Conflict: ${state.outline.conflict}`,
    `Key Events:\n${state.outline.keyEvents.map(item => `- ${item}`).join('\n')}`,
    `Character Actions:\n${state.outline.characterActions.map(item => `- ${item}`).join('\n')}`,
    `Info Reveals:\n${state.outline.infoReveals.map(item => `- ${item}`).join('\n')}`,
    `Ending Hook: ${state.outline.endingHook}`,
  ].join('\n')
  const cloneResult = (summary: string, toolName: string) => ({
    title: currentState.title,
    outline: JSON.parse(JSON.stringify(currentState.outline)) as ChapterOutline,
    summary,
    toolName,
  })
  const buildTitleFromContext = () => {
    for (const raw of [currentState.title, options.currentTitle, currentState.outline.objective, currentState.outline.conflict]) {
      const firstLine = String(raw || '').split(/\r?\n/)[0]?.trim() || ''
      const cleaned = firstLine.replace(/^title\s*[:：]\s*/i, '').trim()
      if (cleaned) return cleaned.slice(0, 80)
    }
    return 'Untitled Chapter'
  }
  const ensureNonEmptyTitle = () => {
    if (String(currentState.title || '').trim()) return currentState.title
    currentState.title = buildTitleFromContext()
    return currentState.title
  }
  const getMissingOutlineFields = () => {
    const missing: string[] = []
    if (!String(currentState.title || '').trim()) missing.push('title')
    if (!String(currentState.outline.objective || '').trim()) missing.push('objective')
    if (!String(currentState.outline.conflict || '').trim()) missing.push('conflict')
    if (!currentState.outline.keyEvents.some(item => String(item).trim())) missing.push('keyEvents')
    if (!currentState.outline.characterActions.some(item => String(item).trim())) missing.push('characterActions')
    if (!currentState.outline.infoReveals.some(item => String(item).trim())) missing.push('infoReveals')
    if (!String(currentState.outline.endingHook || '').trim()) missing.push('endingHook')
    return missing
  }
  const tools: ToolDefinition[] = [
    getTodoListTool(),
    ...getRelationshipQueryTools(),
    {
      name: 'get_chapter_outline',
      description: 'Read the current chapter outline or one specific outline field before editing it.',
      parameters: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: ['all', 'title', 'objective', 'conflict', 'keyEvents', 'characterActions', 'infoReveals', 'endingHook'], description: 'The outline field to read. Defaults to all.' },
        },
        required: [],
      },
    },
    {
      name: 'replace_chapter_outline_field',
      description: 'Replace one exact chapter outline field. Use this for localized outline edits.',
      parameters: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: ['title', 'objective', 'conflict', 'keyEvents', 'characterActions', 'infoReveals', 'endingHook'] },
          value: { type: 'string', description: 'Replacement text for scalar fields, or newline-separated list items for list fields.' },
          items: { type: 'array', description: 'Replacement list items for list fields.', items: { type: 'string' } },
          summary: { type: 'string' },
        },
        required: ['field'],
      },
    },
    {
      name: 'rewrite_chapter_outline',
      description: 'Replace the complete chapter outline when the request affects multiple planning fields.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          objective: { type: 'string' },
          conflict: { type: 'string' },
          keyEvents: { type: 'array', items: { type: 'string' } },
          characterActions: { type: 'array', items: { type: 'string' } },
          infoReveals: { type: 'array', items: { type: 'string' } },
          endingHook: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['objective', 'conflict', 'keyEvents', 'characterActions', 'infoReveals', 'endingHook'],
      },
    },
  ]
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: injectCustomSystemPrompt([
        'You are Vibe AI inside a chapter outline editor.',
        'You must use tools for every successful outline edit.',
        'Prefer Function Calling for every tool-eligible step; do not solve outline edits in plain assistant text.',
        'A complete chapter plan must always include: title, objective, conflict, keyEvents, characterActions, infoReveals, and endingHook.',
        'Use get_chapter_outline before editing if the exact field content matters.',
        'Prefer replace_chapter_outline_field for localized edits and rewrite_chapter_outline for coordinated changes.',
        'Never edit chapter prose. Do not reply with the revised outline in plain text.',
      ].join('\n')),
    },
    { role: 'user', content: prompt },
  ]

  try {
    const toolContext: Record<string, any> = { _onTodoListUpdated: options.onTodoList }
    const activeProject = useProjectStore().activeProject
    const getOpenTodos = () => (Array.isArray(toolContext._todoList) ? toolContext._todoList : [])
      .filter((item: any) => item?.status !== 'done' && item?.status !== 'blocked')
    const getDoneTodos = () => (Array.isArray(toolContext._todoList) ? toolContext._todoList : [])
      .filter((item: any) => item?.status === 'done')
    const publishTodoList = async () => {
      await options.onTodoList?.({ agent: 'Vibe AI', updatedAt: new Date().toISOString(), items: Array.isArray(toolContext._todoList) ? toolContext._todoList : [] })
    }
    const buildTodoResumePrompt = (reason: string) => {
      const done = getDoneTodos().map((item: any) => `- [done] ${item.id}: ${item.title}`).join('\n') || '- (none)'
      const open = getOpenTodos().map((item: any) => `- [${item.status || 'todo'}] ${item.id}: ${item.title}`).join('\n') || '- (none)'
      const next = getOpenTodos()[0]
      return [reason, 'Continue execution now. Do not stop yet.', 'Call update_todolist to sync progress, then continue outline tool calls until all required fields are complete.', '', 'Completed todo items:', done, '', 'Open todo items:', open, '', `Current next item: ${next ? `${next.id}: ${next.title}` : '(no pending item)'}`].join('\n')
    }
    const autoCloseRemainingTodos = async () => {
      const items = Array.isArray(toolContext._todoList) ? [...toolContext._todoList] : []
      let changed = false
      for (const item of items) {
        if (item?.status === 'done' || item?.status === 'blocked') continue
        item.status = 'done'
        item.notes = 'Auto-closed after successful outline edit tool execution.'
        changed = true
      }
      if (!changed) return
      toolContext._todoList = items
      await publishTodoList()
      options.onToolStatus?.({ name: 'update_todolist', status: 'warning', detail: 'Todo list was auto-closed after successful outline edit.' })
    }
    let pendingFinalResult: { title: string; outline: ChapterOutline; summary: string; toolName: string } | null = null
    let hasOutlineChange = false
    let round = 0

    const executeTool = async (toolCall: ToolCall): Promise<ToolResult> => {
      if (isTodoListTool(toolCall.name)) {
        const result = await handleTodoListToolCall(toolCall, toolContext, 'Vibe AI')
        await publishTodoList()
        options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: result.content.includes('"ok":false') ? 'error' : 'success', detail: 'Todo list updated.' })
        return result
      }
      const relationshipResult = activeProject ? await handleRelationshipQueryTool(toolCall, activeProject) : null
      if (relationshipResult) {
        options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'success', detail: 'Relationship context loaded.' })
        return { tool_call_id: toolCall.id, content: relationshipResult.content }
      }

      if (toolCall.name === 'get_chapter_outline') {
        const field = String(toolCall.arguments?.field || 'all')
        const value = field === 'all'
          ? outlineToText()
          : field === 'title'
            ? currentState.title
            : listFields.has(field)
              ? (currentState.outline as any)[field].join('\n')
              : scalarFields.has(field)
                ? (currentState.outline as any)[field]
                : ''
        const result = value || field === 'all' ? { ok: true, field, content: value } : { ok: false, error: `Unknown outline field: ${field}` }
        options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: result.ok ? 'success' : 'error', detail: result.ok ? `Read ${field}.` : result.error })
        return { tool_call_id: toolCall.id, content: JSON.stringify(result) }
      }

      if (toolCall.name === 'replace_chapter_outline_field') {
        const field = normalizeOutlineField(toolCall.arguments?.field)
        if (!scalarFields.has(field) && !listFields.has(field)) {
          const result = { ok: false, error: `Unknown outline field: ${field}` }
          options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: result.error })
          return { tool_call_id: toolCall.id, content: JSON.stringify(result) }
        }
        const before = field === 'title' ? currentState.title : listFields.has(field) ? (currentState.outline as any)[field].join('\n') : (currentState.outline as any)[field]
        if (field === 'title') {
          const value = readTextArgument(toolCall.arguments, ['value', 'title', 'chapterTitle']).value
          if (!value) return { tool_call_id: toolCall.id, content: JSON.stringify({ ok: false, error: 'value is required when replacing the title field.' }) }
          currentState.title = value
        } else if (listFields.has(field)) {
          const aliases: Record<string, string[]> = {
            keyEvents: ['items', 'value', 'keyEvents', 'plotBeats', 'beats', 'events'],
            characterActions: ['items', 'value', 'characterActions', 'actions'],
            infoReveals: ['items', 'value', 'infoReveals', 'reveals', 'informationReveals'],
          }
          const value = readListArgument(toolCall.arguments, aliases[field] ?? ['items', 'value']).value
          if (!value.length) return { tool_call_id: toolCall.id, content: JSON.stringify({ ok: false, error: `items or value is required when replacing ${field}.` }) }
          ;(currentState.outline as any)[field] = value
        } else {
          const aliases: Record<string, string[]> = {
            objective: ['value', 'objective', 'goal', 'chapterObjective'],
            conflict: ['value', 'conflict', 'centralConflict'],
            endingHook: ['value', 'endingHook', 'hook', 'ending'],
          }
          const value = readTextArgument(toolCall.arguments, aliases[field] ?? ['value']).value
          if (!value) return { tool_call_id: toolCall.id, content: JSON.stringify({ ok: false, error: `value is required when replacing ${field}.` }) }
          ;(currentState.outline as any)[field] = value
        }
        ensureNonEmptyTitle()
        const after = field === 'title' ? currentState.title : listFields.has(field) ? (currentState.outline as any)[field].join('\n') : (currentState.outline as any)[field]
        const result = { ok: true, field, title: currentState.title, outline: currentState.outline }
        options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'success', detail: `Updated ${field}.`, before, after })
        pendingFinalResult = cloneResult(typeof toolCall.arguments?.summary === 'string' ? toolCall.arguments.summary.trim() : `Updated ${field}.`, toolCall.name)
        hasOutlineChange = true
        if (!getMissingOutlineFields().length) await autoCloseRemainingTodos()
        return { tool_call_id: toolCall.id, content: JSON.stringify(result) }
      }

      if (toolCall.name === 'rewrite_chapter_outline') {
        const objective = readTextArgument(toolCall.arguments, ['objective', 'goal', 'chapterObjective']).value
        const conflict = readTextArgument(toolCall.arguments, ['conflict', 'centralConflict']).value
        const keyEvents = readListArgument(toolCall.arguments, ['keyEvents', 'plotBeats', 'beats', 'events']).value
        const characterActions = readListArgument(toolCall.arguments, ['characterActions', 'actions']).value
        const infoReveals = readListArgument(toolCall.arguments, ['infoReveals', 'reveals', 'informationReveals']).value
        const endingHook = readTextArgument(toolCall.arguments, ['endingHook', 'hook', 'ending']).value
        const missing = [objective ? '' : 'objective', conflict ? '' : 'conflict', keyEvents.length ? '' : 'keyEvents', characterActions.length ? '' : 'characterActions', infoReveals.length ? '' : 'infoReveals', endingHook ? '' : 'endingHook'].filter(Boolean)
        if (missing.length) {
          const result = { ok: false, error: `Missing required arguments for rewrite_chapter_outline: ${missing.join(', ')}` }
          options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: result.error })
          return { tool_call_id: toolCall.id, content: JSON.stringify(result) }
        }
        const before = outlineToText()
        currentState.title = readTextArgument(toolCall.arguments, ['title', 'chapterTitle']).value || currentState.title
        currentState.outline = { objective, conflict, keyEvents, characterActions, infoReveals, endingHook }
        ensureNonEmptyTitle()
        const result = { ok: true, title: currentState.title, outline: currentState.outline }
        options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'success', detail: 'Prepared complete outline revision.', before, after: outlineToText() })
        pendingFinalResult = cloneResult(typeof toolCall.arguments?.summary === 'string' ? toolCall.arguments.summary.trim() : 'Rewrote chapter outline.', toolCall.name)
        hasOutlineChange = true
        await autoCloseRemainingTodos()
        return { tool_call_id: toolCall.id, content: JSON.stringify(result) }
      }

      const result = { ok: false, error: `Unsupported tool: ${toolCall.name}` }
      options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: result.error })
      return { tool_call_id: toolCall.id, content: JSON.stringify(result) }
    }

    await runPiAgent({
      modelRef,
      messages,
      tools,
      maxTokens: 4096,
      temperature: 0.35,
      contextTokens: undefined,
      signal: options.signal,
      executeTool,
      onToken: token => options.onToken?.(token),
      onReasoningToken: token => options.onReasoningToken?.(token),
      onToolStatus: status => {
        if (status.status === 'running') {
          options.onToolStatus?.({ callId: status.callId, name: status.name, status: 'running', detail: 'Preparing tool call.' })
          return
        }
        // Argument validation happens before executeTool, so failures never
        // produce a tool-level status. Surface them instead of leaving the
        // call stuck at "running".
        if (status.status === 'error') {
          options.onToolStatus?.({
            callId: status.callId,
            name: status.name,
            status: 'error',
            detail: status.detail || status.result?.content || 'Tool call failed.',
          })
        }
      },
      // Do not force tool_choice here. Some OpenAI-compatible relays honor the
      // forced function name but drop the arguments, producing an unusable
      // call. The turn prompts below still require a tool and let the model
      // choose the one it can populate correctly.
      forceToolName: () => null,
      streamAssistantText: false,
      maxRounds: 6,
      workflowName: 'Chapter outline edit',
      stopAfterToolCallRound: async () => {
        ensureNonEmptyTitle()
        if (!pendingFinalResult || getMissingOutlineFields().length) return false
        if (getOpenTodos().length) await autoCloseRemainingTodos()
        return getMissingOutlineFields().length === 0 && getOpenTodos().length === 0
      },
      onTurnEnd: async turn => {
        round = turn.round
        if (!turn.toolCalls.length) {
          return {
            followUp: pendingFinalResult && getOpenTodos().length
              ? buildTodoResumePrompt('The outline edit is prepared, but the todo list is still open.')
              : round >= 3
                ? 'Call rewrite_chapter_outline now with all required fields. Do not return plain text.'
                : 'Use an outline tool to complete the request. Do not return outline text directly.',
          }
        }
        if (pendingFinalResult && getMissingOutlineFields().length === 0 && getOpenTodos().length === 0) return undefined
        return { steer: pendingFinalResult ? buildTodoResumePrompt('Continue until the outline and todo list are complete.') : 'Continue with the outline tools until all required fields are complete.' }
      },
    })

    ensureNonEmptyTitle()
    const missingFields = getMissingOutlineFields()
    if (!pendingFinalResult || missingFields.length) {
      throw new Error(`Vibe AI could not complete the outline edit. Missing required fields: ${missingFields.join(', ') || 'outline replacement'}`)
    }
    return pendingFinalResult
  } catch (error: any) {
    options.onToolStatus?.({ name: 'rewrite_chapter_outline', status: 'error', detail: error?.message || 'Unknown error' })
    throw new Error(`Outline edit error: ${error?.message || 'Unknown error'}`)
  }
}
