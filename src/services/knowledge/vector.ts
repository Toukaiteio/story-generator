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

function buildHighlight(content: string, query: string) {
  const queryLower = query.toLowerCase().trim()
  const contentLower = content.toLowerCase()
  const words = queryLower.split(/\s+/).filter(word => word.length > 2)
  const matchWord = words.find(word => contentLower.includes(word)) ?? words[0] ?? ''
  const matchIndex = matchWord ? contentLower.indexOf(matchWord) : 0
  const start = Math.max(0, matchIndex - 50)
  const end = Math.min(content.length, matchIndex + (matchWord.length || 0) + 120)
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

