/**
 * Shared assembler for streamed OpenAI-compatible tool-call arguments.
 *
 * Relays emit arguments in several incompatible shapes:
 * - standard: many small string fragments appended in order;
 * - one-shot: a single complete JSON string chunk;
 * - object snapshot: an arguments OBJECT chunk followed by string fragments
 *   that continue the JSON object (Gemini-compatible relays);
 * - duplicate final frame: the complete arguments repeated in the terminal
 *   SSE `message.tool_calls` frame.
 *
 * Appending every fragment blindly corrupts the last three shapes, so the
 * buffer classifies each fragment before appending and can reconstruct the
 * final arguments text at stream end.
 */
export interface ToolArgumentsBuffer {
  argumentsText: string
  /** True once the args arrived as a complete JSON object chunk. */
  objectSnapshot: boolean
  /** String fragments received after an object snapshot. */
  stringTail: string
}

export function createToolArgumentsBuffer(): ToolArgumentsBuffer {
  return { argumentsText: '', objectSnapshot: false, stringTail: '' }
}

export function isArgumentObject(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

/** Returns the parsed object when `text` is a complete JSON object string. */
export function parseCompleteJsonObject(text: string): Record<string, any> | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
  try {
    const parsed = JSON.parse(trimmed)
    return isArgumentObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function appendToolArgumentFragment(buffer: ToolArgumentsBuffer, fragment: unknown): void {
  if (typeof fragment === 'string') {
    if (!fragment) return

    if (buffer.objectSnapshot) {
      // An object snapshot already fixed the base arguments; keep string
      // continuations separate so they can be stitched on at the end.
      buffer.stringTail += fragment
      return
    }

    const complete = parseCompleteJsonObject(fragment)
    if (complete) {
      // A complete JSON chunk replaces whatever partial text exists. Relays
      // that repeat the full arguments in the final SSE frame stay idempotent
      // instead of producing doubled JSON.
      buffer.argumentsText = fragment
      return
    }

    buffer.argumentsText += fragment
    return
  }

  if (!isArgumentObject(fragment)) return

  const current = parseCompleteJsonObject(buffer.argumentsText)
  const merged = current ? { ...current, ...fragment } : fragment
  buffer.argumentsText = JSON.stringify(merged)
  buffer.objectSnapshot = true
}

/**
 * Produces the final arguments text. Returns null when the buffer never
 * received anything or the reconstructed text is not valid JSON (callers
 * should surface their standard parse error in that case).
 */
export function finalizeToolArguments(buffer: ToolArgumentsBuffer): string | null {
  if (buffer.objectSnapshot) {
    if (!buffer.stringTail.trim()) return buffer.argumentsText || null

    const baseText = buffer.argumentsText.trim() || '{}'
    const stitched = baseText.endsWith('}')
      ? `${baseText.slice(0, -1)}${buffer.stringTail}`
      : `${baseText}${buffer.stringTail}`
    for (const candidate of [stitched, buffer.stringTail]) {
      if (parseCompleteJsonObject(candidate)) return candidate
    }
    // Neither reconstruction parses; report the standard malformed-JSON path.
    return null
  }

  if (!buffer.argumentsText.trim()) return null
  return parseCompleteJsonObject(buffer.argumentsText) ? buffer.argumentsText : null
}
