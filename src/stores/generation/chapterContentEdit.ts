import { providerManager, type ToolDefinition } from '@/services/provider'
import { injectCustomSystemPrompt } from '@/services/systemPrompt'
import { countWords } from '@/services/agent/validation'
import { getChapterRegion } from '@/services/generation/proofreadingTools'
import { handleTodoListToolCall, isTodoListTool, getTodoListTool, type AgentTodoListState } from '@/services/agent/todolist'
import { getRelationshipQueryTools, handleRelationshipQueryTool } from '@/services/relationship/tools'
import { useProjectStore } from '@/stores/project'
import type { ToolCall, ToolResult } from '@/services/provider/tools'
import type { ProviderModelRef, ChatMessage } from '@/types/provider'
import type { ToolStatusUpdate } from './types'
import { getUsableAgentModelRef } from './helpers'
import { runPiAgent } from '@/services/agent/piRuntime'

function readStringArgument(args: Record<string, any> | undefined, names: string[]): { value: string; key: string | null } {
  if (!args || typeof args !== 'object') return { value: '', key: null }
  for (const name of names) {
    if (typeof args[name] !== 'string') continue
    const value = args[name] as string
    if (value.trim()) return { value, key: name }
  }
  return { value: '', key: null }
}

function receivedArgumentKeys(args: Record<string, any> | undefined): string[] {
  return args && typeof args === 'object' ? Object.keys(args) : []
}

type TextMatchRange = {
  startOffset: number
  endOffset: number
  normalizedLineEndings: boolean
}

function normalizedOffsetMap(content: string): number[] {
  const offsets = [0]
  let normalizedOffset = 0
  let originalOffset = 0
  while (originalOffset < content.length) {
    if (content[originalOffset] === '\r' && content[originalOffset + 1] === '\n') {
      originalOffset += 2
    } else {
      originalOffset += 1
    }
    normalizedOffset += 1
    offsets[normalizedOffset] = originalOffset
  }
  return offsets
}

function findTextMatchRanges(content: string, target: string): TextMatchRange[] {
  if (!target) return []

  const exactMatches: TextMatchRange[] = []
  let exactStart = 0
  while (true) {
    const matchStart = content.indexOf(target, exactStart)
    if (matchStart < 0) break
    exactMatches.push({
      startOffset: matchStart,
      endOffset: matchStart + target.length,
      normalizedLineEndings: false,
    })
    exactStart = matchStart + Math.max(target.length, 1)
  }
  if (exactMatches.length) return exactMatches

  const normalizedContent = content.replace(/\r\n?/g, '\n')
  const normalizedTarget = target.replace(/\r\n?/g, '\n')
  const offsetMap = normalizedOffsetMap(content)
  const normalizedMatches: TextMatchRange[] = []
  let normalizedStart = 0
  while (true) {
    const matchStart = normalizedContent.indexOf(normalizedTarget, normalizedStart)
    if (matchStart < 0) break
    normalizedMatches.push({
      startOffset: offsetMap[matchStart] ?? matchStart,
      endOffset: offsetMap[matchStart + normalizedTarget.length] ?? content.length,
      normalizedLineEndings: true,
    })
    normalizedStart = matchStart + Math.max(normalizedTarget.length, 1)
  }
  return normalizedMatches
}

function validateCompleteChapterReplacement(
  currentContent: string,
  revisedContent: string,
  allowShorterContent: boolean
) {
  const trimmed = revisedContent.trim()
  if (!trimmed) {
    return {
      code: 'EMPTY_REPLACEMENT',
      error: 'The replacement chapter content cannot be empty.',
      expected: 'Provide the complete replacement chapter text in revisedContent.',
    }
  }

  if (/^(?:\.{3,}|…+|待续|to be continued|\[[^\]]+\]|（[^）]*(?:省略|待续)[^）]*）)$/i.test(trimmed)) {
    return {
      code: 'PLACEHOLDER_REPLACEMENT',
      error: 'The replacement looks like a placeholder or continuation marker, not a complete chapter.',
      expected: 'Provide the complete replacement chapter text, without placeholders or summaries.',
    }
  }

  if (/^```[\s\S]*```$/.test(trimmed)) {
    return {
      code: 'MARKDOWN_WRAPPED_REPLACEMENT',
      error: 'The replacement is wrapped in a markdown code fence instead of raw chapter text.',
      expected: 'Send only the complete chapter content without markdown fences or explanatory text.',
    }
  }

  const currentWords = countWords(currentContent)
  const revisedWords = countWords(revisedContent)
  if (!allowShorterContent && currentWords >= 120 && revisedWords < Math.max(30, Math.floor(currentWords * 0.15))) {
    return {
      code: 'SUSPICIOUSLY_SHORT_REPLACEMENT',
      error: `The replacement is suspiciously short (${revisedWords} words versus ${currentWords} in the current chapter).`,
      expected: 'Provide the complete chapter text. Set allowShorterContent to true only when an intentionally shorter chapter is requested.',
      currentWords,
      revisedWords,
      allowShorterContent: true,
    }
  }

  return null
}

