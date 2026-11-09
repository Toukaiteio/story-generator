export interface InlineTextRange {
  start: number
  end: number
}

function lineBounds(text: string, caret: number): InlineTextRange {
  let start = Math.max(0, Math.min(caret, text.length))
  while (start > 0 && text[start - 1] !== '\n') start -= 1
  let end = Math.max(0, Math.min(caret, text.length))
  while (end < text.length && text[end] !== '\n') end += 1
  return { start, end }
}

/**
 * Paragraph under the caret. The editor stores one paragraph per line, so the
 * range is the line; a blank line falls through to the next non-empty one, or
 * the previous when the caret sits on the trailing empty paragraph.
 */
export function paragraphRangeAt(text: string, caret: number): InlineTextRange {
  const source = typeof text === 'string' ? text : ''
  const position = Math.max(0, Math.min(typeof caret === 'number' ? caret : 0, source.length))
  if (!source.trim()) return { start: 0, end: 0 }

  const current = lineBounds(source, position)
  if (source.slice(current.start, current.end).trim()) return current

  let cursor = current.end
  while (cursor < source.length) {
    const next = lineBounds(source, cursor + 1)
    if (source.slice(next.start, next.end).trim()) return next
    if (next.end <= cursor) break
    cursor = next.end
  }

  cursor = current.start
  while (cursor > 0) {
    const previous = lineBounds(source, Math.max(0, cursor - 1))
    if (source.slice(previous.start, previous.end).trim()) return previous
    if (previous.start >= cursor) break
    cursor = previous.start
  }

  return current
}
