import type { DocumentChunk, SearchResult } from '@/types/knowledge'

export function searchChunks(chunks: DocumentChunk[], query: string, limit = 5): SearchResult[] {
  const queryLower = query.toLowerCase()
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2)

  const results: SearchResult[] = []

  for (const chunk of chunks) {
    const contentLower = chunk.content.toLowerCase()
    let score = 0

    // Exact match bonus
    if (contentLower.includes(queryLower)) {
      score += 10
    }

    // Keyword matching
    for (const word of queryWords) {
      if (contentLower.includes(word)) {
        score += 2
      }
      if (chunk.keywords.includes(word)) {
        score += 3
      }
    }

    if (score > 0) {
      // Find highlight snippet
      const matchIndex = contentLower.indexOf(queryWords[0] || '')
      const start = Math.max(0, matchIndex - 50)
      const end = Math.min(chunk.content.length, matchIndex + (queryWords[0]?.length || 0) + 100)
      const highlight = (start > 0 ? '...' : '') +
        chunk.content.substring(start, end) +
        (end < chunk.content.length ? '...' : '')

      results.push({
        chunk,
        score,
        source: 'keyword',
        highlight,
      })
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
