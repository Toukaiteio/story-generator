import { injectCustomSystemPrompt } from '@/services/systemPrompt'
import { handleTodoListToolCall, isTodoListTool } from '@/services/agent/todolist'
import type { ChatMessage, ProviderModelRef } from '@/types/provider'
import type { ToolCall, ToolResult } from '@/services/provider/tools'
import type { AssistantCallbacks, VibePlanningResult } from './types'
import { getUsableAgentModelRef, getVibePlanningTools, normalizeVibeCharacter } from './helpers'
import { runPiAgent } from '@/services/agent/piRuntime'

function textFromToolArgument(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    return value
      .map(item => textFromToolArgument(item))
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        const text = textFromToolArgument(item)
        return text ? `${key}: ${text}` : ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  return ''
}

function readFirstTextArgument(args: Record<string, any> | undefined, names: string[]): { value: string; key: string | null } {
  if (!args || typeof args !== 'object') return { value: '', key: null }
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(args, name)) continue
    const value = textFromToolArgument(args[name])
    if (value) return { value, key: name }
  }
  return { value: '', key: null }
}

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
    const toolContext: Record<string, any> = {}
    let latestPlanningResult: VibePlanningResult | null = null
    let hasOutlineChange = false
    let hasCharacterChange = false
    let lastToolErrors: string[] = []
    let round = 0

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

    const toolResult = async (toolCall: ToolCall): Promise<ToolResult> => {
      if (isTodoListTool(toolCall.name)) {
        const result = await handleTodoListToolCall(toolCall, toolContext, 'Vibe AI')
        let detail = 'Todo list updated.'
        try {
          const parsed = JSON.parse(result.content)
          if (parsed?.error) detail = parsed.error
          else if (typeof parsed?.done === 'number' && typeof parsed?.total === 'number') detail = `${parsed.done}/${parsed.total} complete.`
        } catch {
          // Keep the generic detail when the tool returns non-JSON content.
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
        return result
      }

      if (toolCall.name === 'replace_story_outline') {
        const outlineArg = readFirstTextArgument(toolCall.arguments, [
          'outline', 'storyOutline', 'masterOutline', 'master_outline', 'outlineText',
          'storyPlan', 'masterPlan', 'globalOutline', 'narrativeArc', 'content', 'replacement', 'text', 'plan',
        ])
        const outline = outlineArg.value
        const title = String(toolCall.arguments?.title ?? '').trim()
        const synopsis = String(toolCall.arguments?.synopsis ?? '').trim()
        const summary = String(toolCall.arguments?.summary ?? '').trim() || 'Updated story outline.'
        if (!outline) {
          const receivedKeys = toolCall.arguments && typeof toolCall.arguments === 'object'
            ? Object.keys(toolCall.arguments)
            : []
          const failure = {
            ok: false,
            error: 'outline is required.',
            expected: 'Call replace_story_outline with an outline field containing the complete replacement master story outline string.',
            receivedKeys,
          }
          lastToolErrors.push(`${toolCall.name}: ${failure.error} Expected field "outline"; received keys: ${receivedKeys.join(', ') || 'none'}.`)
          callbacks?.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: failure.error })
          return { tool_call_id: toolCall.id, content: JSON.stringify(failure) }
        }
        if (outlineArg.key && outlineArg.key !== 'outline') {
          lastToolErrors.push(`Accepted ${toolCall.name}.${outlineArg.key} as outline for compatibility. Use the exact "outline" field next time.`)
        }
        const nextOutline = [title ? `Title: ${title}` : '', synopsis ? `Synopsis: ${synopsis}` : '', outline]
          .filter(Boolean)
          .join('\n\n')
        latestPlanningResult = { outline: nextOutline, summary, toolName: toolCall.name }
        hasOutlineChange = true
        syncTodoAfterPlanningTool('outline')
        callbacks?.onPlanningResult?.(latestPlanningResult)
        const statusDetail = outlineArg.key && outlineArg.key !== 'outline'
          ? `${summary} Accepted alias "${outlineArg.key}" as outline.`
          : summary
        callbacks?.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'success', detail: statusDetail })
        return {
          tool_call_id: toolCall.id,
          content: JSON.stringify({ ok: true, summary: statusDetail, acceptedField: outlineArg.key ?? 'outline' }),
        }
      }

      if (toolCall.name === 'replace_story_characters') {
        const rawCharacters = [
          toolCall.arguments?.characters,
          toolCall.arguments?.characterProfiles,
          toolCall.arguments?.profiles,
          toolCall.arguments?.cast,
        ].find(Array.isArray) ?? []
        const characters = rawCharacters.map(normalizeVibeCharacter)
        const summary = String(toolCall.arguments?.summary ?? '').trim() || `Updated ${characters.length} character profiles.`
        if (!characters.length) {
          const failure = { ok: false, error: 'characters must contain at least one character.' }
          callbacks?.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: failure.error })
          return { tool_call_id: toolCall.id, content: JSON.stringify(failure) }
        }
        latestPlanningResult = { characters, summary, toolName: toolCall.name }
        hasCharacterChange = true
        syncTodoAfterPlanningTool('characters')
        callbacks?.onPlanningResult?.(latestPlanningResult)
        callbacks?.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'success', detail: summary })
        return {
          tool_call_id: toolCall.id,
          content: JSON.stringify({ ok: true, totalCharacters: characters.length, summary }),
        }
      }

      const failure = { ok: false, error: `Unsupported tool: ${toolCall.name}` }
      callbacks?.onToolStatus?.({ callId: toolCall.id, name: toolCall.name, status: 'error', detail: failure.error })
      return { tool_call_id: toolCall.id, content: JSON.stringify(failure) }
    }

    const result = await runPiAgent({
      modelRef,
      messages,
      tools,
      maxTokens: 4096,
      temperature: 0.7,
      contextTokens: undefined,
      signal: callbacks?.signal,
      executeTool: toolResult,
      onToken: token => callbacks?.onToken?.(token),
      onReasoningToken: token => callbacks?.onReasoningToken?.(token),
      onToolStatus: status => {
        if (status.status === 'running') {
          callbacks?.onToolStatus?.({ callId: status.callId, name: status.name, status: 'running', detail: 'Preparing tool call.' })
          return
        }
        // Argument validation happens before executeTool, so failures never
        // produce a tool-level status. Surface them instead of leaving the
        // call stuck at "running".
        if (status.status === 'error') {
          callbacks?.onToolStatus?.({
            callId: status.callId,
            name: status.name,
            status: 'error',
            detail: status.detail || status.result?.content || 'Tool call failed.',
          })
        }
      },
      // Do not force tool_choice here. Some OpenAI-compatible relays honor the
      // forced function name but drop the arguments, producing an unusable
      // call. The onTurnEnd prompts below still require tools and let the
      // model choose the one it can populate correctly.
      forceToolName: () => null,
      streamAssistantText: true,
      maxRounds: 8,
      workflowName: 'Vibe planning',
      onTurnEnd: async turn => {
        round = turn.round
        const openTodos = getOpenTodos()
        const feedback = lastToolErrors.length
          ? `Tool feedback from the previous round:\n${lastToolErrors.map(error => `- ${error}`).join('\n')}`
          : ''
        lastToolErrors = []

        if (!turn.toolCalls.length && openTodos.length) {
          callbacks?.onToolStatus?.({
            name: 'update_todolist',
            status: 'warning',
            detail: `Checklist incomplete: ${openTodos.length} item(s) still open.`,
          })
          return {
            followUp: `${feedback ? `${feedback}\n\n` : ''}Do not finish yet. The todolist is still incomplete. Mark completed items done, keep at most one item in_progress, and continue execution. Open items: ${openTodos.map((item: any) => `${item.id}: ${item.title} (${item.status})`).join('; ')}`,
          }
        }

        if (turn.toolCalls.length) {
          return {
            steer: [
              feedback,
              openTodos.length
                ? `Continue from the updated todolist. Open items: ${openTodos.map((item: any) => `${item.id}: ${item.title} (${item.status})`).join('; ')}.`
                : 'Continue from the updated todolist and complete the user request.',
            ].filter(Boolean).join('\n\n'),
          }
        }
        return undefined
      },
    })

    if (getOpenTodos().length) {
      callbacks?.onToolStatus?.({
        name: 'update_todolist',
        status: 'warning',
        detail: `Checklist still incomplete: ${getOpenTodos().length} open item(s).`,
      })
    }
    const planningSummary = (latestPlanningResult as VibePlanningResult | null)?.summary
    return planningSummary || result.content
  } catch (error: any) {
    throw new Error(`Assistant error: ${error?.message || 'Unknown error'}`)
  }
}