function estimateReplacementTokens(content: string): number {
  const nonWhitespace = content.replace(/\s/g, '')
  if (!nonWhitespace) return 0
  const cjkCharacters = (nonWhitespace.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []).length
  const otherCharacters = nonWhitespace.length - cjkCharacters
  return Math.ceil(cjkCharacters * 1.2 + otherCharacters / 4)
}

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
      description: 'Insert a new todo item into the current todo list without resubmitting the whole list.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          status: { type: 'string', enum: ['todo', 'in_progress', 'done', 'blocked'] },
          notes: { type: 'string' },
          afterId: { type: 'string' },
        },
        required: ['id', 'title'],
      },
    },
    {
      name: 'modify_todolist_item',
      description: 'Modify one existing todo item without resubmitting the whole todo list.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['todo', 'in_progress', 'done', 'blocked'] },
          title: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['id'],
      },
    },
    {
      name: 'get_chapter_word_count',
      description: 'Get the current chapter word/character count using the same counting logic as the editor.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'get_chapter_region',
      description: 'Read an exact, copyable region from the current chapter by line number, paragraph index, or section index. The result includes startOffset and endOffset for unambiguous replacement.',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['lines', 'paragraphs', 'sections'] },
          start: { type: 'number' },
          end: { type: 'number' },
        },
        required: ['mode', 'start'],
      },
    },
    {
      name: 'replace_chapter_section',
      description: 'Replace one exact passage in the current chapter while leaving the rest unchanged.',
      parameters: {
        type: 'object',
        properties: {
          targetText: { type: 'string', description: 'Exact current passage to replace.' },
          revisedSectionContent: { type: 'string', description: 'Revised content for only that passage.' },
          startOffset: { type: 'integer', description: 'Optional zero-based start offset returned by get_chapter_region.' },
          endOffset: { type: 'integer', description: 'Optional exclusive end offset returned by get_chapter_region.' },
          summary: { type: 'string' },
        },
        required: ['targetText', 'revisedSectionContent'],
      },
    },
    {
      name: 'replace_chapter_content',
      description: 'Replace the current chapter content with a complete revised version.',
      parameters: {
        type: 'object',
        properties: {
          revisedContent: { type: 'string', description: 'Complete updated chapter content. Do not send a summary, placeholder, or partial excerpt.' },
          allowShorterContent: { type: 'boolean', description: 'Set true only when intentionally replacing the chapter with a substantially shorter complete chapter.' },
          summary: { type: 'string' },
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
        'For genuinely multi-step edits, use update_todolist with a non-empty items array and update it as you inspect, edit, and complete the request. Do not call it with an empty object or empty items array.',
        'Use insert_todolist_item when a complex edit discovers a new required step and modify_todolist_item for one-item updates.',
        'Use get_chapter_word_count for length-related requests.',
        'Prefer replace_chapter_section for localized changes and replace_chapter_content for broad structure or whole-chapter changes.',
        'For replace_chapter_section, copy targetText exactly from the content returned by get_chapter_region. Preserve its whitespace and line endings; use the returned startOffset and endOffset when available.',
        'For replace_chapter_content, revisedContent must contain the complete raw chapter text, not a summary, explanation, placeholder, markdown fence, or partial excerpt. Set allowShorterContent to true only for an intentional complete shortening. For a localized change, prefer replace_chapter_section so the full chapter does not have to fit into one tool call.',
        'If unsure about targetText, call get_chapter_region first. Do not respond with plain prose when an edit is requested.',
      ].join('\n')),
    },
    { role: 'user', content: prompt },
  ]

  let lastToolName = 'chapter_edit_workflow'
  let lastToolCallId = ''
  try {
    const currentContent = options.currentContent ?? ''
    const hasCurrentContent = currentContent.trim().length > 0
    const toolContext: Record<string, any> = { _onTodoListUpdated: options.onTodoList }
    const activeProject = useProjectStore().activeProject
    const getOpenTodos = () => (Array.isArray(toolContext._todoList) ? toolContext._todoList : [])
      .filter((item: any) => item?.status !== 'done' && item?.status !== 'blocked')
    const getDoneTodos = () => (Array.isArray(toolContext._todoList) ? toolContext._todoList : [])
      .filter((item: any) => item?.status === 'done')
    const buildTodoResumePrompt = (reason: string) => {
      const hasTodoList = Array.isArray(toolContext._todoList) && toolContext._todoList.length > 0
      const done = getDoneTodos().map((item: any) => `- [done] ${item.id}: ${item.title}`).join('\n') || '- (none)'
      const open = getOpenTodos().map((item: any) => `- [${item.status || 'todo'}] ${item.id}: ${item.title}`).join('\n') || '- (none)'
      const todoInstruction = hasTodoList
        ? 'Call update_todolist to sync progress, then continue tool-based editing until all necessary work is done.'
        : 'Use update_todolist only if this request needs a checklist. If you call it, include at least one concrete task; otherwise continue directly with the editing tools.'
      return [reason, 'Continue execution now. Do not stop yet.', todoInstruction, '', 'Completed todo items:', done, '', 'Open todo items:', open].join('\n')
    }
    const publishTodoList = async () => {
      await options.onTodoList?.({ agent: 'Vibe AI', updatedAt: new Date().toISOString(), items: Array.isArray(toolContext._todoList) ? toolContext._todoList : [] })
    }
    const autoCloseRemainingTodos = async () => {
      const items = Array.isArray(toolContext._todoList) ? [...toolContext._todoList] : []
      let changed = false
      for (const item of items) {
        if (item?.status === 'done' || item?.status === 'blocked') continue
        item.status = 'done'
        item.notes = 'Auto-closed after successful chapter content edit.'
        changed = true
      }
      if (!changed) return
      toolContext._todoList = items
      await publishTodoList()
      options.onToolStatus?.({ name: 'update_todolist', status: 'warning', detail: 'Todo list was auto-closed after successful chapter edit.' })
    }
    let pendingFinalResult: { content: string; summary: string; toolName: string } | null = null
    let round = 0
    let todoSyncRequested = false

    const executeTool = async (toolCall: ToolCall): Promise<ToolResult> => {
      lastToolName = toolCall.name
      lastToolCallId = toolCall.id
      if (isTodoListTool(toolCall.name)) {
        const result = await handleTodoListToolCall(toolCall, toolContext, 'Vibe AI')
        let detail = 'Todo list updated.'
        try {
          const parsed = JSON.parse(result.content)
          if (parsed?.error) detail = parsed.error
          else if (typeof parsed?.done === 'number' && typeof parsed?.total === 'number') detail = `${parsed.done}/${parsed.total} complete.`
        } catch {
          // Keep generic detail.
        }
        options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: result.content.includes('"ok":false') ? 'error' : 'success', detail })
        await publishTodoList()
        return result
      }
      const relationshipResult = activeProject ? await handleRelationshipQueryTool(toolCall, activeProject) : null
      if (relationshipResult) {
        options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'success', detail: 'Relationship context loaded.' })
        return { tool_call_id: toolCall.id, content: relationshipResult.content }
      }

      if (toolCall.name === 'insert_todolist_item') {
        const items = Array.isArray(toolContext._todoList) ? toolContext._todoList : []
        const id = String(toolCall.arguments?.id ?? '').trim()
        const title = String(toolCall.arguments?.title ?? '').trim()
        const status = ['todo', 'in_progress', 'done', 'blocked'].includes(toolCall.arguments?.status) ? toolCall.arguments.status : 'todo'
        const notes = typeof toolCall.arguments?.notes === 'string' ? toolCall.arguments.notes.trim() || undefined : undefined
        const afterId = String(toolCall.arguments?.afterId ?? '').trim()
        let result: any
        if (!id || !title) result = { ok: false, error: 'id and title are required.' }
        else if (items.some((item: any) => item.id === id)) result = { ok: false, error: `Todo item already exists: ${id}` }
        else if (items.length >= 12) result = { ok: false, error: 'Todo list cannot contain more than 12 items.' }
        else if (status === 'in_progress' && items.some((item: any) => item.status === 'in_progress')) result = { ok: false, error: 'Only one todolist item may be in_progress at a time.' }
        else {
          const newItem = { id, title, status, notes }
          const insertIndex = afterId ? items.findIndex((item: any) => item.id === afterId) : -1
          const nextItems = [...items]
          if (insertIndex >= 0) nextItems.splice(insertIndex + 1, 0, newItem)
          else nextItems.push(newItem)
          toolContext._todoList = nextItems
          await publishTodoList()
          result = { ok: true, item: newItem, total: nextItems.length }
        }
        options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: result.ok ? 'success' : 'error', detail: result.ok ? `${result.item.id}: ${result.item.title}` : result.error })
        return { tool_call_id: toolCall.id, content: JSON.stringify(result) }
      }

      if (toolCall.name === 'modify_todolist_item') {
        const items = Array.isArray(toolContext._todoList) ? toolContext._todoList : []
        const targetId = String(toolCall.arguments?.id ?? '').trim()
        const index = items.findIndex((item: any) => item.id === targetId)
        if (!targetId || index === -1) {
          const result = { ok: false, error: targetId ? `Todo item not found: ${targetId}` : 'id is required.' }
          options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: result.error })
          return { tool_call_id: toolCall.id, content: JSON.stringify(result) }
        }
        const nextStatus = ['todo', 'in_progress', 'done', 'blocked'].includes(toolCall.arguments?.status) ? toolCall.arguments.status : items[index].status
        if (nextStatus === 'in_progress' && items.some((item: any, itemIndex: number) => itemIndex !== index && item.status === 'in_progress')) {
          const result = { ok: false, error: 'Only one todolist item may be in_progress at a time.' }
          options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: result.error })
          return { tool_call_id: toolCall.id, content: JSON.stringify(result) }
        }
        items[index] = {
          ...items[index],
          title: typeof toolCall.arguments?.title === 'string' && toolCall.arguments.title.trim() ? toolCall.arguments.title.trim() : items[index].title,
          status: nextStatus,
          notes: typeof toolCall.arguments?.notes === 'string' ? toolCall.arguments.notes.trim() || undefined : items[index].notes,
        }
        toolContext._todoList = items
        await publishTodoList()
        const result = { ok: true, item: items[index] }
        options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'success', detail: `${targetId}: ${nextStatus}` })
        return { tool_call_id: toolCall.id, content: JSON.stringify(result) }
      }

      if (toolCall.name === 'get_chapter_word_count') {
        const source = pendingFinalResult?.content ?? currentContent
        const result = { ok: true, words: countWords(source), characters: source.length, nonWhitespaceCharacters: source.replace(/\s/g, '').length }
        options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'success', detail: `${result.words} words.` })
        return { tool_call_id: toolCall.id, content: JSON.stringify(result) }
      }

      if (toolCall.name === 'get_chapter_region') {
        const result = getChapterRegion(currentContent, toolCall.arguments)
        const warning = 'warning' in result && typeof result.warning === 'string' ? result.warning : ''
        options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: result.ok ? (warning ? 'warning' : 'success') : 'error', detail: result.ok && 'label' in result ? (warning || result.label) : result.error })
        return { tool_call_id: toolCall.id, content: JSON.stringify(result) }
      }

      if (toolCall.name === 'replace_chapter_section') {
        if (pendingFinalResult) {
          const result = { ok: false, code: 'REPLACEMENT_ALREADY_PREPARED', error: 'A successful chapter replacement is already prepared for this run. Do not overwrite it with another replacement call.', expected: 'Update the todolist if needed, then finish the tool workflow.' }
          options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: result.error })
          return { tool_call_id: toolCall.id, content: JSON.stringify(result) }
        }
        const targetText = readStringArgument(toolCall.arguments, ['targetText', 'target_text', 'originalText', 'original_text', 'sourceText', 'source_text', 'currentText', 'current_text', 'target']).value
        const revised = readStringArgument(toolCall.arguments, ['revisedSectionContent', 'revised_section_content', 'replacementText', 'replacement_text', 'revisedText', 'revised_text', 'replacement', 'content']).value
        if (!hasCurrentContent && revised) {
          pendingFinalResult = { content: revised, summary: String(toolCall.arguments?.summary ?? '').trim() || 'Created chapter content from a section replacement.', toolName: toolCall.name }
          options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'warning', detail: 'Chapter was empty; used the section replacement as the full chapter content.', before: currentContent, after: revised })
          return { tool_call_id: toolCall.id, content: JSON.stringify({ ok: true, warning: 'Chapter was empty; section replacement was applied as full chapter content.' }) }
        }
        const rawStartOffset = Number(toolCall.arguments?.startOffset ?? toolCall.arguments?.start_offset)
        const rawEndOffset = Number(toolCall.arguments?.endOffset ?? toolCall.arguments?.end_offset)
        const hasValidOffsets = Number.isInteger(rawStartOffset)
          && Number.isInteger(rawEndOffset)
          && rawStartOffset >= 0
          && rawEndOffset > rawStartOffset
          && rawEndOffset <= currentContent.length
        let matches = findTextMatchRanges(currentContent, targetText)
        if (hasValidOffsets) {
          const offsetTarget = currentContent.slice(rawStartOffset, rawEndOffset)
          const targetMatchesOffset = !targetText
            || offsetTarget === targetText
            || offsetTarget.replace(/\r\n?/g, '\n') === targetText.replace(/\r\n?/g, '\n')
          matches = targetMatchesOffset
            ? [{ startOffset: rawStartOffset, endOffset: rawEndOffset, normalizedLineEndings: false }]
            : []
        }
        if ((!targetText && !hasValidOffsets) || !revised || !matches.length) {
          const result = {
            ok: false,
            code: 'SECTION_TARGET_NOT_FOUND',
            error: 'The targetText did not match the current chapter. Use get_chapter_region and retry with its exact content or offsets.',
            expected: 'Call replace_chapter_section with targetText, revisedSectionContent, and optionally startOffset/endOffset from get_chapter_region.',
            receivedKeys: receivedArgumentKeys(toolCall.arguments),
          }
          options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: result.error })
          return { tool_call_id: toolCall.id, content: JSON.stringify(result) }
        }
        if (matches.length > 1) {
          const result = {
            ok: false,
            code: 'SECTION_TARGET_AMBIGUOUS',
            error: `The targetText appears ${matches.length} times in the current chapter. Retry with startOffset and endOffset from get_chapter_region.`,
            expected: 'Use the exact region offsets to identify one passage.',
            matches: matches.length,
            receivedKeys: receivedArgumentKeys(toolCall.arguments),
          }
          options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: result.error })
          return { tool_call_id: toolCall.id, content: JSON.stringify(result) }
        }
        const match = matches[0]
        const matchedText = currentContent.slice(match.startOffset, match.endOffset)
        const nextContent = `${currentContent.slice(0, match.startOffset)}${revised}${currentContent.slice(match.endOffset)}`
        pendingFinalResult = { content: nextContent, summary: String(toolCall.arguments?.summary ?? '').trim(), toolName: toolCall.name }
        options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'success', detail: match.normalizedLineEndings ? 'Matched and replaced one passage after normalizing line endings.' : 'Matched and replaced one passage.', before: matchedText, after: revised })
        return { tool_call_id: toolCall.id, content: JSON.stringify({ ok: true, summary: pendingFinalResult.summary || 'Replaced one chapter section.' }) }
      }

      if (toolCall.name === 'replace_chapter_content') {
        if (pendingFinalResult) {
          const result = { ok: false, code: 'REPLACEMENT_ALREADY_PREPARED', error: 'A successful chapter replacement is already prepared for this run. Do not overwrite it with another replacement call.', expected: 'Update the todolist if needed, then finish the tool workflow.' }
          options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: result.error })
          return { tool_call_id: toolCall.id, content: JSON.stringify(result) }
        }
        const revisedArg = readStringArgument(toolCall.arguments, ['revisedContent', 'revised_content', 'chapterContent', 'chapter_content', 'revisedChapterContent', 'revised_chapter_content', 'fullContent', 'full_content', 'content', 'text'])
        if (!revisedArg.value) {
          const result = { ok: false, code: 'MISSING_REVISED_CONTENT', error: 'revisedContent is required.', expected: 'Call replace_chapter_content with revisedContent containing the complete replacement chapter text.', receivedKeys: receivedArgumentKeys(toolCall.arguments) }
          options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: result.error })
          return { tool_call_id: toolCall.id, content: JSON.stringify(result) }
        }
        const allowShorterValue = toolCall.arguments?.allowShorterContent ?? toolCall.arguments?.allow_shorter_content
        const allowShorterContent = allowShorterValue === true || allowShorterValue === 'true'
        const validationError = validateCompleteChapterReplacement(currentContent, revisedArg.value, allowShorterContent)
        if (validationError) {
          const result = {
            ok: false,
            ...validationError,
            receivedKeys: receivedArgumentKeys(toolCall.arguments),
          }
          options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: result.error })
          return { tool_call_id: toolCall.id, content: JSON.stringify(result) }
        }
        pendingFinalResult = { content: revisedArg.value, summary: String(toolCall.arguments?.summary ?? '').trim(), toolName: toolCall.name }
        options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'success', detail: 'Prepared a complete chapter replacement.', before: currentContent, after: revisedArg.value })
        return { tool_call_id: toolCall.id, content: JSON.stringify({ ok: true, summary: pendingFinalResult.summary || 'Replaced full chapter content.', acceptedField: revisedArg.key ?? 'revisedContent', words: countWords(revisedArg.value), characters: revisedArg.value.length }) }
      }

      const result = { ok: false, error: `Unsupported tool: ${toolCall.name}` }
      options.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: result.error })
      return { tool_call_id: toolCall.id, content: JSON.stringify(result) }
    }

    if (!hasCurrentContent) {
      messages.push({
        role: 'user',
        content: [
          'Important: the current chapter content is empty.',
          'get_chapter_region will return an empty region with a warning.',
          'replace_chapter_section can create content when revisedSectionContent is provided; it will be treated as the full chapter content.',
          'For a draft, continuation, rewrite, or broad content change, prefer replace_chapter_content with the complete new chapter text.',
        ].join('\n'),
      })
    }

    const modelMaxTokens = providerManager.getModelConfigForRef(modelRef)?.model.maxTokens || 8192
    const estimatedContentTokens = estimateReplacementTokens(currentContent)
    const requestedOutputTokens = hasCurrentContent
      ? Math.max(8192, Math.ceil(estimatedContentTokens * 1.35) + 2048)
      : 16384
    const workflowMaxTokens = Math.min(modelMaxTokens, requestedOutputTokens)

    await runPiAgent({
      modelRef,
      messages,
      tools,
      maxTokens: workflowMaxTokens,
      temperature: 0.5,
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
      streamAssistantText: true,
      maxRounds: 6,
      workflowName: 'Chapter content edit',
      stopAfterToolCallRound: async () => {
        if (!pendingFinalResult) return false
        if (getOpenTodos().length && !todoSyncRequested) {
          todoSyncRequested = true
          return false
        }
        if (getOpenTodos().length) await autoCloseRemainingTodos()
        return getOpenTodos().length === 0
      },
      onTurnEnd: async turn => {
        round = turn.round
        if (!turn.toolCalls.length) {
          return {
            followUp: pendingFinalResult && getOpenTodos().length
              ? buildTodoResumePrompt('The edit is prepared, but pending work still exists in todolist.')
              : round >= 3
                ? `Hard requirement: call ${hasCurrentContent ? 'replace_chapter_section or replace_chapter_content' : 'replace_chapter_content'} now. Do not reply with plain text.`
                : 'Use a tool to complete the edit. For small changes, inspect the needed region and then call replace_chapter_section.',
          }
        }
        if (pendingFinalResult && !getOpenTodos().length) return undefined
        return { steer: buildTodoResumePrompt('Continue the tool edit until the replacement is prepared and the todo list is complete.') }
      },
    })

    if (pendingFinalResult) {
      if (getOpenTodos().length) await autoCloseRemainingTodos()
      if (!getOpenTodos().length) return pendingFinalResult
    }
    throw new Error(`Vibe AI could not complete the tool edit. PendingFinalResult=${pendingFinalResult ? 'yes' : 'no'}, openTodos=${getOpenTodos().length}.`)
  } catch (error: any) {
    const message = error?.message || 'Unknown error'
    options.onToolStatus?.({ name: lastToolName, callId: lastToolCallId || undefined, status: 'error', detail: message })
    throw new Error(`Tool edit error (${lastToolName}): ${message}`)
  }
}
