import type { DocumentChunk } from '@/types/knowledge'
import { generateId } from '@/lib/id'

// ---------- Script detection ----------

function isCJK(char: string): boolean {
  const code = char.charCodeAt(0)
  // Surrogate pairs for CJK Extension B+ (Supplementary Ideographic Plane)
  if (char.length === 2) {
    const high = char.charCodeAt(0)
    const low = char.charCodeAt(1)
    const full = (high - 0xD800) * 0x400 + (low - 0xDC00) + 0x10000
    return (full >= 0x20000 && full <= 0x2A6DF) || (full >= 0x2F800 && full <= 0x2FA1F)
  }
  return (
    (code >= 0x2E80 && code <= 0x2EFF) ||  // CJK Radicals Supplement
    (code >= 0x3000 && code <= 0x303F) ||  // CJK Symbols and Punctuation
    (code >= 0x3040 && code <= 0x309F) ||  // Hiragana (Japanese)
    (code >= 0x30A0 && code <= 0x30FF) ||  // Katakana (Japanese)
    (code >= 0x3400 && code <= 0x4DBF) ||  // CJK Unified Ideographs Extension A
    (code >= 0x4E00 && code <= 0x9FFF) ||  // CJK Unified Ideographs
    (code >= 0xAC00 && code <= 0xD7AF) ||  // Hangul Syllables (Korean)
    (code >= 0xF900 && code <= 0xFAFF) ||  // CJK Compatibility Ideographs
    (code >= 0xFF00 && code <= 0xFFEF)     // Fullwidth Forms (includes fullwidth punctuation)
  )
}

// ---------- Token estimation ----------

/**
 * Token estimate with CJK-aware weighting.
 *
 * CJK characters carry more semantic density — each typically occupies
 * 1.5–2 tokens in LLM tokenizers. Latin/numeric characters average
 * ~4 per token. This weighting reflects that difference so chunk
 * boundaries and context assembly behave consistently across scripts.
 */
export function estimateTokens(text: string): number {
  let tokens = 0
  for (const char of text) {
    tokens += isCJK(char) ? 2 : 0.25
  }
  return Math.ceil(tokens)
}

// ---------- Chunking ----------

/**
 * Split text into semantically meaningful chunks using token-aware sizing.
 *
 * Flow:
 *  1. Split on paragraph boundaries (preserving semantic units).
 *  2. Accumulate paragraphs until the combined token estimate exceeds
 *     `maxChunkSize`, then flush.
 *  3. Remaining content becomes the final chunk.
 *
 * Because `estimateTokens` weights CJK characters at 2× and Latin
 * characters at 0.25×, a single `maxChunkSize` value produces
 * reasonably sized chunks regardless of the dominant script.
 */
export function chunkText(text: string, documentId: string, maxChunkSize = 1000): DocumentChunk[] {
  const chunks: DocumentChunk[] = []

  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim())

  let currentChunk = ''
  let currentTokens = 0
  let chunkIndex = 0

  for (const paragraph of paragraphs) {
    const paraTokens = estimateTokens(paragraph)

    if (currentTokens + paraTokens > maxChunkSize && currentTokens > 0) {
      chunks.push(createChunk(currentChunk.trim(), documentId, chunkIndex++))
      currentChunk = paragraph
      currentTokens = paraTokens
    } else {
      const separator = currentChunk ? '\n\n' : ''
      currentChunk += separator + paragraph
      currentTokens += paraTokens
    }
  }

  if (currentChunk.trim()) {
    chunks.push(createChunk(currentChunk.trim(), documentId, chunkIndex))
  }

  return chunks
}

// ---------- Keyword extraction ----------

function extractKeywords(text: string): string[] {
  let cjkCount = 0
  let totalGraphic = 0
  for (const char of text) {
    if (isCJK(char)) {
      cjkCount++
      totalGraphic++
    } else if (char.trim()) {
      totalGraphic++
    }
  }

  // If at least 30 % of visible characters are CJK, use CJK extraction.
  return totalGraphic > 0 && cjkCount / totalGraphic >= 0.3
    ? extractCJKBigrams(text)
    : extractLatinKeywords(text)
}

/** Extract CJK keywords as individual characters and character bigrams. */
function extractCJKBigrams(text: string): string[] {
  // Collect only CJK characters in order.
  const chars: string[] = []
  for (const char of text) {
    if (isCJK(char)) {
      chars.push(char)
    }
  }
  if (chars.length === 0) return []

  const freq = new Map<string, number>()

  for (let i = 0; i < chars.length; i++) {
    // Single character
    freq.set(chars[i], (freq.get(chars[i]) || 0) + 1)
    // Bigram (two adjacent CJK characters often form a meaningful word)
    if (i + 1 < chars.length) {
      const bigram = chars[i] + chars[i + 1]
      freq.set(bigram, (freq.get(bigram) || 0) + 1)
    }
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word]) => word)
}

function extractLatinKeywords(text: string): string[] {
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

// ---------- Chunk factory ----------

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
