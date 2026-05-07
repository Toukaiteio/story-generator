import type { DocumentChunk } from '@/types/knowledge'
import { generateId } from '@/lib/id'

export function chunkText(text: string, documentId: string, maxChunkSize = 1000): DocumentChunk[] {
  const chunks: DocumentChunk[] = []

  // Split by paragraphs first
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim())

  let currentChunk = ''
  let chunkIndex = 0

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(createChunk(currentChunk.trim(), documentId, chunkIndex++))
      currentChunk = paragraph
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph
    }
  }

  if (currentChunk.trim()) {
    chunks.push(createChunk(currentChunk.trim(), documentId, chunkIndex))
  }

  return chunks
}

function createChunk(content: string, documentId: string, index: number): DocumentChunk {
  return {
    id: generateId(),
    documentId,
    index,
    content,
    keywords: extractKeywords(content),
    tokenCount: estimateTokens(content),
  }
}

function extractKeywords(text: string): string[] {
  // Simple keyword extraction based on word frequency
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'shall', 'can', 'this', 'that',
    'these', 'those', 'it', 'its', 'he', 'she', 'they', 'them', 'his',
    'her', 'their', 'my', 'your', 'our', 'we', 'you', 'i', 'me', 'us',
  ])

  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))

  const freq = new Map<string, number>()
  for (const word of words) {
    freq.set(word, (freq.get(word) || 0) + 1)
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word)
}

function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4)
}
