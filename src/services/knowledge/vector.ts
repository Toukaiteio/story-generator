import type { DocumentChunk, SearchResult } from '@/types/knowledge'

function normalizeVector(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (!norm) return vector.map(() => 0)
  return vector.map(value => value / norm)
}

function cosineSimilarity(a: number[], b: number[]) {
  const length = Math.min(a.length, b.length)
  if (!length) return 0

  let dot = 0
  let magnitudeA = 0
  let magnitudeB = 0

  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i]
    magnitudeA += a[i] * a[i]
    magnitudeB += b[i] * b[i]
  }

  if (!magnitudeA || !magnitudeB) return 0
  return dot / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB))
}

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

function findFirstMatchIndex(contentLower: string, query: string): number {
  if (hasCJK(query)) {
    // For CJK, try bigrams first, then individual characters.
    const chars: string[] = []
    for (const char of query) {
      if (isCJK(char)) chars.push(char)
    }
    for (let i = 0; i < chars.length; i++) {
      if (i + 1 < chars.length) {
        const idx = contentLower.indexOf(chars[i] + chars[i + 1])
        if (idx !== -1) return idx
      }
      const idx = contentLower.indexOf(chars[i])
      if (idx !== -1) return idx
    }
    return 0
  }

  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  const matchWord = words.find(word => contentLower.includes(word)) ?? words[0] ?? ''
  return matchWord ? contentLower.indexOf(matchWord) : 0
}

function buildHighlight(content: string, query: string) {
  const contentLower = content.toLowerCase()
  const matchIndex = findFirstMatchIndex(contentLower, query)
  const start = Math.max(0, matchIndex - 50)
  const end = Math.min(content.length, matchIndex + query.length + 120)
  return `${start > 0 ? '...' : ''}${content.slice(start, end)}${end < content.length ? '...' : ''}`.trim()
}

export function searchVectorChunks(
  chunks: DocumentChunk[],
  queryEmbedding: number[],
  query: string,
  limit = 5
): SearchResult[] {
  const normalizedQuery = normalizeVector(queryEmbedding)

  const results = chunks
    .map((chunk) => {
      const sourceEmbedding = Array.isArray(chunk.embedding) && chunk.embedding.length
        ? chunk.embedding
        : null

      if (!sourceEmbedding) return null

      const similarity = cosineSimilarity(normalizeVector(sourceEmbedding), normalizedQuery)
      if (similarity <= 0) return null

      return {
        chunk,
        score: Math.round(similarity * 1000),
        source: 'vector' as const,
        highlight: buildHighlight(chunk.content, query),
      }
    })
    .filter(Boolean) as SearchResult[]

  return results.sort((a, b) => b.score - a.score).slice(0, limit)
}

export function mergeSearchResults(
  keywordResults: SearchResult[],
  vectorResults: SearchResult[],
  limit = 5
) {
  const merged = new Map<string, SearchResult>()

  for (const result of keywordResults) {
    merged.set(result.chunk.id, { ...result })
  }

  for (const result of vectorResults) {
    const current = merged.get(result.chunk.id)
    if (!current) {
      merged.set(result.chunk.id, { ...result })
      continue
    }

    const combinedScore = current.score + result.score
    merged.set(result.chunk.id, {
      chunk: result.chunk,
      score: combinedScore,
      source: result.score >= current.score ? 'vector' : current.source,
      highlight: current.highlight || result.highlight,
    })
  }

  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit)
}

