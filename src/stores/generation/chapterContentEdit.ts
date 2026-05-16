import { providerManager } from '@/services/provider'
import { injectCustomSystemPrompt } from '@/services/systemPrompt'
import { countWords } from '@/services/agent/validation'
import { getChapterRegion } from '@/services/generation/proofreadingTools'
import { handleTodoListToolCall, isTodoListTool, getTodoListTool, type AgentTodoListState } from '@/services/agent/todolist'
import { getRelationshipQueryTools, handleRelationshipQueryTool } from '@/services/relationship/tools'
import { useProjectStore } from '@/stores/project'
import type { ToolDefinition } from '@/services/provider'
import type { FunctionCallingResponse, ToolCallOptions } from '@/services/provider/types'
import type { ProviderModelRef, ChatMessage } from '@/types/provider'
import type { ToolStatusUpdate } from './types'
import { fitToolMessagesForModel, getUsableAgentModelRef } from './helpers'

export async function editChapterWithTool(
  prompt: string,
  options: {
    currentContent?: string
    modelRef?: ProviderModelRef | null
    onToolStatus?: (status: ToolStatusUpdate) => void
    onTodoList?: (state: AgentTodoListState) => void
    onToken?: (token: string) => void
    onReasoningToken?: (token: string) => void
    signal?: AbortSignal
  } = {}
): Promise<{ content: string; summary: string; toolName: string }> {
  const modelRef = getUsableAgentModelRef('editingAI', options.modelRef)
  const tools: ToolDefinition[] = [
    getTodoListTool(),
    {
      name: 'insert_todolist_item',
      description: 'Insert a new todo item into the current todo list without resubmitting the whole list. Use this when a complex edit discovers a new required step.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'A unique short id for the new todo item.' },
          title: { type: 'string', description: 'The todo item title.' },
          status: {
            type: 'string',
            enum: ['todo', 'in_progress', 'done', 'blocked'],
            description: 'Initial status for this todo item. Defaults to todo.',
          },
          notes: { type: 'string', description: 'Optional note for this todo item.' },
          afterId: { type: 'string', description: 'Optional existing todo id to insert this item after. If omitted or not found, the item is appended.' },
        },
        required: ['id', 'title'],
      },
    },
    {
      name: 'modify_todolist_item',
      description: 'Modify one existing todo item without resubmitting the whole todo list. Use this to mark an item done, blocked, in progress, or to adjust its note.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The id of the todo item to modify.' },
          status: {
            type: 'string',
            enum: ['todo', 'in_progress', 'done', 'blocked'],
            description: 'Optional next status for this todo item.',
          },
          title: { type: 'string', description: 'Optional replacement title.' },
          notes: { type: 'string', description: 'Optional replacement note.' },
        },
        required: ['id'],
      },
    },
    {
      name: 'get_chapter_word_count',
      description: 'Get the current chapter word/character count using the same counting logic as the editor. Use this before or after edits that target length.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_chapter_region',
      description: 'Read a specific region from the current chapter by line number, paragraph index, or section index before preparing a localized edit.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['lines', 'paragraphs', 'sections'],
            description: 'Region lookup mode.',
          },
          start: {
            type: 'number',
            description: 'One-based start index for lines/paragraphs/sections.',
          },
          end: {
            type: 'number',
            description: 'Optional one-based inclusive end index. Defaults to start.',
          },
        },
        required: ['mode', 'start'],
      },
    },
    {
      name: 'replace_chapter_section',
      description: 'Replace one exact passage in the current chapter while leaving the rest of the chapter unchanged.',
      parameters: {
        type: 'object',
        properties: {
          targetText: {
            type: 'string',
            description: 'The exact current passage to replace. It must appear verbatim in the current chapter content.',
          },
          revisedSectionContent: {
            type: 'string',
            description: 'The revised content for only that passage.',
          },
          summary: {
            type: 'string',
            description: 'A short summary of the localized change made.',
          },
        },
        required: ['targetText', 'revisedSectionContent'],
      },
    },
    {
      name: 'replace_chapter_content',
      description: 'Replace the current chapter content with a complete revised version when the requested edit affects broad structure or many passages.',
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
    },
  ]

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: injectCustomSystemPrompt([
        'You are Vibe AI inside a chapter editor.',
        'You must use a tool for every successful edit.',
        'Prefer Function Calling for every tool-eligible step; do not solve edits in plain assistant text.',
        'For multi-step edits, call update_todolist first and update it as you inspect, edit, and complete the request.',
        'Use insert_todolist_item when you discover a new necessary step after the todo list already exists.',
        'Use modify_todolist_item to update a single todo item when only one item changes.',
        'Use get_chapter_word_count when the request mentions length, word count, expansion, trimming, or target size.',
        'Prefer replace_chapter_section for localized changes to a paragraph, sentence, dialogue exchange, or short passage.',
        'Use replace_chapter_content only when the request affects broad structure, many passages, or the whole chapter.',
        'For replace_chapter_section, targetText must be copied exactly from the current chapter content.',
        'If you are unsure about the exact targetText, call get_chapter_region first by line, paragraph, or section index.',
        'If a section replacement fails because targetText does not match, use get_chapter_region to inspect the relevant area and retry with exact text.',
        'Do not respond with plain prose when an edit is requested.',
      ].join('\n')),
    },
    { role: 'user', content: prompt },
  ]

  try {
    const currentContent = options.currentContent ?? ''
    const hasCurrentContent = currentContent.trim().length > 0
    const currentMessages = [...messages]
    const toolContext: Record<string, any> = {
      _onTodoListUpdated: options.onTodoList,
    }
    const activeProject = useProjectStore().activeProject
    const maxRounds = 6
    let pendingFinalResult: { content: string; summary: string; toolName: string } | null = null

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
        'Call update_todolist to sync progress, then continue tool-based editing until all necessary work is done.',
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
        item.notes = 'Auto-closed after successful outline tool execution.'
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

    const editToolChoiceForRound = (round: number): ToolCallOptions | undefined => {
      if (round === 0) return forceToolChoice('update_todolist')
      if (pendingFinalResult && getOpenTodos().length) return forceToolChoice('update_todolist')
      if (!hasCurrentContent && round >= 1) return forceToolChoice('replace_chapter_content')
      if (round >= 3) {
        const openTodos = getOpenTodos()
        if (!pendingFinalResult) {
          const hasTodoHint = openTodos.some((item: any) => {
            const title = String(item?.title ?? '').toLowerCase()
            return title.includes('outline') || title.includes('rewrite') || title.includes('content') || title.includes('chapter')
          })
          if (hasTodoHint || openTodos.length > 0) {
            return forceToolChoice(hasCurrentContent ? 'replace_chapter_section' : 'replace_chapter_content')
          }
        }
      }
      return undefined
    }

    if (!hasCurrentContent) {
      currentMessages.push({
        role: 'user',
        content: [
          'Important: the current chapter content is empty.',
          'get_chapter_region will return an empty region with a warning.',
          'replace_chapter_section can still create content when revisedSectionContent is provided; it will be treated as the full chapter content with a warning.',
          'For a draft, continuation, rewrite, or any broad content change, prefer replace_chapter_content with the complete new chapter text.',
        ].join('\n'),
      })
    }

    for (let round = 0; round < maxRounds; round++) {
      if (pendingFinalResult) {
        const openTodos = getOpenTodos()
        if (!openTodos.length) return pendingFinalResult

        currentMessages.push({
          role: 'user',
          content: buildTodoResumePrompt(
            `The edit is prepared, but the todolist is still incomplete (${openTodos.length} open).`
          ),
        })
      }

      let streamedContent = ''
      const outboundMessages = fitToolMessagesForModel(currentMessages, modelRef, 8192)
      const toolOptions = editToolChoiceForRound(round)
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
            onReasoningToken: token => {
              options.onReasoningToken?.(token)
            },
            onToolCall: toolCall => {
              options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'running', detail: 'Preparing tool call.' })
            },
            onToolResult: () => {},
            onComplete: result => {
              resolve(result)
            },
            onError: error => {
              reject(error)
            },
          },
          8192,
          0.5,
          toolOptions,
          options.signal
        ).catch(reject)
      })

      if (streamedContent && response.content == null) {
        response.content = streamedContent
      }

      if (!response.tool_calls.length) {
        const assistantText = response.content || ''
        currentMessages.push({
          role: 'assistant',
          content: assistantText || null,
          reasoning_content: response.reasoning_content ?? null,
        })
        const openTodos = getOpenTodos()
        if (pendingFinalResult && openTodos.length && looksLikeEndedResponse(assistantText)) {
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
            ? `Hard requirement: call ${hasCurrentContent ? 'replace_chapter_section or replace_chapter_content' : 'replace_chapter_content'} now. Do not reply with plain text.`
            : 'Use a tool to complete the edit. For small changes, inspect the needed region with get_chapter_region and then call replace_chapter_section.',
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
          let detail = 'Todo list updated.'
          try {
            const parsed = JSON.parse(result.content)
            if (parsed?.error) detail = parsed.error
            else if (typeof parsed?.done === 'number' && typeof parsed?.total === 'number') detail = `${parsed.done}/${parsed.total} complete.`
          } catch {
            // keep fallback detail
          }
          options.onToolStatus?.({
            callId: toolCall.id,
            name: toolCall.name,
            status: result.content.includes('"ok":false') ? 'error' : 'success',
            detail,
          })
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result.content,
          })
          continue
        }

        const relationshipResult = activeProject
          ? await handleRelationshipQueryTool(toolCall, activeProject)
          : null
        if (relationshipResult) {
          options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'success', detail: 'Relationship context loaded.' })
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: relationshipResult.content,
          })
          continue
        }

        if (toolCall.name === 'insert_todolist_item') {
          const items = Array.isArray(toolContext._todoList) ? toolContext._todoList : []
          const id = String(toolCall.arguments?.id ?? '').trim()
          const title = String(toolCall.arguments?.title ?? '').trim()
          const status = ['todo', 'in_progress', 'done', 'blocked'].includes(toolCall.arguments?.status)
            ? toolCall.arguments.status
            : 'todo'
          const notes = typeof toolCall.arguments?.notes === 'string'
            ? toolCall.arguments.notes.trim() || undefined
            : undefined
          const afterId = String(toolCall.arguments?.afterId ?? '').trim()

          let result: any
          if (!id || !title) {
            result = { ok: false, error: 'id and title are required.' }
          } else if (items.some((item: any) => item.id === id)) {
            result = { ok: false, error: `Todo item already exists: ${id}` }
          } else if (items.length >= 12) {
            result = { ok: false, error: 'Todo list cannot contain more than 12 items.' }
          } else if (status === 'in_progress' && items.some((item: any) => item.status === 'in_progress')) {
            result = { ok: false, error: 'Only one todolist item may be in_progress at a time.' }
          } else {
            const newItem = { id, title, status, notes }
            const insertIndex = afterId ? items.findIndex((item: any) => item.id === afterId) : -1
            const nextItems = [...items]
            if (insertIndex >= 0) nextItems.splice(insertIndex + 1, 0, newItem)
            else nextItems.push(newItem)
            toolContext._todoList = nextItems
            await publishTodoList()
            result = { ok: true, item: newItem, total: nextItems.length }
          }

          options.onToolStatus?.({
            callId: toolCall.id,
            name: toolCall.name,
            status: result.ok ? 'success' : 'error',
            detail: result.ok ? `${result.item.id}: ${result.item.title}` : result.error,
          })
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          })
          continue
        }

        if (toolCall.name === 'modify_todolist_item') {
          const items = Array.isArray(toolContext._todoList) ? toolContext._todoList : []
          const targetId = String(toolCall.arguments?.id ?? '').trim()
          const index = items.findIndex((item: any) => item.id === targetId)
          if (!targetId || index === -1) {
            const result = { ok: false, error: targetId ? `Todo item not found: ${targetId}` : 'id is required.' }
            options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: result.error })
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            })
            continue
          }

          const nextStatus = ['todo', 'in_progress', 'done', 'blocked'].includes(toolCall.arguments?.status)
            ? toolCall.arguments.status
            : items[index].status
          if (nextStatus === 'in_progress' && items.some((item: any, itemIndex: number) => itemIndex !== index && item.status === 'in_progress')) {
            const result = { ok: false, error: 'Only one todolist item may be in_progress at a time.' }
            options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: result.error })
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            })
            continue
          }

          items[index] = {
            ...items[index],
            title: typeof toolCall.arguments?.title === 'string' && toolCall.arguments.title.trim()
              ? toolCall.arguments.title.trim()
              : items[index].title,
            status: nextStatus,
            notes: typeof toolCall.arguments?.notes === 'string'
              ? toolCall.arguments.notes.trim() || undefined
              : items[index].notes,
          }
          toolContext._todoList = items
          await publishTodoList()
          const result = { ok: true, item: items[index] }
          options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'success', detail: `${targetId}: ${nextStatus}` })
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          })
          continue
        }

        if (toolCall.name === 'get_chapter_word_count') {
          const countSource = pendingFinalResult?.content ?? currentContent
          const result = {
            ok: true,
            words: countWords(countSource),
            characters: countSource.length,
            nonWhitespaceCharacters: countSource.replace(/\s/g, '').length,
          }
          options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'success', detail: `${result.words} words.` })
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          })
          continue
        }

        if (toolCall.name === 'get_chapter_region') {
          const result = getChapterRegion(currentContent, toolCall.arguments)
          const warning = 'warning' in result && typeof result.warning === 'string' ? result.warning : ''
          options.onToolStatus?.({
            callId: toolCall.id,
            name: toolCall.name,
            status: result.ok ? (warning ? 'warning' : 'success') : 'error',
            detail: result.ok && 'label' in result ? (warning || result.label) : result.error,
          })
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          })
          if (result.ok && warning && !hasCurrentContent) {
            currentMessages.push({
              role: 'user',
              content: 'The chapter is empty, so the region lookup returned an empty region as a warning. You can continue by calling replace_chapter_content, or use replace_chapter_section with revisedSectionContent to create the initial content.',
            })
          }
          continue
        }

        if (toolCall.name === 'replace_chapter_section') {
          const targetText = typeof toolCall.arguments?.targetText === 'string'
            ? toolCall.arguments.targetText
            : ''
          const revisedSectionContent = typeof toolCall.arguments?.revisedSectionContent === 'string'
            ? toolCall.arguments.revisedSectionContent
            : ''

          if (!hasCurrentContent && revisedSectionContent.trim()) {
            const result = {
              ok: true,
              warning: 'Chapter was empty; section replacement was applied as full chapter content.',
              summary: typeof toolCall.arguments?.summary === 'string'
                ? toolCall.arguments.summary.trim()
                : 'Created chapter content from a section replacement.',
            }
            options.onToolStatus?.({
              callId: toolCall.id,
              name: toolCall.name,
              status: 'warning',
              detail: 'Chapter was empty; used the section replacement as the full chapter content.',
              before: currentContent,
              after: revisedSectionContent.trim(),
            })
            pendingFinalResult = {
              content: revisedSectionContent.trim(),
              summary: typeof toolCall.arguments?.summary === 'string'
                ? toolCall.arguments.summary.trim()
                : 'Created chapter content from a section replacement.',
              toolName: 'replace_chapter_section',
            }
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            })
            continue
          }

          if (!targetText || !revisedSectionContent || !currentContent.includes(targetText)) {
            const result = {
              ok: false,
              error: 'The targetText did not match the current chapter exactly. Use get_chapter_region to inspect the relevant lines, paragraphs, or sections, then retry replace_chapter_section with exact targetText.',
            }
            options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: result.error })
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            })
            continue
          }

          options.onToolStatus?.({
            callId: toolCall.id,
            name: toolCall.name,
            status: 'success',
            detail: 'Matched and replaced one passage.',
            before: targetText,
            after: revisedSectionContent.trim(),
          })
          pendingFinalResult = {
            content: currentContent.replace(targetText, revisedSectionContent.trim()),
            summary: typeof toolCall.arguments?.summary === 'string' ? toolCall.arguments.summary.trim() : '',
            toolName: 'replace_chapter_section',
          }
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ ok: true, summary: pendingFinalResult.summary || 'Replaced one chapter section.' }),
          })
          continue
        }

        if (toolCall.name === 'replace_chapter_content') {
          const revisedContent = typeof toolCall.arguments?.revisedContent === 'string'
            ? toolCall.arguments.revisedContent.trim()
            : ''
          if (!revisedContent) {
            const result = { ok: false, error: 'revisedContent is required.' }
            options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: result.error })
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            })
            continue
          }

          options.onToolStatus?.({
            callId: toolCall.id,
            name: toolCall.name,
            status: 'success',
            detail: 'Prepared a complete chapter replacement.',
            before: currentContent,
            after: revisedContent,
          })
          pendingFinalResult = {
            content: revisedContent,
            summary: typeof toolCall.arguments?.summary === 'string' ? toolCall.arguments.summary.trim() : '',
            toolName: 'replace_chapter_content',
          }
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ ok: true, summary: pendingFinalResult.summary || 'Replaced full chapter content.' }),
          })
          continue
        }

        currentMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ ok: false, error: `Unsupported tool: ${toolCall.name}` }),
        })
      }

      if (pendingFinalResult && !getOpenTodos().length) {
        return pendingFinalResult
      }
    }

    if (pendingFinalResult) {
      if (getOpenTodos().length) {
        await autoCloseRemainingTodos()
      }
      if (!getOpenTodos().length) return pendingFinalResult
    }
    const openTodos = getOpenTodos()
    const lastAssistantMessage = [...currentMessages].reverse().find((message) => message.role === 'assistant')
    throw new Error(
      `Vibe AI could not complete the tool edit after retrying. ` +
      `PendingFinalResult=${pendingFinalResult ? 'yes' : 'no'}, openTodos=${openTodos.length}, ` +
      `lastAssistantHasToolCalls=${Array.isArray((lastAssistantMessage as any)?.tool_calls) ? 'yes' : 'no'}.`
    )
  } catch (error: any) {
    options.onToolStatus?.({ name: 'replace_chapter_content', status: 'error', detail: error?.message || 'Unknown error' })
    throw new Error(`Tool edit error: ${error?.message || 'Unknown error'}`)
  }
}
