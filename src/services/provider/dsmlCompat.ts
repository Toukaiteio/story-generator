import type { FunctionCallingResponse } from './types'
import type { ToolCall } from './tools'

const DSML_BAR_REGEX = /｜/g
const DSML_TOOL_BLOCK_REGEX = /<\|DSML\|tool_calls>[\s\S]*?<\/\|DSML\|tool_calls>/gi
const DSML_INVOKE_REGEX = /<\|DSML\|invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/\|DSML\|invoke>/gi
const DSML_PARAMETER_REGEX = /<\|DSML\|parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/\|DSML\|parameter>/gi
const LONGCAT_TOOL_BLOCK_REGEX = /<longcat_tool_call>[\s\S]*?<\/longcat_tool_call>/gi
const LONGCAT_TOOL_INNER_REGEX = /<longcat_tool_call>([\s\S]*?)<\/longcat_tool_call>/gi
const LONGCAT_ARG_PAIR_REGEX = /<longcat_arg_key>([\s\S]*?)<\/longcat_arg_key>\s*<longcat_arg_value>([\s\S]*?)<\/longcat_arg_value>/gi
const LONGCAT_THINK_BLOCK_REGEX = /<longcat_think>[\s\S]*?<\/longcat_think>/gi

function normalizeDsmlBars(input: string) {
  return input.replace(DSML_BAR_REGEX, '|')
}

function stripDsmlTags(input: string) {
  return normalizeDsmlBars(input)
    .replace(DSML_TOOL_BLOCK_REGEX, '')
    .replace(/<\|DSML\|tool_>/gi, '')
    .replace(/<\|DSML\|tool_calls>/gi, '')
    .replace(/<\/\|DSML\|tool_calls>/gi, '')
    .replace(LONGCAT_TOOL_BLOCK_REGEX, '')
    .replace(LONGCAT_THINK_BLOCK_REGEX, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parseJsonWithFallback(raw: string): any {
  const text = raw.trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    // Fallback: recover valid object entries from malformed arrays.
    if (!text.startsWith('[')) return text
    const objectMatches = text.match(/\{[\s\S]*?\}/g) ?? []
    const parsedObjects: any[] = []
    for (const fragment of objectMatches) {
      try {
        const parsed = JSON.parse(fragment)
        if (parsed && typeof parsed === 'object') {
          parsedObjects.push(parsed)
        }
      } catch {
        // Skip malformed fragments.
      }
    }
    return parsedObjects.length ? parsedObjects : text
  }
}

function parseInvokeArguments(invokeBody: string): Record<string, any> {
  const args: Record<string, any> = {}
  const normalized = normalizeDsmlBars(invokeBody)
  for (const match of normalized.matchAll(DSML_PARAMETER_REGEX)) {
    const [, name, rawValue] = match
    args[name] = parseJsonWithFallback(rawValue)
  }
  return args
}

function extractDsmlToolCalls(text: string): ToolCall[] {
  const normalized = normalizeDsmlBars(text)
  const calls: ToolCall[] = []
  let callIndex = 0

  for (const match of normalized.matchAll(DSML_INVOKE_REGEX)) {
    const [, name, body] = match
    const callName = String(name || '').trim()
    if (!callName) continue
    callIndex += 1
    calls.push({
      id: `dsml_${callIndex}`,
      name: callName,
      arguments: parseInvokeArguments(body),
    })
  }

  return calls
}

function parseLongcatJsonCall(inner: string): ToolCall | null {
  const trimmed = inner.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    const name = typeof parsed?.name === 'string' ? parsed.name.trim() : ''
    const args = parsed?.arguments && typeof parsed.arguments === 'object' && !Array.isArray(parsed.arguments)
      ? parsed.arguments
      : {}
    if (!name) return null
    return {
      id: `longcat_json_${Math.random().toString(36).slice(2, 10)}`,
      name,
      arguments: args,
    }
  } catch {
    return null
  }
}

function parseLongcatTagCall(inner: string, index: number): ToolCall | null {
  const text = inner.trim()
  if (!text) return null
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() || ''
  const functionName = firstLine.replace(/<[^>]*>/g, '').trim()
  if (!functionName) return null
  const argumentsRecord: Record<string, any> = {}
  for (const match of text.matchAll(LONGCAT_ARG_PAIR_REGEX)) {
    const key = String(match[1] ?? '').trim()
    const rawValue = String(match[2] ?? '').trim()
    if (!key || Object.prototype.hasOwnProperty.call(argumentsRecord, key)) continue
    argumentsRecord[key] = parseJsonWithFallback(rawValue)
  }
  return {
    id: `longcat_${index}`,
    name: functionName,
    arguments: argumentsRecord,
  }
}

function extractLongcatToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = []
  let index = 0
  for (const match of text.matchAll(LONGCAT_TOOL_INNER_REGEX)) {
    const inner = String(match[1] ?? '')
    const parsedJsonCall = parseLongcatJsonCall(inner)
    if (parsedJsonCall) {
      calls.push(parsedJsonCall)
      continue
    }
    index += 1
    const parsedTagCall = parseLongcatTagCall(inner, index)
    if (parsedTagCall) calls.push(parsedTagCall)
  }
  return calls
}

function dedupeToolCalls(toolCalls: ToolCall[]) {
  const seen = new Set<string>()
  const deduped: ToolCall[] = []
  for (const toolCall of toolCalls) {
    const key = `${toolCall.name}:${JSON.stringify(toolCall.arguments ?? {})}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(toolCall)
  }
  return deduped
}

export function applyDsmlCompatToFunctionResponse(response: FunctionCallingResponse): FunctionCallingResponse {
  const content = typeof response.content === 'string' ? response.content : ''
  const reasoning = typeof response.reasoning_content === 'string' ? response.reasoning_content : ''
  const dsmlSource = [content, reasoning].filter(Boolean).join('\n')
  const recoveredCalls = extractDsmlToolCalls(dsmlSource)
  const longcatCalls = extractLongcatToolCalls(dsmlSource)
  const mergedCalls = dedupeToolCalls([...(response.tool_calls ?? []), ...recoveredCalls, ...longcatCalls])

  const cleanedContent = stripDsmlTags(content)
  const cleanedReasoning = stripDsmlTags(reasoning)
  const nextContent = cleanedContent || (cleanedReasoning && !cleanedReasoning.startsWith('<|DSML|') ? cleanedReasoning : '') || null

  return {
    ...response,
    content: nextContent,
    reasoning_content: cleanedReasoning || null,
    tool_calls: mergedCalls,
    finish_reason: mergedCalls.length ? 'tool_calls' : response.finish_reason,
  }
}

