import type { DocumentChunk, SearchResult } from '@/types/knowledge'

// ---------- CJK detection ----------

function isCJK(char: string): boolean {
  const code = char.charCodeAt(0)
  if (char.length === 2) {
    const high = char.charCodeAt(0)
    const low = char.charCodeAt(1)
    const full = (high - 0xD800) * 0x400 + (low - 0xDC00) + 0x10000
    return (full >= 0x20000 && full <= 0x2A6DF) || (full >= 0x2F800 && full <= 0x2FA1F)
  }
  return (
    (code >= 0x2E80 && code <= 0x303F) ||
    (code >= 0x3040 && code <= 0x309F) ||
    (code >= 0x30A0 && code <= 0x30FF) ||
    (code >= 0x3400 && code <= 0x4DBF) ||
    (code >= 0x4E00 && code <= 0x9FFF) ||
    (code >= 0xAC00 && code <= 0xD7AF) ||
    (code >= 0xFF00 && code <= 0xFFEF)
  )
}

function hasCJK(text: string): boolean {
  for (const char of text) {
    if (isCJK(char)) return true
  }
  return false
}

/** Tokenize a query into search terms, handling CJK via character unigrams + bigrams. */
function tokenizeQuery(query: string): string[] {
  const lower = query.toLowerCase()

  if (hasCJK(lower)) {
    // Break CJK text into individual characters and bigrams.
    const chars: string[] = []
    for (const char of lower) {
      if (isCJK(char)) chars.push(char)
    }
    const terms = new Set<string>()
    for (let i = 0; i < chars.length; i++) {
      terms.add(chars[i])
      if (i + 1 < chars.length) terms.add(chars[i] + chars[i + 1])
    }
    return [...terms]
  }

  // Latin / mixed — word-boundary split.
  return lower.split(/\s+/).filter(w => w.length > 2)
}

// ---------- Highlight snippet ----------

function extractHighlight(content: string, query: string): string {
  const lower = content.toLowerCase()
  const qLower = query.toLowerCase()

  // Try exact match first.
  let matchIndex = lower.indexOf(qLower)
  if (matchIndex === -1) {
    // Fall back to first query term.
    const firstTerm = qLower.split(/\s+/).find(w => w.length > 2) || qLower
    // For CJK, find the first single character that appears.
    for (const char of qLower) {
      const idx = lower.indexOf(char)
      if (idx !== -1) {
        matchIndex = idx
        break
      }
    }
    if (matchIndex === -1) matchIndex = 0
  }

  const start = Math.max(0, matchIndex - 50)
  const end = Math.min(content.length, matchIndex + qLower.length + 100)
  return (start > 0 ? '...' : '') +
    content.substring(start, end) +
    (end < content.length ? '...' : '')
}

// ---------- Main search ----------

export function searchChunks(chunks: DocumentChunk[], query: string, limit = 5): SearchResult[] {
  const queryLower = query.toLowerCase()
  const queryWords = tokenizeQuery(queryLower)

  const results: SearchResult[] = []

  for (const chunk of chunks) {
    const contentLower = chunk.content.toLowerCase()
    let score = 0

    // Exact match bonus
    if (contentLower.includes(queryLower)) {
      score += 10
    }

    // Keyword matching against both content and extracted keywords
    for (const word of queryWords) {
      if (contentLower.includes(word)) {
        score += 2
      }
      if (chunk.keywords.includes(word)) {
        score += 3
      }
    }

    if (score > 0) {
      results.push({
        chunk,
        score,
        source: 'keyword',
        highlight: extractHighlight(chunk.content, query),
      })
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
