import { providerManager } from '@/services/provider'
import { injectCustomSystemPrompt } from '@/services/systemPrompt'
import { handleTodoListToolCall, isTodoListTool } from '@/services/agent/todolist'
import type { ChatMessage, ProviderModelRef } from '@/types/provider'
import type { FunctionCallingResponse, ToolCallOptions } from '@/services/provider/types'
import type { AssistantCallbacks, VibePlanningResult } from './types'
import { fitToolMessagesForModel, getUsableAgentModelRef, getVibePlanningTools, normalizeVibeCharacter } from './helpers'

export async function chatWithAssistant(
  prompt: string,
  modelOverride: ProviderModelRef | null | undefined,
  callbacks: AssistantCallbacks | undefined,
): Promise<string> {
  const modelRef = getUsableAgentModelRef('editingAI', modelOverride)
  const tools = getVibePlanningTools()

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: injectCustomSystemPrompt([
        'You are a helpful writing assistant. Provide concise, actionable advice to help the user improve their story. Be creative and supportive.',
        'Function Calling policy:',
        '- If relevant tools are available, use Function Calling first.',
        '- Do not return tool-eligible structured edits as plain text.',
        '- Keep assistant text brief and let tools carry actionable output.',
      ].join('\n')),
    },
    { role: 'user', content: prompt },
  ]

  try {
    const currentMessages = fitToolMessagesForModel(messages, modelRef, 4096)
    const toolContext: Record<string, any> = {}
    let latestPlanningResult: VibePlanningResult | null = null
    let streamed = ''
    let hasOutlineChange = false
    let hasCharacterChange = false

    const getOpenTodos = () => {
      const items = Array.isArray(toolContext._todoList) ? toolContext._todoList : []
      return items.filter((item: any) => item?.status !== 'done' && item?.status !== 'blocked')
    }

    const syncTodoAfterPlanningTool = (kind: 'outline' | 'characters') => {
      const items = Array.isArray(toolContext._todoList) ? [...toolContext._todoList] : []
      if (!items.length) return
      let changed = false
      for (const item of items) {
        const title = String(item?.title ?? '').toLowerCase()
        if (kind === 'outline' && title.includes('outline') && item.status !== 'done') {
          item.status = 'done'
          item.notes = 'Auto-marked done after replace_story_outline.'
          changed = true
          continue
        }
        if (kind === 'characters' && (title.includes('character') || title.includes('profiles')) && item.status !== 'done') {
          item.status = 'done'
          item.notes = 'Auto-marked done after replace_story_characters.'
          changed = true
          continue
        }
        if (item.status === 'in_progress') {
          item.status = 'todo'
          changed = true
        }
      }
      if (!changed) return
      toolContext._todoList = items
      callbacks?.onTodoList?.({
        agent: 'Vibe AI',
        updatedAt: new Date().toISOString(),
        items,
      })
    }

    const forceToolChoice = (name: string): ToolCallOptions => ({
      toolChoice: { type: 'function', function: { name } },
    })

    const planningToolChoiceForRound = (round: number): ToolCallOptions | undefined => {
      if (round === 0) return forceToolChoice('update_todolist')
      const openTodos = getOpenTodos()
      if (openTodos.length) {
        if (!hasOutlineChange) return forceToolChoice('replace_story_outline')
        if (!hasCharacterChange) return forceToolChoice('replace_story_characters')
        return forceToolChoice('update_todolist')
      }
      if (!hasOutlineChange && round >= 4) return forceToolChoice('replace_story_outline')
      if (!hasCharacterChange && round >= 5) return forceToolChoice('replace_story_characters')
      return undefined
    }

    const runForcedTodoClosureRound = async (attempt: number) => {
      streamed = ''
      const response = await new Promise<FunctionCallingResponse>((resolve, reject) => {
        providerManager.streamWithTools(
          currentMessages,
          modelRef,
          tools,
          {
            onToken: token => {
              streamed += token
              callbacks?.onToken?.(token)
            },
            onReasoningToken: token => callbacks?.onReasoningToken?.(token),
            onToolCall: toolCall => callbacks?.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'running', detail: 'Finalizing todo checklist.' }),
            onToolResult: () => {},
            onComplete: result => resolve(result),
            onError: error => reject(error),
          },
          4096,
          0.7,
          forceToolChoice('update_todolist'),
          callbacks?.signal
        ).catch(reject)
      })

      const content = response.content || streamed
      currentMessages.push({
        role: 'assistant',
        content: content || null,
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

      if (!response.tool_calls.length) {
        const openTodos = getOpenTodos()
        currentMessages.push({
          role: 'user',
          content: `Hard requirement: call update_todolist now. Do not answer in plain text. Mark all completed items as done and leave only real blockers as blocked. Attempt ${attempt + 1}. Open items: ${openTodos.map((item: any) => `${item.id}: ${item.title} (${item.status})`).join('; ') || 'none'}.`,
        })
        return
      }

      for (const toolCall of response.tool_calls) {
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
          callbacks?.onToolStatus?.({
            callId: toolCall.id,
            name: toolCall.name,
            status: result.content.includes('"ok":false') ? 'error' : 'success',
            detail,
          })
          callbacks?.onTodoList?.({
            agent: 'Vibe AI',
            updatedAt: new Date().toISOString(),
            items: Array.isArray(toolContext._todoList) ? toolContext._todoList : [],
          })
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result.content,
          })
          continue
        }

        const result = { ok: false, error: `Unsupported tool during checklist finalization: ${toolCall.name}` }
        callbacks?.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: result.error })
        currentMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        })
      }
    }

    for (let round = 0; round < 8; round++) {
      streamed = ''
      const toolOptions = planningToolChoiceForRound(round)
      const response = await new Promise<FunctionCallingResponse>((resolve, reject) => {
        providerManager.streamWithTools(
          currentMessages,
          modelRef,
          tools,
          {
            onToken: token => {
              streamed += token
              callbacks?.onToken?.(token)
            },
            onReasoningToken: token => callbacks?.onReasoningToken?.(token),
            onToolCall: toolCall => callbacks?.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'running', detail: 'Preparing tool call.' }),
            onToolResult: () => {},
            onComplete: result => resolve(result),
            onError: error => reject(error),
          },
          4096,
          0.7,
          toolOptions,
          callbacks?.signal
        ).catch(reject)
      })

      const content = response.content || streamed

      if (!response.tool_calls.length) {
        const openTodos = getOpenTodos()
        if (openTodos.length) {
          callbacks?.onToolStatus?.({
            name: 'update_todolist',
            status: 'warning',
            detail: `Checklist incomplete: ${openTodos.length} item(s) still open.`,
          })
          currentMessages.push({
            role: 'assistant',
            content: content || null,
            reasoning_content: response.reasoning_content ?? null,
          })
          currentMessages.push({
            role: 'user',
            content: `Do not finish yet. The todolist is still incomplete. Mark completed items done, keep at most one item in_progress, and continue execution. Open items: ${openTodos.map((item: any) => `${item.id}: ${item.title} (${item.status})`).join('; ')}`,
          })
          continue
        }
        return content || ''
      }

      currentMessages.push({
        role: 'assistant',
        content: content || null,
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
          callbacks?.onToolStatus?.({
            callId: toolCall.id,
            name: toolCall.name,
            status: result.content.includes('"ok":false') ? 'error' : 'success',
            detail,
          })
          callbacks?.onTodoList?.({
            agent: 'Vibe AI',
            updatedAt: new Date().toISOString(),
            items: Array.isArray(toolContext._todoList) ? toolContext._todoList : [],
          })
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result.content,
          })
          continue
        }

        if (toolCall.name === 'replace_story_outline') {
          const outline = String(toolCall.arguments?.outline ?? '').trim()
          const title = String(toolCall.arguments?.title ?? '').trim()
          const synopsis = String(toolCall.arguments?.synopsis ?? '').trim()
          const summary = String(toolCall.arguments?.summary ?? '').trim() || 'Updated story outline.'
          if (!outline) {
            const result = { ok: false, error: 'outline is required.' }
            callbacks?.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: result.error })
            currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) })
            continue
          }
          const nextOutline = [title ? `Title: ${title}` : '', synopsis ? `Synopsis: ${synopsis}` : '', outline].filter(Boolean).join('\n\n')
          latestPlanningResult = { outline: nextOutline, summary, toolName: toolCall.name }
          hasOutlineChange = true
          syncTodoAfterPlanningTool('outline')
          callbacks?.onPlanningResult?.(latestPlanningResult)
          callbacks?.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'success', detail: summary })
          currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ ok: true, summary }) })
          continue
        }

        if (toolCall.name === 'replace_story_characters') {
          const rawCharacters = Array.isArray(toolCall.arguments?.characters) ? toolCall.arguments.characters : []
          const characters = rawCharacters.map(normalizeVibeCharacter)
          const summary = String(toolCall.arguments?.summary ?? '').trim() || `Updated ${characters.length} character profiles.`
          if (!characters.length) {
            const result = { ok: false, error: 'characters must contain at least one character.' }
            callbacks?.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: result.error })
            currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) })
            continue
          }
          latestPlanningResult = { characters, summary, toolName: toolCall.name }
          hasCharacterChange = true
          syncTodoAfterPlanningTool('characters')
          callbacks?.onPlanningResult?.(latestPlanningResult)
          callbacks?.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'success', detail: summary })
          currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ ok: true, totalCharacters: characters.length, summary }) })
          continue
        }

        const result = { ok: false, error: `Unsupported tool: ${toolCall.name}` }
        callbacks?.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: result.error })
        currentMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        })
      }

      const openTodos = getOpenTodos()
      currentMessages.push({
        role: 'user',
        content: openTodos.length
          ? `Continue from the updated todolist. Do not finish yet. Open items: ${openTodos.map((item: any) => `${item.id}: ${item.title} (${item.status})`).join('; ')}. If outline is still missing, call replace_story_outline now. If characters are still missing, call replace_story_characters now.`
          : 'Continue from the updated todolist. If the checklist is ready, complete the user request and provide the final response.',
      })
    }

    let remainingTodos = getOpenTodos()
    for (let attempt = 0; remainingTodos.length && attempt < 2; attempt++) {
      currentMessages.push({
        role: 'user',
        content: `Checklist must be completed before ending. Call update_todolist now and finish status reporting. Open items: ${remainingTodos.map((item: any) => `${item.id}: ${item.title} (${item.status})`).join('; ')}`,
      })
      await runForcedTodoClosureRound(attempt)
      remainingTodos = getOpenTodos()
    }

    if (remainingTodos.length) {
      const missing = [
        !hasOutlineChange ? 'replace_story_outline' : '',
        !hasCharacterChange ? 'replace_story_characters' : '',
      ].filter(Boolean)
      callbacks?.onToolStatus?.({
        name: 'update_todolist',
        status: 'warning',
        detail: `Checklist still incomplete after retries: ${remainingTodos.length} open item(s).${missing.length ? ` Missing tool steps: ${missing.join(', ')}` : ''}`,
      })
    }

    return latestPlanningResult?.summary || streamed
  } catch (error: any) {
    throw new Error(`Assistant error: ${error?.message || 'Unknown error'}`)
  }
}
