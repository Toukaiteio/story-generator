import { estimateTokens } from '@/services/knowledge/chunker'

export interface ProofreadingSegment {
  content: string
  index: number
  total: number
  charStart: number
  charEnd: number
  tokenStart: number
  tokenEnd: number
  tokenTotal: number
}

const DEFAULT_MAX_SEGMENT_TOKENS = 650
const SENTENCE_BOUNDARY = /(?<=[.!?\u3002\uff01\uff1f\uff1b;])\s*/u

function splitLargeUnit(unit: string, maxTokens: number) {
  const sentences = unit
    .split(SENTENCE_BOUNDARY)
    .map(item => item.trim())
    .filter(Boolean)

  if (sentences.length <= 1) {
    return splitByTokenWindow(unit, maxTokens)
  }

  const chunks: string[] = []
  let current = ''
  let currentTokens = 0

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence)
    if (sentenceTokens > maxTokens) {
      if (current.trim()) {
        chunks.push(current.trim())
        current = ''
        currentTokens = 0
      }
      chunks.push(...splitByTokenWindow(sentence, maxTokens))
      continue
    }

    if (currentTokens + sentenceTokens > maxTokens && current.trim()) {
      chunks.push(current.trim())
      current = sentence
      currentTokens = sentenceTokens
    } else {
      current = current ? `${current}${sentence}` : sentence
      currentTokens += sentenceTokens
    }
  }

  if (current.trim()) {
    chunks.push(current.trim())
  }

  return chunks
}

function splitByTokenWindow(text: string, maxTokens: number) {
  const chunks: string[] = []
  let current = ''
  let currentTokens = 0

  for (const char of Array.from(text)) {
    const charTokens = estimateTokens(char)
    if (currentTokens + charTokens > maxTokens && current.trim()) {
      chunks.push(current.trim())
      current = char
      currentTokens = charTokens
    } else {
      current += char
      currentTokens += charTokens
    }
  }

  if (current.trim()) {
    chunks.push(current.trim())
  }

  return chunks
}

export function buildProofreadingSegments(text: string, maxTokens = DEFAULT_MAX_SEGMENT_TOKENS): ProofreadingSegment[] {
  const content = text.trim()
  if (!content) return []

  const units = content
    .split(/\n\s*\n/)
    .map(unit => unit.trim())
    .filter(Boolean)

  const rawSegments: string[] = []
  let current = ''
  let currentTokens = 0

  for (const unit of units) {
    const unitTokens = estimateTokens(unit)
    if (unitTokens > maxTokens) {
      if (current.trim()) {
        rawSegments.push(current.trim())
        current = ''
        currentTokens = 0
      }
      rawSegments.push(...splitLargeUnit(unit, maxTokens))
      continue
    }

    if (currentTokens + unitTokens > maxTokens && current.trim()) {
      rawSegments.push(current.trim())
      current = unit
      currentTokens = unitTokens
    } else {
      current = current ? `${current}\n\n${unit}` : unit
      currentTokens += unitTokens
    }
  }

  if (current.trim()) {
    rawSegments.push(current.trim())
  }

  const tokenTotal = estimateTokens(content)
  let cursor = 0
  let searchCursor = 0
  return rawSegments.map((segment, index) => {
    const segmentTokens = estimateTokens(segment)
    const tokenStart = cursor + 1
    const charStart = content.indexOf(segment, searchCursor)
    const safeCharStart = charStart >= 0 ? charStart : searchCursor
    const charEnd = safeCharStart + segment.length
    searchCursor = charEnd
    cursor += segmentTokens
    return {
      content: segment,
      index,
      total: rawSegments.length,
      charStart: safeCharStart,
      charEnd,
      tokenStart,
      tokenEnd: Math.min(cursor, tokenTotal),
      tokenTotal,
    }
  })
}

export function buildSegmentedProofreadingPrompts(prompt: string, maxTokens = DEFAULT_MAX_SEGMENT_TOKENS) {
  const marker = 'Current Chapter Content:\n'
  const markerIndex = prompt.indexOf(marker)
  if (markerIndex === -1) {
    return buildProofreadingSegments(prompt, maxTokens).map(segment => ({
      prompt: [
        `[Segment ${segment.index + 1} of ${segment.total}; estimated tokens ${segment.tokenStart}-${segment.tokenEnd} of ${segment.tokenTotal}. Proofread only this segment and report exact excerpts from this segment.]`,
        segment.content,
      ].join('\n\n'),
      range: segment,
    }))
  }

  const prefix = prompt.slice(0, markerIndex + marker.length)
  const content = prompt.slice(markerIndex + marker.length)
  return buildProofreadingSegments(content, maxTokens).map(segment => ({
    prompt: [
      prefix,
      `[Segment ${segment.index + 1} of ${segment.total}; estimated tokens ${segment.tokenStart}-${segment.tokenEnd} of ${segment.tokenTotal}. Proofread only this segment and report exact excerpts from this segment.]`,
      segment.content,
    ].join('\n'),
    range: segment,
  }))
}
