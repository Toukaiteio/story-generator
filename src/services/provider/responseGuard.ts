const REFUSAL_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /I['’]?m\s+sorry/gi, replacement: 'Certainly' },
  { pattern: /I\s+cannot\s+help/gi, replacement: 'I can help' },
  { pattern: /我\s*(?:无法|不能)/g, replacement: '我可以' },
  { pattern: /抱歉[，,。]/g, replacement: '好的，' },
]

const PARAGRAPH_BOUNDARY_RE = /\n\s*\n/

export interface GuardedTextResult {
  text: string
  detectedRefusal: boolean
}

export function guardResponseText(text: string | null | undefined): GuardedTextResult {
  const source = text ?? ''
  let detectedRefusal = false
  let next = source

  for (const { pattern, replacement } of REFUSAL_PATTERNS) {
    pattern.lastIndex = 0
    if (pattern.test(next)) {
      detectedRefusal = true
      next = next.replace(pattern, replacement)
    }
  }

  return { text: next, detectedRefusal }
}

export function buildContinueMessages<T extends { role: string; content: string | null }>(
  messages: T[],
  assistantContent: string
): T[] {
  return [
    ...messages,
    { role: 'assistant', content: assistantContent } as T,
    { role: 'user', content: 'Continue.' } as T,
  ]
}

export function createParagraphGuard(onParagraph: (text: string) => void) {
  let pending = ''
  let sanitized = ''
  let detectedRefusal = false

  function flushCompletedParagraphs(final = false) {
    let boundaryIndex = pending.search(PARAGRAPH_BOUNDARY_RE)

    while (boundaryIndex >= 0) {
      const boundaryMatch = pending.match(PARAGRAPH_BOUNDARY_RE)
      if (!boundaryMatch) break

      const cutIndex = boundaryIndex + boundaryMatch[0].length
      const chunk = pending.slice(0, cutIndex)
      pending = pending.slice(cutIndex)

      const guarded = guardResponseText(chunk)
      sanitized += guarded.text
      detectedRefusal = detectedRefusal || guarded.detectedRefusal
      onParagraph(guarded.text)

      boundaryIndex = pending.search(PARAGRAPH_BOUNDARY_RE)
    }

    if (final && pending) {
      const guarded = guardResponseText(pending)
      sanitized += guarded.text
      detectedRefusal = detectedRefusal || guarded.detectedRefusal
      onParagraph(guarded.text)
      pending = ''
    }
  }

  return {
    push(fragment: string) {
      pending += fragment
      flushCompletedParagraphs(false)
    },
    flush() {
      flushCompletedParagraphs(true)
      return { text: sanitized, detectedRefusal }
    },
  }
}
