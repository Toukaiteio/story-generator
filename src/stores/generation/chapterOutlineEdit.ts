import { providerManager } from '@/services/provider'
import { injectCustomSystemPrompt } from '@/services/systemPrompt'
import { handleTodoListToolCall, isTodoListTool, getTodoListTool, type AgentTodoListState } from '@/services/agent/todolist'
import { getRelationshipQueryTools, handleRelationshipQueryTool } from '@/services/relationship/tools'
import { useProjectStore } from '@/stores/project'
import type { ToolDefinition } from '@/services/provider'
import type { FunctionCallingResponse, ToolCallOptions } from '@/services/provider/types'
import type { ChapterOutline } from '@/types/chapter'
import type { ProviderModelRef, ChatMessage } from '@/types/provider'
import type { ToolStatusUpdate } from './types'
import { fitToolMessagesForModel, getUsableAgentModelRef } from './helpers'

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

  const normalizeList = (value: unknown, fallback: string[] = []) => {
    if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
    if (typeof value === 'string') {
      return value
        .split(/\r?\n|,/)
        .map(item => item.replace(/^\s*[-*]\s+/, '').trim())
        .filter(Boolean)
    }
    return fallback
  }

  const buildTitleFromContext = () => {
    const candidates = [
      currentState.title,
      options.currentTitle,
      currentState.outline.objective,
      currentState.outline.conflict,
    ]
    for (const raw of candidates) {
      const text = String(raw || '').trim()
      if (!text) continue
      const firstLine = text.split(/\r?\n/)[0]?.trim() || ''
      if (!firstLine) continue
      const cleaned = firstLine.replace(/^title\s*[:：]\s*/i, '').trim()
      if (cleaned) return cleaned.slice(0, 80)
    }
    return 'Untitled Chapter'
  }

  const ensureNonEmptyTitle = () => {
    const current = String(currentState.title || '').trim()
    if (current) return current
    const fallback = buildTitleFromContext()
    currentState.title = fallback
    return fallback
  }

  const getMissingOutlineFields = () => {
    const missing: string[] = []
    if (!String(currentState.title || '').trim()) missing.push('title')
    if (!String(currentState.outline.objective || '').trim()) missing.push('objective')
    if (!String(currentState.outline.conflict || '').trim()) missing.push('conflict')
    if (!Array.isArray(currentState.outline.keyEvents) || !currentState.outline.keyEvents.some(item => String(item).trim())) missing.push('keyEvents')
    if (!Array.isArray(currentState.outline.characterActions) || !currentState.outline.characterActions.some(item => String(item).trim())) missing.push('characterActions')
    if (!Array.isArray(currentState.outline.infoReveals) || !currentState.outline.infoReveals.some(item => String(item).trim())) missing.push('infoReveals')
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
          field: {
            type: 'string',
            enum: ['all', 'title', 'objective', 'conflict', 'keyEvents', 'characterActions', 'infoReveals', 'endingHook'],
            description: 'The outline field to read. Defaults to all.',
          },
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
          field: {
            type: 'string',
            enum: ['title', 'objective', 'conflict', 'keyEvents', 'characterActions', 'infoReveals', 'endingHook'],
          },
          value: {
            type: 'string',
            description: 'Replacement text for scalar fields, or newline-separated list items for list fields.',
          },
          items: {
            type: 'array',
            description: 'Replacement list items for keyEvents, characterActions, or infoReveals.',
            items: { type: 'string' },
          },
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
        'Prefer replace_chapter_outline_field when the user asks to adjust one field or one list.',
        'Use rewrite_chapter_outline when multiple fields need coordinated changes.',
        'Never edit chapter prose. These tools only modify title and outline fields.',
        'Do not reply with the revised outline in plain text. Complete the edit by calling an outline replacement tool.',
      ].join('\n')),
    },
    { role: 'user', content: prompt },
  ]

  try {
    const currentMessages = [...messages]
    const toolContext: Record<string, any> = {
      _onTodoListUpdated: options.onTodoList,
    }
    const activeProject = useProjectStore().activeProject
    const getOpenTodos = () => {
      const items = Array.isArray(toolContext._todoList) ? toolContext._todoList : []
      return items.filter((item: any) => item?.status !== 'done' && item?.status !== 'blocked')
    }
    const getDoneTodos = () => {
      const items = Array.isArray(toolContext._todoList) ? toolContext._todoList : []
      return items.filter((item: any) => item?.status === 'done')
    }
    const looksLikeEndedResponse = (text: string) => {
      const normalized = (text || '').toLowerCase()
      return /(\bdone\b|\bcompleted\b|\bfinished\b|\bfinal\b|已完成|完成|结束|总结)/i.test(normalized)
    }
    const buildTodoResumePrompt = (reason: string) => {
      const doneItems = getDoneTodos()
      const openItems = getOpenTodos()
      const nextItem = openItems.find((item: any) => item?.status === 'in_progress') || openItems[0]
      const doneText = doneItems.length
        ? doneItems.map((item: any) => `- [done] ${item.id}: ${item.title}`).join('\n')
        : '- (none)'
      const openText = openItems.length
        ? openItems.map((item: any) => `- [${item.status || 'todo'}] ${item.id}: ${item.title}`).join('\n')
        : '- (none)'
      const nextText = nextItem ? `${nextItem.id}: ${nextItem.title}` : '(no pending item)'
      return [
        reason,
        'Continue execution now. Do not stop yet.',
        'Call update_todolist to sync progress, then continue outline tool calls until all required fields are complete.',
        '',
        'Completed todo items:',
        doneText,
        '',
        'Open todo items:',
        openText,
        '',
        `Current next item: ${nextText}`,
      ].join('\n')
    }
    const publishTodoList = async () => {
      if (typeof options.onTodoList !== 'function') return
      await options.onTodoList({
        agent: 'Vibe AI',
        updatedAt: new Date().toISOString(),
        items: Array.isArray(toolContext._todoList) ? toolContext._todoList : [],
      })
    }
    const autoCloseRemainingTodos = async () => {
      const items = Array.isArray(toolContext._todoList) ? [...toolContext._todoList] : []
      if (!items.length) return false
      let changed = false
      for (const item of items) {
        if (item?.status === 'done' || item?.status === 'blocked') continue
        item.status = 'done'
        item.notes = 'Auto-closed after successful outline edit tool execution.'
        changed = true
      }
      if (!changed) return false
      toolContext._todoList = items
      await publishTodoList()
      options.onToolStatus?.({
        name: 'update_todolist',
        status: 'warning',
        detail: 'Todo list was auto-closed after successful outline edit to avoid retry deadlock.',
      })
      return true
    }
    const forceToolChoice = (name: string): ToolCallOptions => ({
      toolChoice: { type: 'function', function: { name } },
    })
    let hasOutlineChange = false
    const outlineToolChoiceForRound = (round: number): ToolCallOptions | undefined => {
      if (round === 0) return forceToolChoice('update_todolist')
      if (pendingFinalResult && getOpenTodos().length) return forceToolChoice('update_todolist')
      if (!hasOutlineChange && round >= 2) return forceToolChoice('rewrite_chapter_outline')
      return undefined
    }

    let pendingFinalResult: { title: string; outline: ChapterOutline; summary: string; toolName: string } | null = null
    for (let round = 0; round < 6; round++) {
      if (pendingFinalResult) {
        ensureNonEmptyTitle()
        const missingFields = getMissingOutlineFields()
        if (!missingFields.length) {
          const openTodos = getOpenTodos()
          if (!openTodos.length) {
            return pendingFinalResult
          }
          currentMessages.push({
            role: 'user',
            content: buildTodoResumePrompt(
              `Outline fields are complete but todo remains open (${openTodos.length}).`
            ),
          })
          continue
        }
        options.onToolStatus?.({
          name: pendingFinalResult.toolName,
          status: 'warning',
          detail: `Outline is still incomplete: ${missingFields.join(', ')}. Requesting auto-repair.`,
        })
        currentMessages.push({
          role: 'user',
          content: `The outline is still incomplete. Missing required fields: ${missingFields.join(', ')}. Call outline tools again now to fill every missing field. Do not finish until all required fields are non-empty.`,
        })
        pendingFinalResult = null
        continue
      }

      let streamedContent = ''
      const outboundMessages = fitToolMessagesForModel(currentMessages, modelRef, 4096)
      const toolOptions = outlineToolChoiceForRound(round)
      const response = await new Promise<FunctionCallingResponse>((resolve, reject) => {
        providerManager.streamWithTools(
          outboundMessages,
          modelRef,
          tools,
          {
            onToken: token => {
              streamedContent += token
              options.onToken?.(token)
            },
            onReasoningToken: token => options.onReasoningToken?.(token),
            onToolCall: toolCall => options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'running', detail: 'Preparing tool call.' }),
            onToolResult: () => {},
            onComplete: resolve,
            onError: reject,
          },
          4096,
          0.35,
          toolOptions,
          options.signal
        ).catch(reject)
      })

      if (streamedContent && response.content == null) response.content = streamedContent

      if (!response.tool_calls.length) {
        const assistantText = response.content || ''
        currentMessages.push({ role: 'assistant', content: assistantText || null, reasoning_content: response.reasoning_content ?? null })
        if (pendingFinalResult && getOpenTodos().length && looksLikeEndedResponse(assistantText)) {
          currentMessages.push({
            role: 'user',
            content: buildTodoResumePrompt(
              'You appear to have ended early while pending work still exists in todolist.'
            ),
          })
          continue
        }
        currentMessages.push({
          role: 'user',
          content: round >= 3
            ? 'Call rewrite_chapter_outline now with all required fields (title, objective, conflict, keyEvents, characterActions, infoReveals, endingHook). Do not return plain text.'
            : 'Use an outline tool to complete the request. Do not return outline text directly.',
        })
        continue
      }

      currentMessages.push({
        role: 'assistant',
        content: response.content || null,
        reasoning_content: response.reasoning_content ?? null,
        tool_calls: response.tool_calls.map(toolCall => ({
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
          },
        })),
      })

      for (const toolCall of response.tool_calls) {
        options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'running', detail: 'Running tool.' })

        if (isTodoListTool(toolCall.name)) {
          const result = await handleTodoListToolCall(toolCall, toolContext, 'Vibe AI')
          await publishTodoList()
          options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: result.content.includes('"ok":false') ? 'error' : 'success', detail: 'Todo list updated.' })
          currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: result.content })
          continue
        }

        const relationshipResult = activeProject
          ? await handleRelationshipQueryTool(toolCall, activeProject)
          : null
        if (relationshipResult) {
          options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'success', detail: 'Relationship context loaded.' })
          currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: relationshipResult.content })
          continue
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
          const result = value || field === 'all'
            ? { ok: true, field, content: value }
            : { ok: false, error: `Unknown outline field: ${field}` }
          options.onToolStatus?.({
            callId: toolCall.id,
            name: toolCall.name,
            status: result.ok ? 'success' : 'error',
            detail: result.ok ? `Read ${field}.` : result.error,
          })
          currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) })
          continue
        }

        if (toolCall.name === 'replace_chapter_outline_field') {
          const field = String(toolCall.arguments?.field || '')
          if (!scalarFields.has(field) && !listFields.has(field)) {
            const result = { ok: false, error: `Unknown outline field: ${field}` }
            options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: result.error })
            currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) })
            continue
          }

          const before = field === 'title'
            ? currentState.title
            : listFields.has(field)
              ? (currentState.outline as any)[field].join('\n')
              : (currentState.outline as any)[field]

          if (field === 'title') {
            currentState.title = String(toolCall.arguments?.value ?? '').trim() || currentState.title
          } else if (listFields.has(field)) {
            ;(currentState.outline as any)[field] = normalizeList(toolCall.arguments?.items ?? toolCall.arguments?.value, (currentState.outline as any)[field])
          } else {
            ;(currentState.outline as any)[field] = String(toolCall.arguments?.value ?? '').trim()
          }
          ensureNonEmptyTitle()

          const after = field === 'title'
            ? currentState.title
            : listFields.has(field)
              ? (currentState.outline as any)[field].join('\n')
              : (currentState.outline as any)[field]
          const result = { ok: true, field, title: currentState.title, outline: currentState.outline }
          options.onToolStatus?.({
            callId: toolCall.id,
            name: toolCall.name,
            status: 'success',
            detail: `Updated ${field}.`,
            before,
            after,
          })
          pendingFinalResult = cloneResult(typeof toolCall.arguments?.summary === 'string' ? toolCall.arguments.summary.trim() : `Updated ${field}.`, toolCall.name)
          hasOutlineChange = true
          currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) })
          ensureNonEmptyTitle()
          continue
        }

        if (toolCall.name === 'rewrite_chapter_outline') {
          const requiredArgs: Array<keyof ChapterOutline> = ['objective', 'conflict', 'keyEvents', 'characterActions', 'infoReveals', 'endingHook']
          const missingArgs = requiredArgs.filter((key) => {
            const value = (toolCall.arguments as any)?.[key]
            if (key === 'keyEvents' || key === 'characterActions' || key === 'infoReveals') {
              return !normalizeList(value).length
            }
            return !String(value ?? '').trim()
          })
          if (missingArgs.length) {
            const result = { ok: false, error: `Missing required arguments for rewrite_chapter_outline: ${missingArgs.join(', ')}` }
            options.onToolStatus?.({
              callId: toolCall.id,
              name: toolCall.name,
              status: 'error',
              detail: result.error,
            })
            currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) })
            currentMessages.push({
              role: 'user',
              content: `rewrite_chapter_outline failed because required arguments were missing: ${missingArgs.join(', ')}. Retry rewrite_chapter_outline with all required fields filled.`,
            })
            continue
          }

          const before = outlineToText()
          currentState.title = String(toolCall.arguments?.title ?? currentState.title).trim() || currentState.title
          currentState.outline = {
            objective: String(toolCall.arguments?.objective ?? '').trim(),
            conflict: String(toolCall.arguments?.conflict ?? '').trim(),
            keyEvents: normalizeList(toolCall.arguments?.keyEvents),
            characterActions: normalizeList(toolCall.arguments?.characterActions),
            infoReveals: normalizeList(toolCall.arguments?.infoReveals),
            endingHook: String(toolCall.arguments?.endingHook ?? '').trim(),
          }
          ensureNonEmptyTitle()
          const after = outlineToText()
          const result = { ok: true, title: currentState.title, outline: currentState.outline }
          options.onToolStatus?.({
            callId: toolCall.id,
            name: toolCall.name,
            status: 'success',
            detail: 'Prepared complete outline revision.',
            before,
            after,
          })
          pendingFinalResult = cloneResult(typeof toolCall.arguments?.summary === 'string' ? toolCall.arguments.summary.trim() : 'Rewrote chapter outline.', toolCall.name)
          hasOutlineChange = true
          currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) })
          ensureNonEmptyTitle()
          continue
        }

        currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ ok: false, error: `Unsupported tool: ${toolCall.name}` }) })
      }

      if (pendingFinalResult) {
        ensureNonEmptyTitle()
        const missingFields = getMissingOutlineFields()
        if (!missingFields.length) {
          if (getOpenTodos().length) {
            await autoCloseRemainingTodos()
          }
          if (!getOpenTodos().length) {
            return pendingFinalResult
          }
        }
      }
    }

    if (pendingFinalResult) {
      ensureNonEmptyTitle()
      const missingFields = getMissingOutlineFields()
      if (!missingFields.length) {
        if (getOpenTodos().length) {
          await autoCloseRemainingTodos()
        }
        return pendingFinalResult
      }
      throw new Error(`Vibe AI could not complete the outline edit after retrying. Missing required fields: ${missingFields.join(', ')}`)
    }
    throw new Error('Vibe AI could not complete the outline edit after retrying.')
  } catch (error: any) {
    options.onToolStatus?.({ name: 'rewrite_chapter_outline', status: 'error', detail: error?.message || 'Unknown error' })
    throw new Error(`Outline edit error: ${error?.message || 'Unknown error'}`)
  }
}
